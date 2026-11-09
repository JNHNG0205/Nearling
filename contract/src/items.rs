//! Accessories from the config catalog (CLAUDE.md 5.6, P1).

use crate::{events, Contract, ContractExt};
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, Promise};

const MAX_ITEMS: usize = 5;

#[near]
impl Contract {
    /// Owner only; attach exactly the catalog price.
    #[payable]
    pub fn buy_item(&mut self, pet_id: TokenId, item_id: u16) {
        self.require_owner(&pet_id);
        let item = self
            .config
            .items
            .iter()
            .find(|i| i.id == item_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown item"));
        require!(
            env::attached_deposit() == item.price,
            format!("Attach exactly {}", item.price)
        );
        let mut pet = self.load_pet(&pet_id);
        require!(!pet.items.contains(&item_id), "Already owned");
        require!(pet.items.len() < MAX_ITEMS, "At most 5 items");
        pet.items.push(item_id);
        pet.mood = (pet.mood + item.mood_bonus).min(100);
        self.save_pet(&pet_id, pet);
        Promise::new(self.config.treasury.clone())
            .transfer(item.price)
            .detach();
        events::emit(
            "item_bought",
            json!({ "pet_id": pet_id, "item_id": item_id }),
        );
    }
}
