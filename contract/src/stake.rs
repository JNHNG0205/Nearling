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
/// Unstake epochs: current + farm delay (1 on testnet) + 1.
const UNLOCK_EPOCHS: u64 = 2;

#[near]
impl Contract {
    /// Owner only, at least `min_stake`.
    #[payable]
    pub fn stake(&mut self, pet_id: TokenId) -> Promise {
        let owner = self.require_owner(&pet_id);
        let amount = env::attached_deposit();
        let min = self.config.min_stake;
        require!(amount >= min, format!("Stake at least {min}"));
        let mut pet = self.load_pet(&pet_id);
        pet.stakes_in_flight += 1;
        self.save_pet(&pet_id, pet);
        self.pool_call("deposit_and_stake", json!({}), amount)
            .then(
                self.callback()
                    .on_stake(pet_id, owner, U128(amount.as_yoctonear())),
            )
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
        let recorded = self.after_pool_fee(amount.0);
        pet.staked += recorded;
        self.save_pet(&pet_id, pet);
        events::emit(
            "staked",
            json!({ "pet_id": pet_id, "owner": owner, "amount": U128(recorded) }),
        );
        true
    }

    /// Owner only; one pending unstake per pet, always treated as pending (S6).
    pub fn unstake(&mut self, pet_id: TokenId, amount: U128) -> Promise {
        self.require_owner(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        require!(pet.pending_unstake.is_none(), "Unstake already pending");
        require!(amount.0 > 0 && amount.0 <= pet.staked, "Not enough stake");
        pet.staked -= amount.0;
        pet.pending_unstake = Some(PendingUnstake {
            amount,
            unlock_epoch: U64(env::epoch_height() + UNLOCK_EPOCHS),
        });
        self.save_pet(&pet_id, pet);
        self.pool_call(
            "unstake",
            json!({ "amount": amount }),
            NearToken::from_yoctonear(1),
        )
        .then(self.callback().on_unstake(pet_id, amount))
    }

    #[private]
    pub fn on_unstake(&mut self, pet_id: TokenId, amount: U128) -> bool {
        let mut pet = self.load_pet(&pet_id);
        if !call_succeeded() {
            pet.staked += amount.0;
            pet.pending_unstake = None;
            self.save_pet(&pet_id, pet);
            return false;
        }
        events::emit(
            "unstaked",
            json!({ "pet_id": pet_id, "amount": amount, "pending": pet.pending_unstake }),
        );
        true
    }

    /// Owner only, after `unlock_epoch`.
    pub fn withdraw(&mut self, pet_id: TokenId) -> Promise {
        let owner = self.require_owner(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        let pending = pet
            .pending_unstake
            .take()
            .unwrap_or_else(|| env::panic_str("No unstake pending"));
        require!(
            env::epoch_height() >= pending.unlock_epoch.0,
            "Unstake still locked"
        );
        self.save_pet(&pet_id, pet);
        self.pool_call("withdraw", json!({}), NearToken::from_yoctonear(1))
            .then(self.callback().on_withdraw(pet_id, owner, pending.amount))
    }

    #[private]
    pub fn on_withdraw(&mut self, pet_id: TokenId, owner: AccountId, amount: U128) -> bool {
        if !call_succeeded() {
            let mut pet = self.load_pet(&pet_id);
            pet.pending_unstake = Some(PendingUnstake {
                amount,
                unlock_epoch: U64(env::epoch_height()),
            });
            self.save_pet(&pet_id, pet);
            return false;
        }
        Promise::new(owner.clone())
            .transfer(NearToken::from_yoctonear(amount.0))
            .detach();
        events::emit(
            "unstake_withdrawn",
            json!({ "pet_id": pet_id, "owner": owner, "amount": amount }),
        );
        true
    }

    /// Anyone; CREDIT can only go to `config.org_id`.
    pub fn sweep_credit(&mut self) -> Promise {
        let args = json!({ "org_id": self.config.org_id });
        self.pool_call("claim_and_topup", args, NearToken::from_yoctonear(0))
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
    /// The pool keeps a one-time fee from the contract's first deposit ever (S6).
    pub(crate) fn after_pool_fee(&mut self, amount: u128) -> u128 {
        if self.pool_registered {
            return amount;
        }
        self.pool_registered = true;
        amount - self.config.pool_first_deposit_fee.as_yoctonear()
    }

    pub(crate) fn require_owner(&self, pet_id: &TokenId) -> AccountId {
        let owner = self.owner_of(pet_id);
        require!(env::predecessor_account_id() == owner, "Only the owner");
        owner
    }

    pub(crate) fn pool_call(&self, method: &str, args: Value, deposit: NearToken) -> Promise {
        require!(
            env::prepaid_gas() >= MIN_PREPAID,
            "Attach at least 430 Tgas"
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
