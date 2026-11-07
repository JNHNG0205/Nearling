//! Nearling pets contract. Spec: CLAUDE.md sections 6 and 7.

use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault};

const MINUTE_NS: u64 = 60 * 1_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: u16,
    pub price: NearToken,
    pub mood_bonus: u8,
}

/// CLAUDE.md 7.1. Set by `admin` only.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub admin: AccountId,
    pub brain: AccountId,
    pub treasury: AccountId,
    pub pool: AccountId,
    pub org_id: String,
    pub farm_rate_micro_per_near_day: u64,
    pub near_usd_rate_micro: u64,
    pub mint_storage: NearToken,
    pub starter_food: NearToken,
    pub metabolism_micro_per_day: u64,
    pub charge_max_per_call_micro: u64,
    pub charge_max_per_day_micro: u64,
    pub xp_max_per_call: u32,
    pub xp_max_per_day: u32,
    pub mood_delta_max: u8,
    pub credit_correction_max_micro: u64,
    pub min_stake: NearToken,
    pub device_stake_min: NearToken,
    pub device_stake_max_per_action: NearToken,
    pub device_stake_max_per_day: NearToken,
    pub cooldown_pet_ns: u64,
    pub cooldown_play_ns: u64,
    pub items: Vec<Item>,
}

impl Config {
    /// Defaults from CLAUDE.md 7.1; tune later with `set_config`.
    pub fn with_defaults(
        admin: AccountId,
        brain: AccountId,
        treasury: AccountId,
        pool: AccountId,
        org_id: String,
    ) -> Self {
        Self {
            admin,
            brain,
            treasury,
            pool,
            org_id,
            farm_rate_micro_per_near_day: 657,
            near_usd_rate_micro: 200_000,
            mint_storage: NearToken::from_millinear(100),
            starter_food: NearToken::from_millinear(100),
            metabolism_micro_per_day: 1_000,
            charge_max_per_call_micro: 5_000,
            charge_max_per_day_micro: 100_000,
            xp_max_per_call: 5,
            xp_max_per_day: 50,
            mood_delta_max: 10,
            credit_correction_max_micro: 100_000,
            min_stake: NearToken::from_near(1),
            device_stake_min: NearToken::from_near(1),
            device_stake_max_per_action: NearToken::from_near(2),
            device_stake_max_per_day: NearToken::from_near(5),
            cooldown_pet_ns: 5 * MINUTE_NS,
            cooldown_play_ns: MINUTE_NS,
            items: Vec::new(),
        }
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    config: Config,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        admin: AccountId,
        brain: AccountId,
        treasury: AccountId,
        pool: AccountId,
        org_id: String,
    ) -> Self {
        Self {
            config: Config::with_defaults(admin, brain, treasury, pool, org_id),
        }
    }

    pub fn set_config(&mut self, config: Config) {
        require!(
            env::predecessor_account_id() == self.config.admin,
            "Only admin"
        );
        self.config = config;
    }

    pub fn config(&self) -> Config {
        self.config.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn setup() -> Contract {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(0))
            .build());
        Contract::new(
            accounts(0),
            accounts(1),
            accounts(2),
            "mw-pool-1024.testnet".parse().unwrap(),
            "org".into(),
        )
    }

    #[test]
    fn new_uses_spec_defaults() {
        let c = setup().config();
        assert_eq!(c.admin, accounts(0));
        assert_eq!(c.min_stake, NearToken::from_near(1));
        assert_eq!(c.charge_max_per_call_micro, 5_000);
    }

    #[test]
    fn admin_can_set_config() {
        let mut contract = setup();
        let mut c = contract.config();
        c.near_usd_rate_micro = 1;
        contract.set_config(c.clone());
        assert_eq!(contract.config(), c);
    }

    #[test]
    #[should_panic(expected = "Only admin")]
    fn non_admin_cannot_set_config() {
        let mut contract = setup();
        let c = contract.config();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .build());
        contract.set_config(c);
    }
}
