//! Nearling pets contract. Spec: CLAUDE.md sections 6 and 7.

mod budget;
mod device;
mod events;
mod items;
mod nft;
mod pet;
mod play;
mod stake;

use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_contract_standards::non_fungible_token::{NonFungibleToken, TokenId};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PublicKey,
};
use pet::{LifeState, PendingUnstake, Pet};

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
    /// Taken once by the pool on the contract's first deposit (S6: 0.0055 NEAR).
    pub pool_first_deposit_fee: NearToken,
    pub device_stake_min: NearToken,
    pub device_stake_max_per_action: NearToken,
    pub device_stake_max_per_day: NearToken,
    pub cooldown_pet_ns: u64,
    pub cooldown_play_ns: u64,
    pub mood_ns_per_point: u64,
    pub energy_ns_per_point: u64,
    pub dormant_after_ns: u64,
    /// Fast rates for judges; clients label this deployment "demo speed".
    pub demo_speed: bool,
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
            pool_first_deposit_fee: NearToken::from_micronear(5_500),
            device_stake_min: NearToken::from_near(1),
            device_stake_max_per_action: NearToken::from_near(2),
            device_stake_max_per_day: NearToken::from_near(5),
            cooldown_pet_ns: 5 * MINUTE_NS,
            cooldown_play_ns: MINUTE_NS,
            mood_ns_per_point: pet::MOOD_NS_PER_POINT,
            energy_ns_per_point: pet::ENERGY_NS_PER_POINT,
            dormant_after_ns: pet::DORMANT_AFTER_NS,
            demo_speed: false,
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
    /// The pool has taken its first-deposit fee from this contract.
    pool_registered: bool,
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
    pub staked: U128,
    pub pending_unstake: Option<PendingUnstake>,
    pub daily_credit_micro: u64,
    pub daily_burn_micro: u64,
    pub self_sustaining: bool,
    pub items: Vec<u16>,
    pub device_pk: Option<PublicKey>,
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
            pool_registered: false,
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
            format!("E_DEPOSIT: Attach exactly {price}")
        );
        require!(
            (1..=32).contains(&name.len()),
            "E_NAME: Name must be 1 to 32 bytes"
        );

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
            "E_STORAGE: mint_storage does not cover storage"
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
        let cfg = &self.config;
        PetView {
            owner: self.owner_of(&pet_id),
            life_state: pet.life_state(now, cfg),
            fullness: pet.fullness(cfg),
            budget_micro: pet.budget_micro(cfg),
            daily_credit_micro: pet.daily_credit_micro(cfg),
            daily_burn_micro: pet.daily_burn_micro(cfg),
            self_sustaining: pet.self_sustaining(cfg),
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
            staked: pet.staked.into(),
            pending_unstake: pet.pending_unstake,
            items: pet.items,
            device_pk: pet.device_pk,
        }
    }

    pub fn set_config(&mut self, config: Config) {
        require!(
            env::predecessor_account_id() == self.config.admin,
            "E_NOT_ADMIN: Only admin"
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
            .unwrap_or_else(|| env::panic_str("E_UNKNOWN_PET: Unknown pet"))
    }

    fn owner_of(&self, id: &TokenId) -> AccountId {
        self.tokens
            .owner_by_id
            .get(id)
            .unwrap_or_else(|| env::panic_str("E_UNKNOWN_PET: Unknown pet"))
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
    use near_sdk::json_types::U128;
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
        assert_eq!(c.mood_ns_per_point, 30 * MINUTE_NS);
        assert_eq!(c.energy_ns_per_point, 450 * 1_000_000_000);
        assert_eq!(c.dormant_after_ns, 72 * 60 * MINUTE_NS);
        assert!(!c.demo_speed);
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
    #[should_panic(expected = "E_NOT_ADMIN: Only admin")]
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
    #[should_panic(expected = "E_DEPOSIT: Attach exactly 0.200 NEAR")]
    fn mint_rejects_wrong_deposit() {
        let mut contract = setup();
        ctx(accounts(3), NearToken::from_millinear(199), DAY);
        contract.nft_mint_pet("Mochi".into());
    }

    #[test]
    #[should_panic(expected = "E_NAME: Name must be 1 to 32 bytes")]
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
    #[should_panic(expected = "E_UNKNOWN_PET: Unknown pet")]
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
    #[should_panic(expected = "E_DEPOSIT: Attach NEAR to feed")]
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

    fn as_brain(ts: u64) {
        ctx(accounts(1), NearToken::from_yoctonear(0), ts);
    }

    /// One charge with a fresh usage_ref (repeats are no-ops, C2).
    fn chat(contract: &mut Contract, id: &TokenId, cost: u64, xp: u32) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let usage_ref = format!("inf-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        contract.charge(id.clone(), cost, usage_ref, None, xp, 0);
    }

    fn transfers_to(who: &AccountId) -> Vec<NearToken> {
        near_sdk::test_utils::get_created_receipts()
            .into_iter()
            .filter(|r| &r.receiver_id == who)
            .flat_map(|r| r.actions)
            .filter_map(|a| match a {
                near_sdk::mock::MockAction::Transfer { deposit, .. } => Some(deposit),
                _ => None,
            })
            .collect()
    }

    #[test]
    #[should_panic(expected = "E_NOT_BRAIN: Only brain")]
    fn charge_by_non_brain_is_rejected() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        chat(&mut contract, &id, 100, 0);
    }

    #[test]
    fn charge_sends_spent_food_to_treasury_and_emits_thought() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        chat(&mut contract, &id, 1_000, 0);
        // $0.001 at $0.20 per NEAR = 0.005 NEAR
        assert_eq!(
            transfers_to(&accounts(2)),
            vec![NearToken::from_millinear(5)]
        );
        assert_eq!(contract.get_pet(id).budget_micro, 19_000);
        let ev = events();
        assert!(ev.iter().any(|e| e.contains("\"event\":\"thought\"")
            && e.contains("\"cost_micro\":1000")
            && e.contains("\"usage_ref\":\"inf-")));
    }

    #[test]
    fn charge_on_a_starving_pet_succeeds_and_costs_nothing() {
        let (mut contract, id) = minted();
        as_brain(DAY + 30 * DAY);
        chat(&mut contract, &id, 5_000, 0);
        assert!(transfers_to(&accounts(2)).is_empty());
        assert!(events().iter().any(|e| e.contains("\"cost_micro\":0")));
    }

    #[test]
    fn charge_emits_stage_up_when_xp_crosses_a_threshold() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        chat(&mut contract, &id, 0, 5); // 5 + 2 check-in
        chat(&mut contract, &id, 0, 5); // 12
        let view = contract.get_pet(id);
        assert_eq!((view.xp, view.stage), (12, 1));
        let ups = events().iter().filter(|e| e.contains("stage_up")).count();
        assert_eq!(ups, 1);
    }

    #[test]
    fn credit_adds_to_budget_and_revives_a_starving_pet() {
        let (mut contract, id) = minted();
        as_brain(DAY + 22 * DAY);
        contract.credit(id.clone(), 3_000, "reconcile-1".into());
        let view = contract.get_pet(id);
        assert_eq!(view.credit_micro, 3_000);
        assert_eq!(view.starving_since_ns, None);
        assert!(events()
            .iter()
            .any(|e| e.contains("\"event\":\"credited\"")));
    }

    #[test]
    #[should_panic(expected = "E_NOT_BRAIN: Only brain")]
    fn credit_by_non_brain_is_rejected() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.credit(id, 1, "x".into());
    }

    #[test]
    #[should_panic(expected = "E_CREDIT_CAP: Credit above correction cap")]
    fn credit_above_cap_is_rejected() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        contract.credit(id, 100_001, "x".into());
    }

    #[test]
    fn owner_feeding_counts_as_daily_check_in() {
        let (mut contract, id) = minted();
        ctx(accounts(4), NearToken::from_near(1), DAY);
        contract.feed(id.clone());
        assert_eq!(
            contract.get_pet(id.clone()).xp,
            0,
            "stranger feeding is not a check-in"
        );
        ctx(accounts(3), NearToken::from_near(1), DAY);
        contract.feed(id.clone());
        assert_eq!(contract.get_pet(id).xp, 2);
    }

    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const FEE: u128 = 5_500_000_000_000_000_000_000;

    fn pool() -> AccountId {
        "mw-pool-1024.testnet".parse().unwrap()
    }

    fn ctx_full(who: AccountId, deposit: NearToken, ts: u64, epoch: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who)
            .attached_deposit(deposit)
            .block_timestamp(ts)
            .epoch_height(epoch)
            .prepaid_gas(near_sdk::Gas::from_tgas(450))
            .build());
    }

    /// Context for a `#[private]` callback seeing one promise result.
    fn callback(ok: bool) {
        let result = if ok {
            near_sdk::PromiseResult::Successful(b"null".to_vec())
        } else {
            near_sdk::PromiseResult::Failed
        };
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(accounts(0))
                .block_timestamp(DAY)
                .epoch_height(10)
                .build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![result],
        );
    }

    /// (method, args, deposit yocto, gas Tgas) of each call to the pool.
    fn pool_calls() -> Vec<(String, String, u128, u64)> {
        near_sdk::test_utils::get_created_receipts()
            .into_iter()
            .filter(|r| r.receiver_id == pool())
            .flat_map(|r| r.actions)
            .filter_map(|a| match a {
                near_sdk::mock::MockAction::FunctionCallWeight {
                    method_name,
                    args,
                    attached_deposit,
                    prepaid_gas,
                    ..
                } => Some((
                    String::from_utf8(method_name).unwrap(),
                    String::from_utf8(args).unwrap(),
                    attached_deposit.as_yoctonear(),
                    prepaid_gas.as_tgas(),
                )),
                _ => None,
            })
            .collect()
    }

    /// Minted pet with `near` NEAR staked (first stake pays the pool fee).
    fn staked(near: u128) -> (Contract, TokenId) {
        let (mut contract, id) = minted();
        callback(true);
        contract.on_stake(id.clone(), accounts(3), U128(near * NEAR));
        (contract, id)
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER: Only the owner")]
    fn stake_by_non_owner_is_rejected() {
        let (mut contract, id) = minted();
        ctx_full(accounts(4), NearToken::from_near(2), DAY, 10);
        let _ = contract.stake(id);
    }

    #[test]
    #[should_panic(expected = "E_MIN_STAKE: Stake at least")]
    fn stake_below_minimum_is_rejected() {
        let (mut contract, id) = minted();
        ctx_full(accounts(3), NearToken::from_millinear(999), DAY, 10);
        let _ = contract.stake(id);
    }

    #[test]
    fn stake_deposits_into_the_pool() {
        let (mut contract, id) = minted();
        ctx_full(accounts(3), NearToken::from_near(10), DAY, 10);
        let _ = contract.stake(id);
        assert_eq!(
            pool_calls(),
            vec![("deposit_and_stake".into(), "{}".into(), 10 * NEAR, 400)]
        );
    }

    #[test]
    fn successful_stake_is_recorded_less_the_one_time_pool_fee() {
        let (mut contract, id) = staked(10);
        assert_eq!(contract.get_pet(id.clone()).staked.0, 10 * NEAR - FEE);
        assert!(events().iter().any(|e| e.contains("\"event\":\"staked\"")));
        callback(true);
        contract.on_stake(id.clone(), accounts(3), U128(NEAR));
        assert_eq!(
            contract.get_pet(id).staked.0,
            11 * NEAR - FEE,
            "fee only once"
        );
    }

    #[test]
    fn failed_stake_refunds_the_owner() {
        let (mut contract, id) = minted();
        callback(false);
        assert!(!contract.on_stake(id.clone(), accounts(3), U128(10 * NEAR)));
        assert_eq!(transfers_to(&accounts(3)), vec![NearToken::from_near(10)]);
        assert_eq!(contract.get_pet(id).staked.0, 0);
    }

    #[test]
    fn get_pet_shows_self_sustaining_with_enough_stake() {
        let (contract, id) = staked(10);
        let view = contract.get_pet(id);
        assert_eq!(
            view.daily_credit_micro, 6_566,
            "9.9945 NEAR after the pool fee"
        );
        assert!(view.self_sustaining);
    }

    #[test]
    fn unstake_calls_the_pool_with_one_yocto_and_locks_the_amount() {
        let (mut contract, id) = staked(10);
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 10);
        let _ = contract.unstake(id.clone(), U128(2 * NEAR));
        let args = format!("{{\"amount\":\"{}\"}}", 2 * NEAR);
        assert_eq!(pool_calls(), vec![("unstake".into(), args, 1, 400)]);
        let view = contract.get_pet(id);
        assert_eq!(view.staked.0, 8 * NEAR - FEE);
        let pending = view.pending_unstake.unwrap();
        assert_eq!((pending.amount.0, pending.unlock_epoch.0), (2 * NEAR, 12));
    }

    #[test]
    #[should_panic(expected = "E_UNSTAKE_PENDING: Unstake already pending")]
    fn second_unstake_while_pending_is_rejected() {
        let (mut contract, id) = staked(10);
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 10);
        let _ = contract.unstake(id.clone(), U128(NEAR));
        let _ = contract.unstake(id, U128(NEAR));
    }

    #[test]
    #[should_panic(expected = "E_NO_STAKE: Not enough stake")]
    fn unstake_more_than_staked_is_rejected() {
        let (mut contract, id) = staked(1);
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 10);
        let _ = contract.unstake(id, U128(NEAR));
    }

    #[test]
    fn failed_unstake_restores_stake() {
        let (mut contract, id) = staked(10);
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 10);
        let _ = contract.unstake(id.clone(), U128(2 * NEAR));
        callback(false);
        contract.on_unstake(id.clone(), U128(2 * NEAR));
        let view = contract.get_pet(id);
        assert_eq!(view.staked.0, 10 * NEAR - FEE);
        assert!(view.pending_unstake.is_none());
    }

    fn unstaked_2() -> (Contract, TokenId) {
        let (mut contract, id) = staked(10);
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 10);
        let _ = contract.unstake(id.clone(), U128(2 * NEAR));
        callback(true);
        contract.on_unstake(id.clone(), U128(2 * NEAR));
        (contract, id)
    }

    #[test]
    #[should_panic(expected = "E_LOCKED: Unstake still locked")]
    fn withdraw_before_unlock_is_rejected() {
        let (mut contract, id) = unstaked_2();
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 11);
        let _ = contract.withdraw(id);
    }

    #[test]
    fn withdraw_after_unlock_pays_the_owner() {
        let (mut contract, id) = unstaked_2();
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 12);
        let _ = contract.withdraw(id.clone());
        assert_eq!(pool_calls(), vec![("withdraw".into(), "{}".into(), 1, 400)]);
        callback(true);
        contract.on_withdraw(id.clone(), accounts(3), U128(2 * NEAR));
        assert_eq!(transfers_to(&accounts(3)), vec![NearToken::from_near(2)]);
        assert!(contract.get_pet(id).pending_unstake.is_none());
        assert!(events().iter().any(|e| e.contains("unstake_withdrawn")));
    }

    #[test]
    fn failed_withdraw_keeps_the_unstake_pending() {
        let (mut contract, id) = unstaked_2();
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 12);
        let _ = contract.withdraw(id.clone());
        callback(false);
        contract.on_withdraw(id.clone(), accounts(3), U128(2 * NEAR));
        assert!(transfers_to(&accounts(3)).is_empty());
        assert!(contract.get_pet(id).pending_unstake.is_some());
    }

    #[test]
    fn anyone_can_sweep_credit_to_the_configured_org() {
        let mut contract = setup();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(4))
            .prepaid_gas(near_sdk::Gas::from_tgas(650))
            .build());
        let _ = contract.sweep_credit();
        let args = "{\"org_id\":\"org\"}".to_string();
        assert_eq!(
            pool_calls(),
            vec![
                ("sync_from_farm".into(), "{}".into(), 0, 150),
                ("claim_and_topup".into(), args, 0, 400)
            ]
        );
        callback(true);
        contract.on_sweep();
        assert!(events().iter().any(|e| e.contains("credit_swept")));
    }

    fn device_pk() -> PublicKey {
        "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
            .parse()
            .unwrap()
    }

    fn wallet_pk() -> PublicKey {
        "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847"
            .parse()
            .unwrap()
    }

    /// Call signed by `pk` on account `who` (device key or wallet key).
    fn ctx_signed(who: AccountId, pk: PublicKey, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who.clone())
            .signer_account_id(who)
            .signer_account_pk(pk)
            .attached_deposit(deposit)
            .block_timestamp(DAY)
            .epoch_height(10)
            .prepaid_gas(near_sdk::Gas::from_tgas(450))
            .build());
    }

    /// Minted pet with 3 NEAR of extra food and a registered device.
    fn with_device() -> (Contract, TokenId) {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_near(3), DAY);
        contract.feed(id.clone());
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.register_device(id.clone(), device_pk());
        (contract, id)
    }

    fn device_stake(contract: &mut Contract, id: &TokenId, near_milli: u128) {
        ctx_signed(accounts(3), device_pk(), NearToken::from_yoctonear(0));
        let _ = contract.stake_from_food(id.clone(), U128(near_milli * NEAR / 1_000));
    }

    #[test]
    fn owner_play_emits_played() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.play(id.clone(), pet::PlayAction::Pet);
        assert_eq!(contract.get_pet(id).mood, pet::START_MOOD + 3);
        assert!(events().iter().any(|e| e.contains("\"event\":\"played\"")));
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER: Only the owner")]
    fn stranger_cannot_play() {
        let (mut contract, id) = minted();
        ctx(accounts(4), NearToken::from_yoctonear(0), DAY);
        contract.play(id, pet::PlayAction::Pet);
    }

    #[test]
    #[should_panic(expected = "E_COOLDOWN: ")]
    fn petting_twice_inside_the_cooldown_is_rejected() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.play(id.clone(), pet::PlayAction::Pet);
        contract.play(id, pet::PlayAction::Pet);
    }

    #[test]
    fn register_device_stores_the_key_and_replacing_it_emits_device_cleared() {
        let (mut contract, id) = with_device();
        assert_eq!(contract.get_pet(id.clone()).device_pk, Some(device_pk()));
        assert!(events().iter().any(|e| e.contains("device_registered")));
        contract.register_device(id.clone(), wallet_pk());
        assert_eq!(contract.get_pet(id).device_pk, Some(wallet_pk()));
        assert!(events().iter().any(|e| e.contains("device_cleared")));
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER: Only the owner")]
    fn stranger_cannot_register_a_device() {
        let (mut contract, id) = minted();
        ctx(accounts(4), NearToken::from_yoctonear(0), DAY);
        contract.register_device(id, device_pk());
    }

    #[test]
    fn device_moves_food_into_stake() {
        let (mut contract, id) = with_device();
        device_stake(&mut contract, &id, 1_000);
        assert_eq!(
            pool_calls(),
            vec![("deposit_and_stake".into(), "{}".into(), NEAR, 400)]
        );
        assert_eq!(
            contract.get_pet(id.clone()).food_yocto.0,
            3_100 * NEAR / 1_000 - NEAR
        );
        callback(true);
        contract.on_stake_from_food(id.clone(), U128(NEAR));
        assert_eq!(contract.get_pet(id).staked.0, NEAR - FEE);
        assert!(events().iter().any(|e| e.contains("staked_from_food")));
    }

    #[test]
    fn failed_device_stake_returns_the_food() {
        let (mut contract, id) = with_device();
        device_stake(&mut contract, &id, 1_000);
        callback(false);
        contract.on_stake_from_food(id.clone(), U128(NEAR));
        let view = contract.get_pet(id);
        assert_eq!(view.food_yocto.0, 3_100 * NEAR / 1_000);
        assert_eq!(view.staked.0, 0);
    }

    #[test]
    #[should_panic(expected = "E_NOT_DEVICE: Only the pet's device")]
    fn wallet_key_cannot_use_the_device_method() {
        let (mut contract, id) = with_device();
        ctx_signed(accounts(3), wallet_pk(), NearToken::from_yoctonear(0));
        let _ = contract.stake_from_food(id, U128(NEAR));
    }

    #[test]
    #[should_panic(expected = "E_DEVICE_CAP: Device stake must be")]
    fn device_stake_below_one_near_is_rejected() {
        let (mut contract, id) = with_device();
        device_stake(&mut contract, &id, 990);
    }

    #[test]
    #[should_panic(expected = "E_DEVICE_CAP: Device stake must be")]
    fn device_stake_above_two_near_is_rejected() {
        let (mut contract, id) = with_device();
        device_stake(&mut contract, &id, 2_010);
    }

    #[test]
    #[should_panic(expected = "E_DEVICE_CAP: Device daily stake cap")]
    fn device_stake_is_capped_per_day() {
        let (mut contract, id) = with_device();
        ctx(accounts(3), NearToken::from_near(10), DAY);
        contract.feed(id.clone());
        device_stake(&mut contract, &id, 2_000);
        device_stake(&mut contract, &id, 2_000);
        device_stake(&mut contract, &id, 1_001); // 5.001 NEAR
    }

    #[test]
    #[should_panic(expected = "E_FOOD_RESERVE: Keep a day of food")]
    fn device_stake_keeps_one_day_of_food() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_millinear(900), DAY);
        contract.feed(id.clone()); // 1.0 NEAR of food in total
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.register_device(id.clone(), device_pk());
        device_stake(&mut contract, &id, 1_000);
    }

    #[test]
    #[should_panic(expected = "E_STAKED: Unstake and withdraw before transfer")]
    fn transfer_is_blocked_while_staked() {
        let (mut contract, id) = staked(2);
        ctx(accounts(3), NearToken::from_yoctonear(1), DAY);
        contract.nft_transfer(accounts(4), id, None, None);
    }

    #[test]
    #[should_panic(expected = "E_STAKED: Unstake and withdraw before transfer")]
    fn transfer_is_blocked_while_a_stake_is_in_flight() {
        let (mut contract, id) = minted();
        ctx_full(accounts(3), NearToken::from_near(2), DAY, 10);
        let _ = contract.stake(id.clone());
        ctx(accounts(3), NearToken::from_yoctonear(1), DAY);
        contract.nft_transfer(accounts(4), id, None, None);
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER: Only the owner")]
    fn transfer_clears_the_device_so_the_old_owner_device_stops_working() {
        let (mut contract, id) = with_device();
        ctx(accounts(3), NearToken::from_yoctonear(1), DAY);
        contract.nft_transfer(accounts(4), id.clone(), None, None);
        let view = contract.get_pet(id.clone());
        assert_eq!((view.owner, view.device_pk), (accounts(4), None));
        assert!(events().iter().any(|e| e.contains("device_cleared")));
        device_stake(&mut contract, &id, 1_000);
    }

    fn with_shop() -> (Contract, TokenId) {
        let (mut contract, id) = minted();
        let mut cfg = contract.config();
        cfg.items = vec![Item {
            id: 1,
            price: NearToken::from_millinear(500),
            mood_bonus: 4,
        }];
        ctx(accounts(0), NearToken::from_yoctonear(0), DAY);
        contract.set_config(cfg);
        (contract, id)
    }

    #[test]
    fn buying_an_item_pays_the_treasury_and_lifts_mood() {
        let (mut contract, id) = with_shop();
        ctx(accounts(3), NearToken::from_millinear(500), DAY);
        contract.buy_item(id.clone(), 1);
        let view = contract.get_pet(id);
        assert_eq!(view.items, vec![1]);
        assert_eq!(view.mood, pet::START_MOOD + 4);
        assert_eq!(
            transfers_to(&accounts(2)),
            vec![NearToken::from_millinear(500)]
        );
        assert!(events().iter().any(|e| e.contains("item_bought")));
    }

    #[test]
    #[should_panic(expected = "E_ITEM: Already owned")]
    fn buying_the_same_item_twice_is_rejected() {
        let (mut contract, id) = with_shop();
        ctx(accounts(3), NearToken::from_millinear(500), DAY);
        contract.buy_item(id.clone(), 1);
        contract.buy_item(id, 1);
    }

    #[test]
    #[should_panic(expected = "E_DEPOSIT: Attach exactly")]
    fn buying_with_the_wrong_price_is_rejected() {
        let (mut contract, id) = with_shop();
        ctx(accounts(3), NearToken::from_millinear(400), DAY);
        contract.buy_item(id, 1);
    }

    #[test]
    #[should_panic(expected = "E_ITEM: Unknown item")]
    fn buying_an_unknown_item_is_rejected() {
        let (mut contract, id) = with_shop();
        ctx(accounts(3), NearToken::from_millinear(500), DAY);
        contract.buy_item(id, 9);
    }

    #[test]
    #[should_panic(expected = "E_ITEM: At most 5 items")]
    fn a_pet_holds_at_most_five_items() {
        let (mut contract, id) = minted();
        let mut cfg = contract.config();
        cfg.items = (1..=6)
            .map(|i| Item {
                id: i,
                price: NearToken::from_millinear(1),
                mood_bonus: 0,
            })
            .collect();
        ctx(accounts(0), NearToken::from_yoctonear(0), DAY);
        contract.set_config(cfg);
        ctx(accounts(3), NearToken::from_millinear(1), DAY);
        for i in 1..=6 {
            contract.buy_item(id.clone(), i);
        }
    }

    #[test]
    #[should_panic(expected = "E_GAS: Attach at least 430 Tgas")]
    fn pool_calls_need_enough_gas() {
        let (mut contract, id) = minted();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(3))
            .attached_deposit(NearToken::from_near(2))
            .block_timestamp(DAY)
            .prepaid_gas(near_sdk::Gas::from_tgas(300))
            .build());
        let _ = contract.stake(id);
    }

    #[test]
    #[should_panic(expected = "E_GAS: Attach at least 600 Tgas")]
    fn sweep_needs_gas_for_both_pool_calls() {
        let mut contract = setup();
        ctx_full(accounts(4), NearToken::from_yoctonear(0), DAY, 10); // 450 Tgas
        let _ = contract.sweep_credit();
    }

    #[test]
    #[should_panic(expected = "E_NO_UNSTAKE: No unstake pending")]
    fn withdraw_without_unstake_is_rejected() {
        let (mut contract, id) = staked(2);
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 10);
        let _ = contract.withdraw(id);
    }

    fn thought_events() -> Vec<String> {
        events()
            .into_iter()
            .filter(|e| e.contains("\"event\":\"thought\""))
            .collect()
    }

    fn charge_ref(contract: &mut Contract, id: &TokenId, cost: u64, usage_ref: &str) {
        contract.charge(id.clone(), cost, usage_ref.into(), None, 0, 0);
    }

    #[test]
    fn repeating_a_usage_ref_charges_once() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        charge_ref(&mut contract, &id, 1_000, "inf-7");
        charge_ref(&mut contract, &id, 1_000, "inf-7");
        assert_eq!(contract.get_pet(id).budget_micro, 19_000);
        assert_eq!(thought_events().len(), 1);
    }

    #[test]
    fn usage_refs_are_remembered_for_the_last_32_charges() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        charge_ref(&mut contract, &id, 100, "first");
        for i in 0..32 {
            charge_ref(&mut contract, &id, 100, &format!("other-{i}"));
        }
        charge_ref(&mut contract, &id, 100, "first");
        assert_eq!(thought_events().len(), 34, "first fell out of the window");
    }

    #[test]
    fn thought_reports_where_the_money_came_from() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        contract.credit(id.clone(), 1_500, "c".into());
        charge_ref(&mut contract, &id, 1_000, "a"); // credit only
        charge_ref(&mut contract, &id, 1_000, "b"); // 500 credit + 500 food
        charge_ref(&mut contract, &id, 1_000, "c"); // food only
        let sources: Vec<String> = thought_events()
            .iter()
            .map(|e| {
                e.split("\"source\":\"")
                    .nth(1)
                    .unwrap()
                    .split('"')
                    .next()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(sources, ["credit", "mixed", "food"]);
    }

    #[test]
    fn thought_on_an_empty_budget_reports_source_none() {
        let (mut contract, id) = minted();
        as_brain(DAY + 30 * DAY);
        charge_ref(&mut contract, &id, 1_000, "a");
        assert!(thought_events()[0].contains("\"source\":\"none\""));
    }

    #[test]
    fn get_pet_reports_daily_burn() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        charge_ref(&mut contract, &id, 4_000, "a");
        ctx(accounts(4), NearToken::from_yoctonear(0), 2 * DAY);
        // metabolism 1_000 + average spend (0 * 3 + 4_000) / 4
        assert_eq!(contract.get_pet(id).daily_burn_micro, 2_000);
    }
}
