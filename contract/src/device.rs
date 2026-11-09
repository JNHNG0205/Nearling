//! Device key and device-signed value actions (CLAUDE.md 7.2, 7.3).

use crate::pet::day_of;
use crate::stake::call_succeeded;
use crate::{events, Contract, ContractExt};
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, NearToken, Promise, PublicKey};

const YOCTO_PER_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

#[near]
impl Contract {
    /// Owner only. Replaces any previous device key for this pet.
    pub fn register_device(&mut self, pet_id: TokenId, public_key: PublicKey) {
        self.require_owner(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        let old = pet.device_pk.replace(public_key.clone());
        self.save_pet(&pet_id, pet);
        if let Some(old) = old {
            events::emit(
                "device_cleared",
                json!({ "pet_id": pet_id, "public_key": old }),
            );
        }
        events::emit(
            "device_registered",
            json!({ "pet_id": pet_id, "public_key": public_key }),
        );
    }

    /// Device only: moves the pet's own food into its NEARON stake, within device caps.
    pub fn stake_from_food(&mut self, pet_id: TokenId, amount: U128) -> Promise {
        self.require_owner(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        require!(
            pet.device_pk.as_ref() == Some(&env::signer_account_pk()),
            "Only the pet's device"
        );
        let cfg = &self.config;
        let (min, max) = (cfg.device_stake_min, cfg.device_stake_max_per_action);
        require!(
            amount.0 >= min.as_yoctonear() && amount.0 <= max.as_yoctonear(),
            format!("Device stake must be {min} to {max}")
        );
        pet.roll_day(day_of(env::block_timestamp()));
        require!(
            pet.device_staked_today + amount.0 <= cfg.device_stake_max_per_day.as_yoctonear(),
            "Device daily stake cap"
        );
        let burn_micro = (cfg.metabolism_micro_per_day + pet.avg_daily_spend_micro) as u128;
        let reserve = (burn_micro * YOCTO_PER_NEAR).div_ceil(cfg.near_usd_rate_micro as u128);
        require!(pet.food_yocto >= amount.0 + reserve, "Keep a day of food");
        pet.food_yocto -= amount.0;
        pet.device_staked_today += amount.0;
        pet.stakes_in_flight += 1;
        self.save_pet(&pet_id, pet);
        self.pool_call(
            "deposit_and_stake",
            json!({}),
            NearToken::from_yoctonear(amount.0),
        )
        .then(self.callback().on_stake_from_food(pet_id, amount))
    }

    #[private]
    pub fn on_stake_from_food(&mut self, pet_id: TokenId, amount: U128) -> bool {
        let mut pet = self.load_pet(&pet_id);
        pet.stakes_in_flight = pet.stakes_in_flight.saturating_sub(1);
        if !call_succeeded() {
            pet.food_yocto += amount.0;
            pet.device_staked_today = pet.device_staked_today.saturating_sub(amount.0);
            self.save_pet(&pet_id, pet);
            return false;
        }
        let recorded = self.after_pool_fee(amount.0);
        pet.staked += recorded;
        self.save_pet(&pet_id, pet);
        events::emit(
            "staked_from_food",
            json!({ "pet_id": pet_id, "amount": U128(recorded) }),
        );
        true
    }
}
