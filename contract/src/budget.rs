//! Feeding (CLAUDE.md 7.2). Charge and credit come in M2.

use crate::{events, Contract, ContractExt};
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require};

#[near]
impl Contract {
    /// Anyone can feed any pet.
    #[payable]
    pub fn feed(&mut self, pet_id: TokenId) {
        let amount = env::attached_deposit();
        require!(!amount.is_zero(), "Attach NEAR to feed");
        let mut pet = self.load_pet(&pet_id);
        pet.food_yocto += amount.as_yoctonear();
        pet.mood = (pet.mood + 5).min(100);
        pet.starving_since_ns = None;
        self.save_pet(&pet_id, pet);
        events::emit(
            "fed",
            json!({ "pet_id": pet_id, "by": env::predecessor_account_id(), "amount": amount }),
        );
    }
}
