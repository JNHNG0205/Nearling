//! Pantry: the owner's NEAR waiting to become food, so the device (whose function-call key cannot
//! attach NEAR) can feed the pet. Money never leaves the owner and the pet.

use crate::{events, Contract, ContractExt};
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, NearToken, Promise};

#[near]
impl Contract {
    /// Owner only, any amount. Direct even in approval mode: it adds money, like `feed`.
    #[payable]
    pub fn stock_pantry(&mut self, pet_id: TokenId) {
        let owner = self.require_owner(&pet_id);
        let amount = env::attached_deposit();
        require!(
            !amount.is_zero(),
            "E_DEPOSIT: Attach NEAR to stock the pantry"
        );
        let mut pet = self.load_pet(&pet_id);
        pet.pantry_yocto += amount.as_yoctonear();
        let pantry = U128(pet.pantry_yocto);
        self.save_pet(&pet_id, pet);
        events::emit(
            "pantry_stocked",
            json!({ "pet_id": pet_id, "owner": owner, "amount": amount, "pantry": pantry }),
        );
    }

    /// Device key or owner wallet, no deposit: moves pantry into food. The device is capped at
    /// `config.device_feed_max_per_day`; the wallet is not.
    pub fn feed_from_pantry(&mut self, pet_id: TokenId, amount: U128) {
        let owner = self.require_owner(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        require!(
            amount.0 > 0 && amount.0 <= pet.pantry_yocto,
            "E_PANTRY: Not enough in the pantry"
        );
        if pet.device_pk.as_ref() == Some(&env::signer_account_pk()) {
            require!(
                pet.device_fed_today + amount.0
                    <= self.config.device_feed_max_per_day.as_yoctonear(),
                "E_DEVICE_CAP: Device daily feeding cap"
            );
            pet.device_fed_today += amount.0;
        }
        pet.pantry_yocto -= amount.0;
        self.save_pet(&pet_id, pet);
        self.internal_feed(&pet_id, owner, amount.0, "pantry");
    }

    /// Owner only, gated by approval mode like `withdraw`: pantry NEAR back to the owner.
    pub fn empty_pantry(&mut self, pet_id: TokenId, amount: U128) {
        let owner = self.require_owner(&pet_id);
        self.require_direct(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        require!(
            amount.0 > 0 && amount.0 <= pet.pantry_yocto,
            "E_PANTRY: Not enough in the pantry"
        );
        pet.pantry_yocto -= amount.0;
        let pantry = U128(pet.pantry_yocto);
        self.save_pet(&pet_id, pet);
        Promise::new(owner.clone())
            .transfer(NearToken::from_yoctonear(amount.0))
            .detach();
        events::emit(
            "pantry_emptied",
            json!({ "pet_id": pet_id, "owner": owner, "amount": amount, "pantry": pantry }),
        );
    }
}
