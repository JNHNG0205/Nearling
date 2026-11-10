//! Owner care actions (CLAUDE.md 7.2). The device key may sign these too: it is a limited
//! access key on the owner's account, so the predecessor is still the owner.

use crate::pet::PlayAction;
use crate::{events, Contract, ContractExt};
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::serde_json::json;
use near_sdk::{env, near};

#[near]
impl Contract {
    pub fn play(&mut self, pet_id: TokenId, action: PlayAction) {
        self.require_owner(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        let stage_up = pet
            .play(action, env::block_timestamp(), &self.config)
            .unwrap_or_else(|e| env::panic_str(e));
        self.save_pet(&pet_id, pet);
        events::emit("played", json!({ "pet_id": pet_id, "action": action }));
        self.emit_stage_up(&pet_id, stage_up);
    }
}
