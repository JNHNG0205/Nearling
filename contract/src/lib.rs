//! Nearling pets contract. Spec: CLAUDE.md sections 6 and 7.

mod budget;
mod events;
mod nft;
mod pet;

use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_contract_standards::non_fungible_token::{NonFungibleToken, TokenId};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault};
use pet::{LifeState, Pet};

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
    tokens: NonFungibleToken,
    pets: LookupMap<TokenId, Pet>,
    next_id: u64,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Owners,
    TokenMetadata,
    Enumeration,
    Pets,
}

/// `get_pet` result: the pet settled to the current block time. Big numbers are strings.
#[near(serializers = [json])]
#[derive(Debug)]
pub struct PetView {
    pub id: TokenId,
    pub owner: AccountId,
    pub name: String,
    pub born_at_ns: U64,
    pub food_yocto: U128,
    pub credit_micro: u64,
    pub budget_micro: u64,
    pub fullness: u8,
    pub mood: u8,
    pub energy: u8,
    pub asleep_since_ns: Option<U64>,
    pub xp: u32,
    pub stage: u8,
    pub traits: [u8; 5],
    pub starving_since_ns: Option<U64>,
    pub life_state: LifeState,
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
            tokens: NonFungibleToken::new(
                StorageKey::Owners,
                env::current_account_id(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                None::<StorageKey>,
            ),
            pets: LookupMap::new(StorageKey::Pets),
            next_id: 0,
        }
    }

    /// Attach exactly `mint_storage + starter_food`. `mint_storage` stays in the contract to pay
    /// for the pet's storage; `starter_food` becomes the pet's food.
    #[payable]
    pub fn nft_mint_pet(&mut self, name: String) -> TokenId {
        let price = self
            .config
            .mint_storage
            .saturating_add(self.config.starter_food);
        require!(
            env::attached_deposit() == price,
            format!("Attach exactly {price}")
        );
        require!((1..=32).contains(&name.len()), "Name must be 1 to 32 bytes");

        let storage_before = env::storage_usage();
        let id = self.next_id.to_string();
        self.next_id += 1;
        let owner = env::predecessor_account_id();
        let seed = env::random_seed();
        let traits = [0, 1, 2, 3, 4].map(|i| seed[i] % 101);
        let pet = Pet::new(
            name.clone(),
            env::block_timestamp(),
            self.config.starter_food.as_yoctonear(),
            traits,
        );
        let metadata = TokenMetadata {
            title: Some(name),
            ..Default::default()
        };
        self.tokens
            .internal_mint_with_refund(id.clone(), owner.clone(), Some(metadata), None);
        self.pets.insert(id.clone(), pet);
        self.pets.flush();

        let used = env::storage_usage() - storage_before;
        require!(
            env::storage_byte_cost().saturating_mul(used as u128) <= self.config.mint_storage,
            "mint_storage does not cover storage"
        );
        NftMint {
            owner_id: &owner,
            token_ids: &[&id],
            memo: None,
        }
        .emit();
        id
    }

    pub fn get_pet(&self, pet_id: TokenId) -> PetView {
        let now = env::block_timestamp();
        let mut pet = self.stored_pet(&pet_id);
        pet.settle(now, &self.config);
        PetView {
            owner: self.owner_of(&pet_id),
            life_state: pet.life_state(now, &self.config),
            fullness: pet.fullness(&self.config),
            budget_micro: pet.budget_micro(&self.config),
            id: pet_id,
            name: pet.name,
            born_at_ns: pet.born_at_ns.into(),
            food_yocto: pet.food_yocto.into(),
            credit_micro: pet.credit_micro,
            mood: pet.mood,
            energy: pet.energy,
            asleep_since_ns: pet.asleep_since_ns.map(U64),
            xp: pet.xp,
            stage: pet.stage,
            traits: pet.traits,
            starving_since_ns: pet.starving_since_ns.map(U64),
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

impl Contract {
    fn stored_pet(&self, id: &TokenId) -> Pet {
        self.pets
            .get(id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown pet"))
    }

    fn owner_of(&self, id: &TokenId) -> AccountId {
        self.tokens
            .owner_by_id
            .get(id)
            .unwrap_or_else(|| env::panic_str("Unknown pet"))
    }

    /// Write path: load and settle to now, recording any life state change.
    pub(crate) fn load_pet(&self, id: &TokenId) -> Pet {
        let mut pet = self.stored_pet(id);
        pet.settle(env::block_timestamp(), &self.config);
        self.track_life_state(id, &mut pet);
        pet
    }

    pub(crate) fn save_pet(&mut self, id: &TokenId, mut pet: Pet) {
        self.track_life_state(id, &mut pet);
        self.pets.insert(id.clone(), pet);
    }

    /// Emits `dormant` / `revived` when a write observes the change (CLAUDE.md 7.1).
    fn track_life_state(&self, id: &TokenId, pet: &mut Pet) {
        let state = pet.life_state(env::block_timestamp(), &self.config);
        let was = pet.last_life_state;
        if state == LifeState::Dormant && was != LifeState::Dormant {
            events::emit("dormant", json!({ "pet_id": id }));
        } else if was == LifeState::Dormant && state != LifeState::Dormant {
            events::emit("revived", json!({ "pet_id": id }));
        }
        pet.last_life_state = state;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
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

    const DAY: u64 = 86_400_000_000_000;
    const MINT: NearToken = NearToken::from_millinear(200);

    fn ctx(who: AccountId, deposit: NearToken, ts: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who)
            .attached_deposit(deposit)
            .block_timestamp(ts)
            .build());
    }

    fn minted() -> (Contract, TokenId) {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        let id = contract.nft_mint_pet("Mochi".into());
        (contract, id)
    }

    fn events() -> Vec<String> {
        near_sdk::test_utils::get_logs()
            .into_iter()
            .filter_map(|l| l.strip_prefix("EVENT_JSON:").map(str::to_string))
            .collect()
    }

    #[test]
    fn mint_creates_pet_owned_by_caller_with_starter_food() {
        let (contract, id) = minted();
        assert_eq!(id, "0");
        let view = contract.get_pet(id.clone());
        assert_eq!(view.owner, accounts(3));
        assert_eq!(view.name, "Mochi");
        assert_eq!(
            view.food_yocto.0,
            NearToken::from_millinear(100).as_yoctonear()
        );
        assert_eq!(view.life_state, LifeState::Happy);
        assert_eq!(contract.nft_token(id).unwrap().owner_id, accounts(3));
        assert!(events().iter().any(|e| e.contains("nft_mint")));
    }

    #[test]
    fn mint_ids_increment() {
        let (mut contract, _) = minted();
        assert_eq!(contract.nft_mint_pet("Bao".into()), "1");
    }

    #[test]
    #[should_panic(expected = "Attach exactly 0.200 NEAR")]
    fn mint_rejects_wrong_deposit() {
        let mut contract = setup();
        ctx(accounts(3), NearToken::from_millinear(199), DAY);
        contract.nft_mint_pet("Mochi".into());
    }

    #[test]
    #[should_panic(expected = "Name must be 1 to 32 bytes")]
    fn mint_rejects_long_name() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        contract.nft_mint_pet("x".repeat(33));
    }

    #[test]
    fn mint_storage_is_covered_by_mint_storage() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        let before = env::storage_usage();
        contract.nft_mint_pet("x".repeat(32));
        let cost = env::storage_byte_cost().saturating_mul((env::storage_usage() - before) as u128);
        assert!(
            cost <= contract.config().mint_storage,
            "storage cost {cost}"
        );
    }

    #[test]
    fn get_pet_is_settled_to_block_time() {
        let (contract, id) = minted();
        ctx(accounts(4), NearToken::from_yoctonear(0), 2 * DAY);
        let view = contract.get_pet(id);
        assert_eq!(view.budget_micro, 20_000 - 1_000);
        assert_eq!(view.mood, pet::START_MOOD - 48);
    }

    #[test]
    #[should_panic(expected = "Unknown pet")]
    fn get_pet_rejects_unknown_id() {
        setup().get_pet("7".into());
    }

    #[test]
    fn anyone_can_feed() {
        let (mut contract, id) = minted();
        ctx(accounts(4), NearToken::from_near(1), DAY);
        contract.feed(id.clone());
        let view = contract.get_pet(id);
        assert_eq!(
            view.food_yocto.0,
            NearToken::from_millinear(1_100).as_yoctonear()
        );
        assert_eq!(view.mood, pet::START_MOOD + 5);
        assert!(events().iter().any(|e| e.contains("\"event\":\"fed\"")));
    }

    #[test]
    #[should_panic(expected = "Attach NEAR to feed")]
    fn feed_rejects_zero_deposit() {
        let (mut contract, id) = minted();
        ctx(accounts(4), NearToken::from_yoctonear(0), DAY);
        contract.feed(id);
    }

    #[test]
    fn feeding_a_dormant_pet_revives_it() {
        let (mut contract, id) = minted();
        // Starter food lasts 20 days, then 72 h starving.
        let later = DAY + 24 * DAY;
        ctx(accounts(4), NearToken::from_near(1), later);
        assert_eq!(contract.get_pet(id.clone()).life_state, LifeState::Dormant);
        contract.feed(id.clone());
        let view = contract.get_pet(id);
        assert_eq!(view.starving_since_ns, None);
        assert_eq!(
            view.life_state,
            LifeState::Sad,
            "fed, but mood decayed to 5"
        );
        let ev = events();
        assert!(ev.iter().any(|e| e.contains("\"event\":\"dormant\"")));
        assert!(ev.iter().any(|e| e.contains("\"event\":\"revived\"")));
    }

    #[test]
    fn big_numbers_are_json_strings() {
        let (contract, id) = minted();
        let json = near_sdk::serde_json::to_value(contract.get_pet(id)).unwrap();
        assert_eq!(json["food_yocto"], "100000000000000000000000");
        assert_eq!(json["born_at_ns"], DAY.to_string());
        assert!(json["starving_since_ns"].is_null());
    }
}
