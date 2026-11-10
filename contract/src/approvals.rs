//! Device approval flow (CLAUDE.md 7.3): the wallet proposes a value action, the pet's device
//! key approves it, and the contract runs it with the deposit held since the proposal.

use crate::pet::Pet;
use crate::{events, Contract, ContractExt};
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, NearToken, Promise, PromiseOrValue, PublicKey};

const ACTION_TTL_NS: u64 = 10 * 60 * 1_000_000_000;
/// Each pending action costs the contract storage, so the owner cannot spam them.
const MAX_PENDING: usize = 5;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    Stake { amount: U128 },
    Unstake { amount: U128 },
    Withdraw,
    StakeFromFood { amount: U128 },
    SetApprovalMode { on: bool },
    RegisterDevice { public_key: PublicKey },
    Transfer { receiver_id: AccountId },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingAction {
    pub id: U64,
    pub pet_id: TokenId,
    pub action: Action,
    pub deposit: U128,
    pub proposer_pk: PublicKey,
    pub expires_at_ns: U64,
}

#[near]
impl Contract {
    /// Owner only. Turning on needs a registered device; turning off needs a device approval.
    pub fn set_approval_mode(&mut self, pet_id: TokenId, on: bool) {
        self.require_owner(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        if on {
            require!(
                pet.device_pk.is_some(),
                "E_NOT_DEVICE: Register a device first"
            );
        } else {
            require!(
                !pet.approval_mode,
                "E_APPROVAL_MODE: Approve this on your device"
            );
        }
        pet.approval_mode = on;
        self.save_pet(&pet_id, pet);
    }

    /// Owner wallet, approval mode on. `Stake` attaches exactly `amount`; others attach nothing.
    #[payable]
    pub fn propose_action(&mut self, pet_id: TokenId, action: Action) -> U64 {
        self.require_owner(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        require!(pet.approval_mode, "E_APPROVAL_MODE: Approval mode is off");
        require!(
            pet.pending_actions.len() < MAX_PENDING,
            "E_TOO_MANY_ACTIONS: Approve or cancel pending actions first"
        );
        let deposit = env::attached_deposit();
        match &action {
            Action::Stake { amount } => {
                require!(
                    deposit.as_yoctonear() == amount.0,
                    "E_DEPOSIT: Attach exactly the stake amount"
                );
                let min = self.config.min_stake;
                require!(deposit >= min, format!("E_MIN_STAKE: Stake at least {min}"));
            }
            _ => require!(deposit.is_zero(), "E_DEPOSIT: Attach no deposit"),
        }
        let id = self.next_action_id;
        self.next_action_id += 1;
        let pending = PendingAction {
            id: U64(id),
            pet_id: pet_id.clone(),
            action,
            deposit: U128(deposit.as_yoctonear()),
            proposer_pk: env::signer_account_pk(),
            expires_at_ns: U64(env::block_timestamp() + ACTION_TTL_NS),
        };
        events::emit("action_proposed", json!(pending));
        self.actions.insert(id, pending);
        pet.pending_actions.push(id);
        self.save_pet(&pet_id, pet);
        U64(id)
    }

    /// The pet's device key only; never the key that proposed it.
    pub fn approve_action(&mut self, action_id: U64) -> PromiseOrValue<bool> {
        let pending = self.pending_action(action_id);
        let pet_id = pending.pet_id.clone();
        let owner = self.require_owner(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        let signer = env::signer_account_pk();
        require!(
            pet.device_pk.as_ref() == Some(&signer),
            "E_NOT_DEVICE: Only the pet's device"
        );
        require!(
            signer != pending.proposer_pk,
            "E_SAME_KEY: The proposing key cannot approve"
        );
        require!(
            env::block_timestamp() <= pending.expires_at_ns.0,
            "E_EXPIRED: Action expired"
        );
        require!(pet.approval_mode, "E_APPROVAL_MODE: Approval mode is off");
        self.actions.remove(&action_id.0);
        pet.pending_actions.retain(|id| *id != action_id.0);
        self.save_pet(&pet_id, pet);
        events::emit(
            "action_approved",
            json!({ "pet_id": pet_id, "action_id": action_id }),
        );
        match pending.action {
            Action::Stake { amount } => PromiseOrValue::Promise(self.internal_stake(
                pet_id,
                owner,
                NearToken::from_yoctonear(amount.0),
            )),
            Action::Unstake { amount } => {
                PromiseOrValue::Promise(self.internal_unstake(pet_id, amount))
            }
            Action::Withdraw => PromiseOrValue::Promise(self.internal_withdraw(pet_id, owner)),
            Action::StakeFromFood { amount } => {
                PromiseOrValue::Promise(self.internal_stake_from_food(pet_id, amount))
            }
            Action::SetApprovalMode { on } => {
                let mut pet = self.load_pet(&pet_id);
                pet.approval_mode = on;
                self.save_pet(&pet_id, pet);
                PromiseOrValue::Value(true)
            }
            Action::RegisterDevice { public_key } => {
                self.internal_register_device(pet_id, owner, public_key);
                PromiseOrValue::Value(true)
            }
            Action::Transfer { receiver_id } => {
                self.before_transfer(&pet_id);
                self.tokens
                    .internal_transfer(&owner, &receiver_id, &pet_id, None, None);
                PromiseOrValue::Value(true)
            }
        }
    }

    /// Owner only; refunds any held deposit (also for expired actions).
    pub fn cancel_action(&mut self, action_id: U64) {
        let pending = self.pending_action(action_id);
        let owner = self.require_owner(&pending.pet_id);
        let mut pet = self.load_pet(&pending.pet_id);
        pet.pending_actions.retain(|id| *id != action_id.0);
        self.cancel(&pending, &owner);
        self.save_pet(&pending.pet_id, pet);
    }

    pub fn get_pending_actions(&self, pet_id: TokenId) -> Vec<PendingAction> {
        self.stored_pet(&pet_id)
            .pending_actions
            .iter()
            .filter_map(|id| self.actions.get(id).cloned())
            .collect()
    }
}

impl Contract {
    fn pending_action(&self, action_id: U64) -> PendingAction {
        self.actions
            .get(&action_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str("E_NO_ACTION: Unknown action"))
    }

    /// Removes one action and refunds its deposit to the owner.
    fn cancel(&mut self, pending: &PendingAction, owner: &AccountId) {
        self.actions.remove(&pending.id.0);
        if pending.deposit.0 > 0 {
            Promise::new(owner.clone())
                .transfer(NearToken::from_yoctonear(pending.deposit.0))
                .detach();
        }
        events::emit(
            "action_cancelled",
            json!({ "pet_id": pending.pet_id, "action_id": pending.id }),
        );
    }

    /// On device change or transfer: every pending action is cancelled and refunded.
    pub(crate) fn drop_pending_actions(&mut self, pet: &mut Pet, owner: &AccountId) {
        for id in std::mem::take(&mut pet.pending_actions) {
            if let Some(pending) = self.actions.get(&id).cloned() {
                self.cancel(&pending, owner);
            }
        }
    }
}
