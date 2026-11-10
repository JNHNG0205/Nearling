//! Feeding, brain billing and credit corrections (CLAUDE.md 7.2).

use crate::pet::{day_of, Thought};
use crate::{events, Contract, ContractExt};
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, NearToken, Promise};

#[near]
impl Contract {
    /// Anyone can feed any pet.
    #[payable]
    pub fn feed(&mut self, pet_id: TokenId) {
        let amount = env::attached_deposit();
        require!(!amount.is_zero(), "E_DEPOSIT: Attach NEAR to feed");
        let mut pet = self.load_pet(&pet_id);
        pet.food_yocto += amount.as_yoctonear();
        pet.mood = (pet.mood + 5).min(100);
        pet.starving_since_ns = None;
        let stage_up = if env::predecessor_account_id() == self.owner_of(&pet_id) {
            let xp = pet.check_in(day_of(env::block_timestamp()));
            pet.add_xp(xp)
        } else {
            None
        };
        self.save_pet(&pet_id, pet);
        self.emit_stage_up(&pet_id, stage_up);
        events::emit(
            "fed",
            json!({ "pet_id": pet_id, "by": env::predecessor_account_id(), "amount": amount }),
        );
    }

    /// Brain only. Never panics for lack of funds or over-cap values: everything is clamped.
    pub fn charge(
        &mut self,
        pet_id: TokenId,
        cost_micro_usd: u64,
        usage_ref: String,
        trait_deltas: Option<[i8; 5]>,
        xp_gain: u32,
        mood_delta: i8,
    ) {
        self.require_brain();
        let mut pet = self.load_pet(&pet_id);
        let hash = env::sha256_array(usage_ref.as_bytes());
        if !pet.remember_usage(u64::from_le_bytes(hash[..8].try_into().unwrap())) {
            return;
        }
        let thought = Thought {
            cost_micro: cost_micro_usd,
            xp_gain,
            mood_delta,
            trait_deltas: trait_deltas.unwrap_or([0; 5]),
        };
        let out = pet.apply_thought(thought, env::block_timestamp(), &self.config);
        self.save_pet(&pet_id, pet);
        if out.food_yocto > 0 {
            Promise::new(self.config.treasury.clone())
                .transfer(NearToken::from_yoctonear(out.food_yocto))
                .detach();
        }
        let source = match (out.from_credit_micro, out.food_yocto) {
            (0, 0) => "none",
            (_, 0) => "credit",
            (0, _) => "food",
            _ => "mixed",
        };
        events::emit(
            "thought",
            json!({
                "pet_id": pet_id,
                "cost_micro": out.charged_micro,
                "usage_ref": usage_ref,
                "source": source,
            }),
        );
        self.emit_stage_up(&pet_id, out.stage_up);
    }

    /// Brain only, capped correction (credit normally accrues lazily from stake).
    pub fn credit(&mut self, pet_id: TokenId, micro_usd: u64, r#ref: String) {
        self.require_brain();
        require!(
            micro_usd <= self.config.credit_correction_max_micro,
            "E_CREDIT_CAP: Credit above correction cap"
        );
        let mut pet = self.load_pet(&pet_id);
        pet.credit_micro = pet.credit_micro.saturating_add(micro_usd);
        if pet.budget_micro(&self.config) > 0 {
            pet.starving_since_ns = None;
        }
        self.save_pet(&pet_id, pet);
        events::emit(
            "credited",
            json!({ "pet_id": pet_id, "micro_usd": micro_usd, "ref": r#ref }),
        );
    }
}

impl Contract {
    fn require_brain(&self) {
        require!(
            env::predecessor_account_id() == self.config.brain,
            "E_NOT_BRAIN: Only brain"
        );
    }

    pub(crate) fn emit_stage_up(&self, pet_id: &TokenId, stage: Option<u8>) {
        if let Some(stage) = stage {
            events::emit("stage_up", json!({ "pet_id": pet_id, "stage": stage }));
        }
    }
}
