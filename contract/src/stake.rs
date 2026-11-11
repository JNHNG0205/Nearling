//! NEARON stake, unstake, withdraw and CREDIT sweep (CLAUDE.md 6, Option A: contract is the
//! plain iNEAR holder). State that a pool call changes is locked before the call and
//! restored by the callback if the call fails.

use crate::pet::PendingUnstake;
use crate::{events, Contract, ContractExt};
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseError};

/// NEARON documents 400+ Tgas for pool calls; unburnt gas is refunded (S6).
const POOL_GAS: Gas = Gas::from_tgas(400);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);
const MIN_PREPAID: Gas = Gas::from_tgas(430);
/// `claimable` only updates after `sync_from_farm` (S6), so a sweep syncs first.
const SYNC_GAS: Gas = Gas::from_tgas(150);
const MIN_PREPAID_SWEEP: Gas = Gas::from_tgas(600);
/// Unstake epochs: current + farm delay (1 on testnet) + 1.
const UNLOCK_EPOCHS: u64 = 2;

#[near]
impl Contract {
    /// Admin, once, at deploy: a small house deposit so the pool takes its one-time
    /// first-deposit fee from it. After this every pet stake mints iNEAR 1:1 (S6).
    #[payable]
    pub fn register_pool(&mut self) -> Promise {
        require!(
            env::predecessor_account_id() == self.config.admin,
            "E_NOT_ADMIN: Only admin"
        );
        require!(
            !self.pool_registered,
            "E_POOL_READY: Pool already registered"
        );
        let amount = env::attached_deposit();
        require!(!amount.is_zero(), "E_DEPOSIT: Attach the house deposit");
        self.pool_call("deposit_and_stake", json!({}), amount).then(
            self.callback()
                .on_register_pool(U128(amount.as_yoctonear())),
        )
    }

    #[private]
    pub fn on_register_pool(&mut self, amount: U128) -> bool {
        if !call_succeeded() {
            Promise::new(self.config.admin.clone())
                .transfer(NearToken::from_yoctonear(amount.0))
                .detach();
            return false;
        }
        self.pool_registered = true;
        events::emit("pool_registered", json!({ "house_deposit": amount }));
        true
    }

    /// Owner only, at least `min_stake`. In approval mode, use `propose_action(Stake)`.
    #[payable]
    pub fn stake(&mut self, pet_id: TokenId) -> Promise {
        let owner = self.require_owner(&pet_id);
        self.require_direct(&pet_id);
        self.internal_stake(pet_id, owner, env::attached_deposit())
    }

    /// Owner only; one pending unstake per pet, always treated as pending (S6). Attach
    /// `config.pool_unstake_deposit` (any excess is refunded); it comes back with the withdrawal.
    #[payable]
    pub fn unstake(&mut self, pet_id: TokenId, amount: U128) -> Promise {
        let owner = self.require_owner(&pet_id);
        self.require_direct(&pet_id);
        let deposit = self.take_unstake_deposit(&owner, env::attached_deposit());
        self.internal_unstake(pet_id, owner, amount, deposit)
    }

    /// Owner only, after `unlock_epoch`.
    pub fn withdraw(&mut self, pet_id: TokenId) -> Promise {
        let owner = self.require_owner(&pet_id);
        self.require_direct(&pet_id);
        self.internal_withdraw(pet_id, owner)
    }

    #[private]
    pub fn on_stake(&mut self, pet_id: TokenId, owner: AccountId, amount: U128) -> bool {
        let mut pet = self.load_pet(&pet_id);
        pet.stakes_in_flight = pet.stakes_in_flight.saturating_sub(1);
        if !call_succeeded() {
            self.save_pet(&pet_id, pet);
            Promise::new(owner)
                .transfer(NearToken::from_yoctonear(amount.0))
                .detach();
            return false;
        }
        let recorded = amount.0;
        pet.staked += recorded;
        self.save_pet(&pet_id, pet);
        events::emit(
            "staked",
            json!({ "pet_id": pet_id, "owner": owner, "amount": U128(recorded) }),
        );
        true
    }

    #[private]
    pub fn on_unstake(
        &mut self,
        pet_id: TokenId,
        owner: AccountId,
        amount: U128,
        deposit: U128,
    ) -> bool {
        let mut pet = self.load_pet(&pet_id);
        if !call_succeeded() {
            pet.staked += amount.0;
            pet.pending_unstake = None;
            self.save_pet(&pet_id, pet);
            Promise::new(owner)
                .transfer(NearToken::from_yoctonear(deposit.0))
                .detach();
            return false;
        }
        events::emit(
            "unstaked",
            json!({ "pet_id": pet_id, "amount": amount, "pending": pet.pending_unstake }),
        );
        true
    }

    /// The pool's `withdraw` pays out principal and unstake deposit, so both go to the owner.
    #[private]
    pub fn on_withdraw(
        &mut self,
        pet_id: TokenId,
        owner: AccountId,
        amount: U128,
        deposit: U128,
    ) -> bool {
        if !call_succeeded() {
            let mut pet = self.load_pet(&pet_id);
            pet.pending_unstake = Some(PendingUnstake {
                amount,
                unlock_epoch: U64(env::epoch_height()),
                deposit,
            });
            self.save_pet(&pet_id, pet);
            return false;
        }
        Promise::new(owner.clone())
            .transfer(NearToken::from_yoctonear(amount.0 + deposit.0))
            .detach();
        events::emit(
            "unstake_withdrawn",
            json!({ "pet_id": pet_id, "owner": owner, "amount": amount, "deposit": deposit }),
        );
        true
    }

    /// Anyone; CREDIT can only go to `config.org_id`. The pool's `claim_deposit` is 0 today
    /// (`get_account`); if a pool upgrade raises it, attach it here like the unstake deposit.
    pub fn sweep_credit(&mut self) -> Promise {
        require!(
            env::prepaid_gas() >= MIN_PREPAID_SWEEP,
            "E_GAS: Attach at least 600 Tgas"
        );
        let pool = self.config.pool.clone();
        let args = json!({ "org_id": self.config.org_id });
        Promise::new(pool.clone())
            .function_call(
                "sync_from_farm".to_string(),
                b"{}".to_vec(),
                NearToken::from_yoctonear(0),
                SYNC_GAS,
            )
            .then(Promise::new(pool).function_call(
                "claim_and_topup".to_string(),
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                POOL_GAS,
            ))
            .then(self.callback().on_sweep())
    }

    #[private]
    pub fn on_sweep(&mut self) -> bool {
        match env::promise_result_checked(0, 1024) {
            Ok(result) => {
                events::emit(
                    "credit_swept",
                    json!({ "org_id": self.config.org_id, "result": String::from_utf8_lossy(&result) }),
                );
                true
            }
            Err(_) => false,
        }
    }
}

impl Contract {
    pub(crate) fn internal_stake(
        &mut self,
        pet_id: TokenId,
        owner: AccountId,
        amount: NearToken,
    ) -> Promise {
        self.require_pool_ready();
        let min = self.config.min_stake;
        require!(amount >= min, format!("E_MIN_STAKE: Stake at least {min}"));
        let mut pet = self.load_pet(&pet_id);
        pet.stakes_in_flight += 1;
        self.save_pet(&pet_id, pet);
        self.pool_call("deposit_and_stake", json!({}), amount)
            .then(
                self.callback()
                    .on_stake(pet_id, owner, U128(amount.as_yoctonear())),
            )
    }

    /// Checks `attached` covers `config.pool_unstake_deposit`, refunds the excess to `owner`,
    /// and returns the deposit to attach to the pool.
    pub(crate) fn take_unstake_deposit(&self, owner: &AccountId, attached: NearToken) -> u128 {
        let need = self.config.pool_unstake_deposit.as_yoctonear();
        let got = attached.as_yoctonear();
        require!(
            got >= need,
            format!("E_DEPOSIT: Attach {need} yocto for the pool unstake deposit")
        );
        if got > need {
            Promise::new(owner.clone())
                .transfer(NearToken::from_yoctonear(got - need))
                .detach();
        }
        need
    }

    /// `deposit` goes to the pool `unstake`; the pool needs at least 1 yocto (S6).
    pub(crate) fn internal_unstake(
        &mut self,
        pet_id: TokenId,
        owner: AccountId,
        amount: U128,
        deposit: u128,
    ) -> Promise {
        let deposit = deposit.max(1);
        let mut pet = self.load_pet(&pet_id);
        require!(
            pet.pending_unstake.is_none(),
            "E_UNSTAKE_PENDING: Unstake already pending"
        );
        require!(
            amount.0 > 0 && amount.0 <= pet.staked,
            "E_NO_STAKE: Not enough stake"
        );
        pet.staked -= amount.0;
        pet.pending_unstake = Some(PendingUnstake {
            amount,
            unlock_epoch: U64(env::epoch_height() + UNLOCK_EPOCHS),
            deposit: U128(deposit),
        });
        self.save_pet(&pet_id, pet);
        self.pool_call(
            "unstake",
            json!({ "amount": amount }),
            NearToken::from_yoctonear(deposit),
        )
        .then(
            self.callback()
                .on_unstake(pet_id, owner, amount, U128(deposit)),
        )
    }

    pub(crate) fn internal_withdraw(&mut self, pet_id: TokenId, owner: AccountId) -> Promise {
        let mut pet = self.load_pet(&pet_id);
        let pending = pet
            .pending_unstake
            .take()
            .unwrap_or_else(|| env::panic_str("E_NO_UNSTAKE: No unstake pending"));
        require!(
            env::epoch_height() >= pending.unlock_epoch.0,
            "E_LOCKED: Unstake still locked"
        );
        self.save_pet(&pet_id, pet);
        self.pool_call("withdraw", json!({}), NearToken::from_yoctonear(1))
            .then(
                self.callback()
                    .on_withdraw(pet_id, owner, pending.amount, pending.deposit),
            )
    }

    /// Value actions run directly only when approval mode is off (CLAUDE.md 7.3).
    pub(crate) fn require_direct(&self, pet_id: &TokenId) {
        require!(
            !self.stored_pet(pet_id).approval_mode,
            "E_APPROVAL_MODE: Approve this on your device"
        );
    }

    /// Pet stakes mint 1:1 only after the pool took its first-deposit fee from the house.
    pub(crate) fn require_pool_ready(&self) {
        require!(
            self.pool_registered,
            "E_POOL_NOT_READY: Admin must register the pool first"
        );
    }

    pub(crate) fn require_owner(&self, pet_id: &TokenId) -> AccountId {
        let owner = self.owner_of(pet_id);
        require!(
            env::predecessor_account_id() == owner,
            "E_NOT_OWNER: Only the owner"
        );
        owner
    }

    pub(crate) fn pool_call(&self, method: &str, args: Value, deposit: NearToken) -> Promise {
        require!(
            env::prepaid_gas() >= MIN_PREPAID,
            "E_GAS: Attach at least 430 Tgas"
        );
        Promise::new(self.config.pool.clone()).function_call(
            method.to_string(),
            args.to_string().into_bytes(),
            deposit,
            POOL_GAS,
        )
    }

    pub(crate) fn callback(&self) -> ContractExt {
        Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS)
    }
}

/// Only a failed call counts as failure; a long result still means success.
pub(crate) fn call_succeeded() -> bool {
    !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed))
}
