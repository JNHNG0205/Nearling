//! Nearling pets contract. Spec: CLAUDE.md sections 6 and 7.

mod approvals;
mod battle;
mod budget;
mod device;
mod events;
mod items;
mod metadata;
mod nft;
mod pantry;
mod pet;
mod play;
mod soul;
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

/// Look picked at hatch: body colour and pattern, as `@petto/sprites` reads them from the traits
/// (`traits[0] % 8` into BODY_PALETTES, `traits[2] % 3` into PATTERNS).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PetLook {
    pub colour: u8,
    pub pattern: u8,
}
const LOOK_COLOURS: u8 = 8;
const LOOK_PATTERNS: u8 = 3;

/// The trait value nearest `v` (0 to 100) whose remainder mod `m` is `k`: moves a random trait by
/// less than `m` points, so a picked look barely touches the personality.
fn snap(v: u8, m: u8, k: u8) -> u8 {
    let (v, m, k) = (i16::from(v), i16::from(m), i16::from(k));
    let down = v - (v - k).rem_euclid(m);
    let up = down + m;
    let pick = if down < 0 || (up <= 100 && up - v < v - down) {
        up
    } else {
        down
    };
    pick as u8
}

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
    /// What the brain charges per chat: "1 fuel" (CLAUDE.md 1.1).
    pub fuel_price_micro: u64,
    pub charge_max_per_call_micro: u64,
    pub charge_max_per_day_micro: u64,
    pub xp_max_per_call: u32,
    pub xp_max_per_day: u32,
    pub mood_delta_max: u8,
    pub credit_correction_max_micro: u64,
    pub min_stake: NearToken,
    /// NEARON's `unstake_deposit`, attached to the pool `unstake`, refunded on withdraw.
    /// Admin re-checks it with the pool's `get_account` after pool upgrades.
    pub pool_unstake_deposit: NearToken,
    pub device_stake_min: NearToken,
    pub device_stake_max_per_action: NearToken,
    pub device_stake_max_per_day: NearToken,
    pub device_feed_max_per_day: NearToken,
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
            fuel_price_micro: 1_000,
            charge_max_per_call_micro: 5_000,
            charge_max_per_day_micro: 100_000,
            xp_max_per_call: 5,
            xp_max_per_day: 50,
            mood_delta_max: 10,
            credit_correction_max_micro: 100_000,
            min_stake: NearToken::from_near(1),
            pool_unstake_deposit: NearToken::from_yoctonear(7_720_000_000_000_000_000_000),
            device_stake_min: NearToken::from_near(1),
            device_stake_max_per_action: NearToken::from_near(2),
            device_stake_max_per_day: NearToken::from_near(5),
            device_feed_max_per_day: NearToken::from_near(1),
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
    /// `register_pool` succeeded: the pool took its first-deposit fee from the house deposit.
    pool_registered: bool,
    actions: LookupMap<u64, approvals::PendingAction>,
    next_action_id: u64,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Owners,
    TokenMetadata,
    Enumeration,
    Pets,
    Actions,
    // pet battles (battle.rs); appended so earlier prefixes never move
    Battles,
    BattleIds,
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
    pub pantry_yocto: U128,
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
    pub approval_mode: bool,
    pub soul_version: u32,
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
            actions: LookupMap::new(StorageKey::Actions),
            next_action_id: 0,
        }
    }

    /// Attach exactly `mint_storage + starter_food`. `mint_storage` stays in the contract to pay
    /// for the pet's storage; `starter_food` becomes the pet's food.
    #[payable]
    pub fn nft_mint_pet(
        &mut self,
        name: String,
        soul: Option<String>,
        look: Option<PetLook>,
    ) -> TokenId {
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
        let mut traits = [0, 1, 2, 3, 4].map(|i| seed[i] % 101);
        if let Some(l) = look {
            require!(
                l.colour < LOOK_COLOURS && l.pattern < LOOK_PATTERNS,
                "E_LOOK: Colour 0 to 7, pattern 0 to 2"
            );
            traits[0] = snap(traits[0], LOOK_COLOURS, l.colour);
            traits[2] = snap(traits[2], LOOK_PATTERNS, l.pattern);
        }
        let mut pet = Pet::new(
            name.clone(),
            env::block_timestamp(),
            self.config.starter_food.as_yoctonear(),
            traits,
        );
        if let Some(prompt) = soul {
            soul::write_soul(&id, &mut pet, prompt);
        }
        let metadata = TokenMetadata {
            title: Some(name),
            description: metadata::soul_description(&pet),
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
            pantry_yocto: pet.pantry_yocto.into(),
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
            approval_mode: pet.approval_mode,
            soul_version: pet.soul_version,
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

    /// Admin only, testnet dev cheat (scripts/dev-grow.sh): adds XP without the daily cap; the
    /// stage moves exactly as in normal growth (Baby 10, Teen 100, Adult 500) and emits `stage_up`.
    pub fn admin_add_xp(&mut self, pet_id: TokenId, xp: u32) {
        require!(
            env::predecessor_account_id() == self.config.admin,
            "E_NOT_ADMIN: Only admin"
        );
        let mut pet = self.load_pet(&pet_id);
        let stage_up = pet.add_xp(xp);
        self.save_pet(&pet_id, pet);
        self.emit_stage_up(&pet_id, stage_up);
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

    /// Contract whose pool registration (`register_pool`) has already succeeded.
    fn setup() -> Contract {
        let mut contract = unregistered();
        contract.pool_registered = true;
        contract
    }

    fn unregistered() -> Contract {
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
        let id = contract.nft_mint_pet("Mochi".into(), None, None);
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
    fn snap_lands_on_the_wanted_remainder_close_by_and_in_range() {
        for m in [3u8, 8] {
            for k in 0..m {
                for v in 0..=100u8 {
                    let s = snap(v, m, k);
                    assert!(s <= 100 && s % m == k, "v {v} m {m} k {k} -> {s}");
                    assert!(
                        (i16::from(s) - i16::from(v)).abs() < i16::from(m),
                        "v {v} m {m} k {k} -> {s}"
                    );
                }
            }
        }
        assert_eq!(snap(42, 8, 2), 42); // already there: unchanged
    }

    #[test]
    fn mint_with_a_look_sets_colour_and_pattern() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        let id = contract.nft_mint_pet(
            "Mochi".into(),
            None,
            Some(PetLook {
                colour: 5,
                pattern: 2,
            }),
        );
        let t = contract.get_pet(id).traits;
        assert_eq!((t[0] % 8, t[2] % 3), (5, 2));
        assert!(t.iter().all(|&v| v <= 100));
    }

    #[test]
    #[should_panic(expected = "E_LOOK: Colour 0 to 7, pattern 0 to 2")]
    fn mint_rejects_an_unknown_colour() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        contract.nft_mint_pet(
            "Mochi".into(),
            None,
            Some(PetLook {
                colour: 8,
                pattern: 0,
            }),
        );
    }

    #[test]
    #[should_panic(expected = "E_LOOK: Colour 0 to 7, pattern 0 to 2")]
    fn mint_rejects_an_unknown_pattern() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        contract.nft_mint_pet(
            "Mochi".into(),
            None,
            Some(PetLook {
                colour: 0,
                pattern: 3,
            }),
        );
    }

    /// Two pets of different owners, minted on day 1; returns (contract, a, b).
    fn two_pets() -> (Contract, TokenId, TokenId) {
        let (mut contract, a) = minted();
        ctx(accounts(4), MINT, DAY);
        let b = contract.nft_mint_pet("Bao".into(), None, None);
        (contract, a, b)
    }

    fn battle(
        c: &mut Contract,
        w: &TokenId,
        l: &TokenId,
        draw: bool,
        ran: bool,
        id: &str,
        ts: u64,
    ) {
        ctx(accounts(1), NearToken::from_yoctonear(0), ts);
        c.record_battle(w.clone(), l.clone(), draw, ran, id.into());
    }

    #[test]
    fn the_admin_dev_cheat_sets_a_battle_level_and_keeps_the_record() {
        let (mut c, a, b) = two_pets();
        battle(&mut c, &a, &b, false, false, "b1", DAY);
        ctx(accounts(0), NearToken::from_yoctonear(0), DAY);
        c.admin_set_battle_level(a.clone(), 10);
        let r = c.get_battle(a);
        assert_eq!((r.level, r.xp, r.wins), (10, 0, 1));
        assert!(events()
            .iter()
            .any(|e| e.contains("\"event\":\"battle_level_up\"") && e.contains("\"level\":10")));
    }

    #[test]
    #[should_panic(expected = "E_NOT_ADMIN")]
    fn only_the_admin_can_set_a_battle_level() {
        let (mut c, a, _) = two_pets();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        c.admin_set_battle_level(a, 10);
    }

    #[test]
    #[should_panic(expected = "E_BATTLE: Level must be 1 to 20")]
    fn a_battle_level_above_20_is_refused() {
        let (mut c, a, _) = two_pets();
        ctx(accounts(0), NearToken::from_yoctonear(0), DAY);
        c.admin_set_battle_level(a, 21);
    }

    #[test]
    #[should_panic(expected = "E_NOT_BRAIN: Only brain")]
    fn record_battle_is_brain_only() {
        let (mut c, a, b) = two_pets();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        c.record_battle(a, b, false, false, "b1".into());
    }

    #[test]
    #[should_panic(expected = "E_UNKNOWN_PET: Unknown pet")]
    fn record_battle_rejects_unknown_pets() {
        let (mut c, a, _) = two_pets();
        battle(&mut c, &a, &"99".to_string(), false, false, "b1", DAY);
    }

    #[test]
    #[should_panic(expected = "E_BATTLE: A pet cannot battle itself")]
    fn record_battle_rejects_the_same_pet() {
        let (mut c, a, _) = two_pets();
        battle(&mut c, &a, &a, false, false, "b1", DAY);
    }

    #[test]
    fn a_fresh_pet_has_a_level_1_battle_record() {
        let (c, a, _) = two_pets();
        let r = c.get_battle(a);
        assert_eq!((r.level, r.xp, r.wins, r.losses, r.draws), (1, 0, 0, 0, 0));
    }

    #[test]
    fn a_win_and_a_loss_score_per_spec_and_emit_an_event() {
        let (mut c, a, b) = two_pets();
        battle(&mut c, &a, &b, false, false, "b1", DAY);
        let (w, l) = (c.get_battle(a), c.get_battle(b));
        assert_eq!((w.level, w.xp, w.wins), (2, 0, 1)); // 20 xp at level 1 = level 2
        assert_eq!((l.level, l.xp, l.losses), (1, 8, 1));
        let log = events()
            .into_iter()
            .find(|e| e.contains("\"battle\""))
            .unwrap();
        assert!(
            log.contains("\"xp\":[20,8]") && log.contains("\"battle_id\":\"b1\""),
            "{log}"
        );
        assert!(events().iter().any(|e| e.contains("battle_level_up")));
    }

    #[test]
    fn draws_give_10_each_and_running_away_gives_the_runner_0() {
        let (mut c, a, b) = two_pets();
        battle(&mut c, &a, &b, true, false, "d1", DAY);
        assert_eq!(
            (c.get_battle(a.clone()).xp, c.get_battle(b.clone()).draws),
            (10, 1)
        );
        battle(&mut c, &a, &b, false, true, "r1", DAY);
        assert_eq!(c.get_battle(b).xp, 10); // still 10: the runner got 0
    }

    #[test]
    fn a_repeated_battle_id_changes_nothing() {
        let (mut c, a, b) = two_pets();
        battle(&mut c, &a, &b, false, false, "same", DAY);
        battle(&mut c, &a, &b, false, false, "same", DAY);
        assert_eq!(c.get_battle(a).wins, 1);
        assert!(!events().iter().any(|e| e.contains("\"battle\"")));
    }

    #[test]
    fn battle_xp_is_capped_at_100_a_day_and_resets_the_next_day() {
        let (mut c, a, b) = two_pets();
        // 20 wins in one day: far more than 100 xp, so the cap must stop it
        for i in 0..20 {
            battle(&mut c, &a, &b, false, false, &format!("w{i}"), DAY);
        }
        assert_eq!(c.get_battle(a.clone()).xp_today, 100);
        let before = c.get_battle(a.clone());
        battle(&mut c, &a, &b, false, false, "next-day", 2 * DAY);
        let after = c.get_battle(a);
        assert!(
            (10..=40).contains(&after.xp_today),
            "a new day starts from 0: {}",
            after.xp_today
        );
        assert_ne!((after.level, after.xp), (before.level, before.xp));
    }

    #[test]
    fn the_collection_is_named_petto() {
        use near_contract_standards::non_fungible_token::metadata::NonFungibleTokenMetadataProvider;
        let m = setup().nft_metadata();
        assert_eq!((m.name.as_str(), m.symbol.as_str()), ("Petto", "PETTO"));
    }

    #[test]
    fn mint_ids_increment() {
        let (mut contract, _) = minted();
        assert_eq!(contract.nft_mint_pet("Bao".into(), None, None), "1");
    }

    #[test]
    #[should_panic(expected = "E_DEPOSIT: Attach exactly 0.200 NEAR")]
    fn mint_rejects_wrong_deposit() {
        let mut contract = setup();
        ctx(accounts(3), NearToken::from_millinear(199), DAY);
        contract.nft_mint_pet("Mochi".into(), None, None);
    }

    #[test]
    #[should_panic(expected = "E_NAME: Name must be 1 to 32 bytes")]
    fn mint_rejects_long_name() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        contract.nft_mint_pet("x".repeat(33), None, None);
    }

    #[test]
    fn mint_storage_is_covered_by_mint_storage() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        let before = env::storage_usage();
        contract.nft_mint_pet("x".repeat(32), None, None);
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
    fn successful_stake_is_recorded_one_to_one() {
        let (mut contract, id) = staked(10);
        assert_eq!(contract.get_pet(id.clone()).staked.0, 10 * NEAR);
        assert!(events().iter().any(|e| e.contains("\"event\":\"staked\"")));
        callback(true);
        contract.on_stake(id.clone(), accounts(3), U128(NEAR));
        assert_eq!(contract.get_pet(id).staked.0, 11 * NEAR);
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
        assert_eq!(view.daily_credit_micro, 6_570);
        assert!(view.self_sustaining);
    }

    /// NEARON's `unstake_deposit` (0.00772 NEAR on testnet, C6), refunded with the withdrawal.
    const UNSTAKE_DEPOSIT: u128 = 7_720_000_000_000_000_000_000;

    fn as_owner_unstaking(deposit: u128) {
        ctx_full(accounts(3), NearToken::from_yoctonear(deposit), DAY, 10);
    }

    #[test]
    fn unstake_deposit_defaults_to_the_testnet_pool_value() {
        assert_eq!(
            setup().config().pool_unstake_deposit.as_yoctonear(),
            UNSTAKE_DEPOSIT
        );
    }

    #[test]
    fn unstake_attaches_the_pool_deposit_and_locks_the_amount() {
        let (mut contract, id) = staked(10);
        as_owner_unstaking(UNSTAKE_DEPOSIT);
        let _ = contract.unstake(id.clone(), U128(2 * NEAR));
        let args = format!("{{\"amount\":\"{}\"}}", 2 * NEAR);
        assert_eq!(
            pool_calls(),
            vec![("unstake".into(), args, UNSTAKE_DEPOSIT, 400)]
        );
        let view = contract.get_pet(id);
        assert_eq!(view.staked.0, 8 * NEAR);
        let pending = view.pending_unstake.unwrap();
        assert_eq!((pending.amount.0, pending.unlock_epoch.0), (2 * NEAR, 12));
        assert_eq!(pending.deposit.0, UNSTAKE_DEPOSIT);
    }

    #[test]
    #[should_panic(expected = "E_DEPOSIT: Attach 7720000000000000000000 yocto")]
    fn unstake_without_the_pool_deposit_is_rejected() {
        let (mut contract, id) = staked(10);
        as_owner_unstaking(UNSTAKE_DEPOSIT - 1);
        let _ = contract.unstake(id, U128(NEAR));
    }

    #[test]
    fn unstake_refunds_a_deposit_above_the_pool_deposit() {
        let (mut contract, id) = staked(10);
        as_owner_unstaking(UNSTAKE_DEPOSIT + NEAR);
        let _ = contract.unstake(id.clone(), U128(NEAR));
        assert_eq!(transfers_to(&accounts(3)), vec![NearToken::from_near(1)]);
        assert_eq!(pool_calls()[0].2, UNSTAKE_DEPOSIT);
        assert_eq!(
            contract.get_pet(id).pending_unstake.unwrap().deposit.0,
            UNSTAKE_DEPOSIT
        );
    }

    #[test]
    fn a_zero_pool_deposit_still_attaches_one_yocto() {
        let (mut contract, id) = staked(10);
        let mut c = contract.config();
        c.pool_unstake_deposit = NearToken::from_yoctonear(0);
        ctx(accounts(0), NearToken::from_yoctonear(0), DAY);
        contract.set_config(c);
        as_owner_unstaking(0);
        let _ = contract.unstake(id.clone(), U128(NEAR));
        assert_eq!(pool_calls()[0].2, 1);
        assert_eq!(contract.get_pet(id).pending_unstake.unwrap().deposit.0, 1);
    }

    #[test]
    #[should_panic(expected = "E_UNSTAKE_PENDING: Unstake already pending")]
    fn second_unstake_while_pending_is_rejected() {
        let (mut contract, id) = staked(10);
        as_owner_unstaking(UNSTAKE_DEPOSIT);
        let _ = contract.unstake(id.clone(), U128(NEAR));
        let _ = contract.unstake(id, U128(NEAR));
    }

    #[test]
    #[should_panic(expected = "E_NO_STAKE: Not enough stake")]
    fn unstake_more_than_staked_is_rejected() {
        let (mut contract, id) = staked(1);
        as_owner_unstaking(UNSTAKE_DEPOSIT);
        let _ = contract.unstake(id, U128(NEAR + 1));
    }

    #[test]
    fn failed_unstake_restores_stake_and_refunds_the_deposit() {
        let (mut contract, id) = staked(10);
        as_owner_unstaking(UNSTAKE_DEPOSIT);
        let _ = contract.unstake(id.clone(), U128(2 * NEAR));
        callback(false);
        contract.on_unstake(
            id.clone(),
            accounts(3),
            U128(2 * NEAR),
            U128(UNSTAKE_DEPOSIT),
        );
        let view = contract.get_pet(id);
        assert_eq!(view.staked.0, 10 * NEAR);
        assert!(view.pending_unstake.is_none());
        assert_eq!(
            transfers_to(&accounts(3)),
            vec![NearToken::from_yoctonear(UNSTAKE_DEPOSIT)]
        );
    }

    #[test]
    fn the_unstaked_event_carries_the_deposit() {
        let (_, _) = unstaked_2();
        let deposit = format!("\"deposit\":\"{UNSTAKE_DEPOSIT}\"");
        assert!(events()
            .iter()
            .any(|e| e.contains("\"event\":\"unstaked\"") && e.contains(&deposit)));
    }

    fn unstaked_2() -> (Contract, TokenId) {
        let (mut contract, id) = staked(10);
        as_owner_unstaking(UNSTAKE_DEPOSIT);
        let _ = contract.unstake(id.clone(), U128(2 * NEAR));
        callback(true);
        contract.on_unstake(
            id.clone(),
            accounts(3),
            U128(2 * NEAR),
            U128(UNSTAKE_DEPOSIT),
        );
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
    fn withdraw_after_unlock_pays_the_owner_the_amount_and_the_deposit() {
        let (mut contract, id) = unstaked_2();
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 12);
        let _ = contract.withdraw(id.clone());
        assert_eq!(pool_calls(), vec![("withdraw".into(), "{}".into(), 1, 400)]);
        callback(true);
        contract.on_withdraw(
            id.clone(),
            accounts(3),
            U128(2 * NEAR),
            U128(UNSTAKE_DEPOSIT),
        );
        assert_eq!(
            transfers_to(&accounts(3)),
            vec![NearToken::from_yoctonear(2 * NEAR + UNSTAKE_DEPOSIT)]
        );
        assert!(contract.get_pet(id).pending_unstake.is_none());
        let deposit = format!("\"deposit\":\"{UNSTAKE_DEPOSIT}\"");
        assert!(events()
            .iter()
            .any(|e| e.contains("unstake_withdrawn") && e.contains(&deposit)));
    }

    #[test]
    fn failed_withdraw_keeps_the_unstake_pending_with_its_deposit() {
        let (mut contract, id) = unstaked_2();
        ctx_full(accounts(3), NearToken::from_yoctonear(0), DAY, 12);
        let _ = contract.withdraw(id.clone());
        callback(false);
        contract.on_withdraw(
            id.clone(),
            accounts(3),
            U128(2 * NEAR),
            U128(UNSTAKE_DEPOSIT),
        );
        assert!(transfers_to(&accounts(3)).is_empty());
        let pending = contract.get_pet(id).pending_unstake.unwrap();
        assert_eq!(
            (pending.amount.0, pending.deposit.0),
            (2 * NEAR, UNSTAKE_DEPOSIT)
        );
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
        assert_eq!(contract.get_pet(id).staked.0, NEAR);
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

    use approvals::Action;

    const MIN: u64 = 60_000_000_000;

    /// Pet with 3 NEAR extra food, a device, and approval mode on.
    fn guarded() -> (Contract, TokenId) {
        let (mut contract, id) = with_device();
        contract.set_approval_mode(id.clone(), true);
        (contract, id)
    }

    fn wallet(deposit: NearToken) {
        ctx_signed(accounts(3), wallet_pk(), deposit);
    }

    fn device() {
        ctx_signed(accounts(3), device_pk(), NearToken::from_yoctonear(0));
    }

    fn propose(contract: &mut Contract, id: &TokenId, action: Action, deposit: NearToken) -> U64 {
        wallet(deposit);
        contract.propose_action(id.clone(), action)
    }

    fn stake_action(near: u128) -> Action {
        Action::Stake {
            amount: U128(near * NEAR),
        }
    }

    #[test]
    #[should_panic(expected = "E_NOT_DEVICE: Register a device first")]
    fn approval_mode_needs_a_device() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.set_approval_mode(id, true);
    }

    #[test]
    #[should_panic(expected = "E_APPROVAL_MODE")]
    fn approval_mode_cannot_be_turned_off_directly() {
        let (mut contract, id) = guarded();
        contract.set_approval_mode(id, false);
    }

    #[test]
    #[should_panic(expected = "E_APPROVAL_MODE")]
    fn direct_stake_is_rejected_in_approval_mode() {
        let (mut contract, id) = guarded();
        wallet(NearToken::from_near(2));
        let _ = contract.stake(id);
    }

    #[test]
    #[should_panic(expected = "E_APPROVAL_MODE")]
    fn direct_unstake_is_rejected_in_approval_mode() {
        let (mut contract, id) = guarded();
        wallet(NearToken::from_yoctonear(0));
        let _ = contract.unstake(id, U128(NEAR));
    }

    #[test]
    #[should_panic(expected = "E_APPROVAL_MODE")]
    fn direct_withdraw_is_rejected_in_approval_mode() {
        let (mut contract, id) = guarded();
        wallet(NearToken::from_yoctonear(0));
        let _ = contract.withdraw(id);
    }

    #[test]
    #[should_panic(expected = "E_APPROVAL_MODE")]
    fn swapping_the_device_key_is_rejected_in_approval_mode() {
        let (mut contract, id) = guarded();
        wallet(NearToken::from_yoctonear(0));
        contract.register_device(id, wallet_pk());
    }

    #[test]
    #[should_panic(expected = "E_APPROVAL_MODE")]
    fn direct_transfer_is_rejected_in_approval_mode() {
        let (mut contract, id) = guarded();
        wallet(NearToken::from_yoctonear(1));
        contract.nft_transfer(accounts(4), id, None, None);
    }

    #[test]
    fn care_actions_stay_direct_in_approval_mode() {
        let (mut contract, id) = guarded();
        wallet(NearToken::from_near(1));
        contract.feed(id.clone());
        wallet(NearToken::from_yoctonear(0));
        contract.play(id.clone(), pet::PlayAction::Pet);
        device_stake(&mut contract, &id, 1_000);
        assert_eq!(
            pool_calls().len(),
            1,
            "device stake within caps is not gated"
        );
    }

    #[test]
    fn a_proposal_is_listed_with_its_proposer_key_and_expiry() {
        let (mut contract, id) = guarded();
        let action_id = propose(&mut contract, &id, stake_action(2), NearToken::from_near(2));
        let pending = contract.get_pending_actions(id);
        assert_eq!(pending.len(), 1);
        let p = &pending[0];
        assert_eq!((p.id, p.proposer_pk.clone()), (action_id, wallet_pk()));
        assert_eq!((p.deposit.0, p.expires_at_ns.0), (2 * NEAR, DAY + 10 * MIN));
        assert!(events().iter().any(|e| e.contains("action_proposed")));
    }

    #[test]
    #[should_panic(expected = "E_APPROVAL_MODE: Approval mode is off")]
    fn proposing_needs_approval_mode() {
        let (mut contract, id) = with_device();
        propose(&mut contract, &id, stake_action(2), NearToken::from_near(2));
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER")]
    fn only_the_owner_can_propose() {
        let (mut contract, id) = guarded();
        ctx_signed(accounts(4), wallet_pk(), NearToken::from_near(2));
        contract.propose_action(id, stake_action(2));
    }

    #[test]
    #[should_panic(expected = "E_DEPOSIT")]
    fn a_stake_proposal_must_hold_its_amount() {
        let (mut contract, id) = guarded();
        propose(&mut contract, &id, stake_action(2), NearToken::from_near(1));
    }

    #[test]
    #[should_panic(expected = "E_DEPOSIT")]
    fn other_proposals_hold_no_deposit() {
        let (mut contract, id) = guarded();
        propose(
            &mut contract,
            &id,
            Action::Withdraw,
            NearToken::from_near(1),
        );
    }

    #[test]
    #[should_panic(expected = "E_TOO_MANY_ACTIONS")]
    fn a_pet_has_at_most_five_pending_actions() {
        let (mut contract, id) = guarded();
        for _ in 0..6 {
            propose(
                &mut contract,
                &id,
                Action::Withdraw,
                NearToken::from_yoctonear(0),
            );
        }
    }

    #[test]
    fn device_approval_runs_the_stake_with_the_held_deposit() {
        let (mut contract, id) = guarded();
        let action_id = propose(&mut contract, &id, stake_action(2), NearToken::from_near(2));
        device();
        let _ = contract.approve_action(action_id);
        assert_eq!(
            pool_calls(),
            vec![("deposit_and_stake".into(), "{}".into(), 2 * NEAR, 400)]
        );
        assert!(contract.get_pending_actions(id.clone()).is_empty());
        assert!(events().iter().any(|e| e.contains("action_approved")));
        callback(true);
        contract.on_stake(id.clone(), accounts(3), U128(2 * NEAR));
        assert_eq!(contract.get_pet(id).staked.0, 2 * NEAR);
    }

    #[test]
    #[should_panic(expected = "E_NOT_DEVICE")]
    fn the_wallet_key_cannot_approve() {
        let (mut contract, id) = guarded();
        let action_id = propose(&mut contract, &id, stake_action(2), NearToken::from_near(2));
        wallet(NearToken::from_yoctonear(0));
        let _ = contract.approve_action(action_id);
    }

    #[test]
    #[should_panic(expected = "E_SAME_KEY")]
    fn the_proposing_key_cannot_approve() {
        let (mut contract, id) = guarded();
        ctx_signed(accounts(3), device_pk(), NearToken::from_yoctonear(0));
        let action_id = contract.propose_action(id, Action::Withdraw);
        let _ = contract.approve_action(action_id);
    }

    #[test]
    #[should_panic(expected = "E_EXPIRED")]
    fn an_expired_action_cannot_be_approved() {
        let (mut contract, id) = guarded();
        let action_id = propose(&mut contract, &id, stake_action(2), NearToken::from_near(2));
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(3))
            .signer_account_pk(device_pk())
            .block_timestamp(DAY + 10 * MIN + 1)
            .prepaid_gas(near_sdk::Gas::from_tgas(450))
            .build());
        let _ = contract.approve_action(action_id);
    }

    #[test]
    fn cancelling_refunds_the_deposit() {
        let (mut contract, id) = guarded();
        let action_id = propose(&mut contract, &id, stake_action(2), NearToken::from_near(2));
        wallet(NearToken::from_yoctonear(0));
        contract.cancel_action(action_id);
        assert_eq!(transfers_to(&accounts(3)), vec![NearToken::from_near(2)]);
        assert!(contract.get_pending_actions(id).is_empty());
        assert!(events().iter().any(|e| e.contains("action_cancelled")));
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER")]
    fn a_stranger_cannot_cancel() {
        let (mut contract, id) = guarded();
        let action_id = propose(&mut contract, &id, stake_action(2), NearToken::from_near(2));
        ctx(accounts(4), NearToken::from_yoctonear(0), DAY);
        contract.cancel_action(action_id);
    }

    fn approve(contract: &mut Contract, id: &TokenId, action: Action) {
        let action_id = propose(contract, id, action, NearToken::from_yoctonear(0));
        device();
        let _ = contract.approve_action(action_id);
    }

    #[test]
    fn approval_can_turn_approval_mode_off() {
        let (mut contract, id) = guarded();
        approve(&mut contract, &id, Action::SetApprovalMode { on: false });
        assert!(!contract.get_pet(id.clone()).approval_mode);
        wallet(NearToken::from_near(2));
        let _ = contract.stake(id);
    }

    fn unstake_action() -> Action {
        Action::Unstake { amount: U128(NEAR) }
    }

    #[test]
    #[should_panic(expected = "E_DEPOSIT")]
    fn an_unstake_proposal_must_hold_the_pool_deposit() {
        let (mut contract, id) = guarded();
        propose(
            &mut contract,
            &id,
            unstake_action(),
            NearToken::from_yoctonear(UNSTAKE_DEPOSIT - 1),
        );
    }

    #[test]
    fn cancelling_an_unstake_proposal_refunds_its_deposit() {
        let (mut contract, id) = guarded();
        let dep = NearToken::from_yoctonear(UNSTAKE_DEPOSIT);
        let action_id = propose(&mut contract, &id, unstake_action(), dep);
        assert_eq!(
            contract.get_pending_actions(id).pop().unwrap().deposit.0,
            UNSTAKE_DEPOSIT
        );
        wallet(NearToken::from_yoctonear(0));
        contract.cancel_action(action_id);
        assert_eq!(transfers_to(&accounts(3)), vec![dep]);
    }

    #[test]
    fn approval_can_unstake_and_withdraw() {
        let (mut contract, id) = guarded();
        callback(true);
        contract.on_stake(id.clone(), accounts(3), U128(3 * NEAR));
        // Held deposit above the pool deposit: the excess goes back to the owner on approval.
        let held = NearToken::from_yoctonear(UNSTAKE_DEPOSIT + NEAR);
        let action_id = propose(&mut contract, &id, unstake_action(), held);
        device();
        let _ = contract.approve_action(action_id);
        let args = format!("{{\"amount\":\"{NEAR}\"}}");
        assert_eq!(
            pool_calls(),
            vec![("unstake".into(), args, UNSTAKE_DEPOSIT, 400)]
        );
        assert_eq!(transfers_to(&accounts(3)), vec![NearToken::from_near(1)]);
        callback(true);
        contract.on_unstake(id.clone(), accounts(3), U128(NEAR), U128(UNSTAKE_DEPOSIT));
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(3))
            .signer_account_pk(wallet_pk())
            .block_timestamp(DAY)
            .epoch_height(12)
            .build());
        let action_id = contract.propose_action(id.clone(), Action::Withdraw);
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(3))
            .signer_account_pk(device_pk())
            .block_timestamp(DAY)
            .epoch_height(12)
            .prepaid_gas(near_sdk::Gas::from_tgas(450))
            .build());
        let _ = contract.approve_action(action_id);
        assert_eq!(pool_calls(), vec![("withdraw".into(), "{}".into(), 1, 400)]);
    }

    #[test]
    fn approval_can_stake_food_above_the_device_cap() {
        let (mut contract, id) = guarded();
        approve(
            &mut contract,
            &id,
            Action::StakeFromFood {
                amount: U128(3 * NEAR),
            },
        );
        assert_eq!(
            pool_calls(),
            vec![("deposit_and_stake".into(), "{}".into(), 3 * NEAR, 400)]
        );
        assert_eq!(
            contract.get_pet(id).food_yocto.0,
            3_100 * NEAR / 1_000 - 3 * NEAR
        );
    }

    #[test]
    fn approval_can_replace_the_device_and_drops_other_proposals() {
        let (mut contract, id) = guarded();
        propose(&mut contract, &id, stake_action(2), NearToken::from_near(2));
        approve(
            &mut contract,
            &id,
            Action::RegisterDevice {
                public_key: wallet_pk(),
            },
        );
        let view = contract.get_pet(id.clone());
        assert_eq!(view.device_pk, Some(wallet_pk()));
        assert!(contract.get_pending_actions(id).is_empty());
        assert_eq!(
            transfers_to(&accounts(3)),
            vec![NearToken::from_near(2)],
            "refund"
        );
    }

    #[test]
    fn approval_can_transfer_and_the_new_owner_starts_clean() {
        let (mut contract, id) = guarded();
        propose(&mut contract, &id, stake_action(2), NearToken::from_near(2));
        approve(
            &mut contract,
            &id,
            Action::Transfer {
                receiver_id: accounts(4),
            },
        );
        let view = contract.get_pet(id.clone());
        assert_eq!(view.owner, accounts(4));
        assert_eq!((view.device_pk, view.approval_mode), (None, false));
        assert!(contract.get_pending_actions(id).is_empty());
        assert_eq!(
            transfers_to(&accounts(3)),
            vec![NearToken::from_near(2)],
            "refund"
        );
    }

    #[test]
    fn a_direct_transfer_refunds_pending_proposals() {
        let (mut contract, id) = guarded();
        propose(&mut contract, &id, stake_action(2), NearToken::from_near(2));
        approve(&mut contract, &id, Action::SetApprovalMode { on: false });
        wallet(NearToken::from_yoctonear(1));
        contract.nft_transfer(accounts(4), id.clone(), None, None);
        assert!(contract.get_pending_actions(id).is_empty());
        assert_eq!(transfers_to(&accounts(3)), vec![NearToken::from_near(2)]);
    }

    #[test]
    fn fuel_price_defaults_to_one_tenth_of_a_cent() {
        assert_eq!(setup().config().fuel_price_micro, 1_000);
    }

    #[test]
    fn a_pet_can_be_minted_with_a_soul() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        let id = contract.nft_mint_pet("Mochi".into(), Some("A shy, curious cat.".into()), None);
        let soul = contract.get_soul(id.clone());
        assert_eq!(
            (soul.version, soul.prompt.as_str()),
            (1, "A shy, curious cat.")
        );
        assert_eq!(contract.get_pet(id).soul_version, 1);
    }

    #[test]
    fn a_pet_minted_without_a_soul_has_version_zero() {
        let (contract, id) = minted();
        assert_eq!(contract.get_soul(id).version, 0);
    }

    #[test]
    fn the_owner_can_rewrite_the_soul_and_each_change_is_public() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.set_soul(id.clone(), "Brave now.".into());
        contract.set_soul(id.clone(), "Brave and kind.".into());
        assert_eq!(contract.get_soul(id).version, 2);
        let ev = events();
        assert!(ev
            .iter()
            .any(|e| e.contains("soul_updated") && e.contains("Brave and kind.")));
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER")]
    fn a_stranger_cannot_change_the_soul() {
        let (mut contract, id) = minted();
        ctx(accounts(4), NearToken::from_yoctonear(0), DAY);
        contract.set_soul(id, "Evil.".into());
    }

    #[test]
    #[should_panic(expected = "E_SOUL_SIZE: Soul must be at most 1024 bytes")]
    fn a_soul_is_at_most_one_kilobyte() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.set_soul(id, "x".repeat(1025));
    }

    #[test]
    fn mint_storage_covers_a_full_soul() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        let before = env::storage_usage();
        contract.nft_mint_pet("x".repeat(32), Some("y".repeat(1024)), None);
        let cost = env::storage_byte_cost().saturating_mul((env::storage_usage() - before) as u128);
        assert!(
            cost <= contract.config().mint_storage,
            "storage cost {cost}"
        );
    }

    #[test]
    fn the_soul_stays_with_the_pet_on_transfer() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        let id = contract.nft_mint_pet("Mochi".into(), Some("Loyal.".into()), None);
        ctx(accounts(3), NearToken::from_yoctonear(1), DAY);
        contract.nft_transfer(accounts(4), id.clone(), None, None);
        assert_eq!(contract.get_soul(id).prompt, "Loyal.");
    }

    use near_sdk::json_types::Base64VecU8;

    const MEDIA: &str = "ipfs://bafkreihz7qo37lkdkpxyws43xfjx6hzrfnlwhcbepirgr2hozknagzrzoa";
    const REFERENCE: &str = "ipfs://bafkreidhldo67eikc56veqskchamat4qqi2zfgei4b6swbnufskureenuy";

    fn hash(byte: u8, len: usize) -> Base64VecU8 {
        Base64VecU8(vec![byte; len])
    }

    fn set_meta(contract: &mut Contract, id: &TokenId, media: &str, media_hash: Base64VecU8) {
        contract.set_metadata(
            id.clone(),
            media.into(),
            media_hash,
            REFERENCE.into(),
            hash(2, 32),
        );
    }

    #[test]
    fn the_brain_points_the_nft_at_the_pinned_image_and_json() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        let id = contract.nft_mint_pet("Mochi".into(), Some("A shy cat.".into()), None);
        as_brain(DAY);
        set_meta(&mut contract, &id, MEDIA, hash(1, 32));
        let m = contract.nft_token(id.clone()).unwrap().metadata.unwrap();
        assert_eq!(m.title.as_deref(), Some("Mochi"));
        assert_eq!(m.description.as_deref(), Some("A shy cat."));
        assert_eq!(m.media.as_deref(), Some(MEDIA));
        assert_eq!(m.media_hash, Some(hash(1, 32)));
        assert_eq!(m.reference.as_deref(), Some(REFERENCE));
        assert_eq!(m.reference_hash, Some(hash(2, 32)));
        assert_eq!(m.updated_at, Some((DAY / 1_000_000).to_string()));
        assert!(events()
            .iter()
            .any(|e| e.contains("\"event\":\"metadata_updated\"")
                && e.contains(MEDIA)
                && e.contains(REFERENCE)));
    }

    #[test]
    #[should_panic(expected = "E_NOT_BRAIN")]
    fn only_the_brain_sets_metadata() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        set_meta(&mut contract, &id, MEDIA, hash(1, 32));
    }

    #[test]
    #[should_panic(expected = "E_UNKNOWN_PET")]
    fn metadata_needs_a_known_pet() {
        let mut contract = setup();
        as_brain(DAY);
        set_meta(&mut contract, &"7".to_string(), MEDIA, hash(1, 32));
    }

    #[test]
    #[should_panic(expected = "E_METADATA")]
    fn a_media_hash_of_31_bytes_is_rejected() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        set_meta(&mut contract, &id, MEDIA, hash(1, 31));
    }

    #[test]
    #[should_panic(expected = "E_METADATA")]
    fn a_reference_hash_of_33_bytes_is_rejected() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        contract.set_metadata(id, MEDIA.into(), hash(1, 32), REFERENCE.into(), hash(2, 33));
    }

    #[test]
    #[should_panic(expected = "E_METADATA")]
    fn media_outside_ipfs_is_rejected() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        set_meta(
            &mut contract,
            &id,
            "https://example.com/pet.png",
            hash(1, 32),
        );
    }

    #[test]
    #[should_panic(expected = "E_METADATA")]
    fn a_reference_outside_ipfs_is_rejected() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        contract.set_metadata(id, MEDIA.into(), hash(1, 32), "ar://x".into(), hash(2, 32));
    }

    #[test]
    #[should_panic(expected = "E_METADATA")]
    fn a_link_over_256_bytes_is_rejected() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        let long = format!("ipfs://{}", "a".repeat(250));
        set_meta(&mut contract, &id, &long, hash(1, 32));
    }

    #[test]
    fn a_link_of_256_bytes_is_accepted() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        let exact = format!("ipfs://{}", "a".repeat(249));
        set_meta(&mut contract, &id, &exact, hash(1, 32));
    }

    #[test]
    #[should_panic(expected = "E_COOLDOWN")]
    fn metadata_updates_at_most_once_a_minute() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        set_meta(&mut contract, &id, MEDIA, hash(1, 32));
        as_brain(DAY + MIN - 1);
        set_meta(&mut contract, &id, MEDIA, hash(3, 32));
    }

    #[test]
    fn metadata_can_update_again_after_a_minute() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        set_meta(&mut contract, &id, MEDIA, hash(1, 32));
        as_brain(DAY + MIN);
        set_meta(&mut contract, &id, MEDIA, hash(3, 32));
        let m = contract.nft_token(id).unwrap().metadata.unwrap();
        assert_eq!(m.media_hash, Some(hash(3, 32)));
    }

    #[test]
    fn the_description_is_the_soul_cut_on_a_char_boundary() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        // 199 ASCII bytes, then a 4-byte emoji that would cross byte 200.
        let soul = format!("{}\u{1F431} purr", "x".repeat(199));
        let id = contract.nft_mint_pet("Mochi".into(), Some(soul), None);
        as_brain(DAY);
        set_meta(&mut contract, &id, MEDIA, hash(1, 32));
        let m = contract.nft_token(id).unwrap().metadata.unwrap();
        assert_eq!(m.description, Some("x".repeat(199)));
    }

    #[test]
    fn a_pet_without_a_soul_has_no_description() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        set_meta(&mut contract, &id, MEDIA, hash(1, 32));
        let m = contract.nft_token(id).unwrap().metadata.unwrap();
        assert_eq!(m.description, None);
    }

    #[test]
    fn a_new_soul_updates_the_nft_description_at_once() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.set_soul(id.clone(), "Brave now.".into());
        let m = contract.nft_token(id).unwrap().metadata.unwrap();
        assert_eq!(m.description.as_deref(), Some("Brave now."));
    }

    #[test]
    fn metadata_stays_with_the_pet_on_transfer() {
        let (mut contract, id) = minted();
        as_brain(DAY);
        set_meta(&mut contract, &id, MEDIA, hash(1, 32));
        ctx(accounts(3), NearToken::from_yoctonear(1), DAY);
        contract.nft_transfer(accounts(4), id.clone(), None, None);
        let m = contract.nft_token(id).unwrap().metadata.unwrap();
        assert_eq!(m.media.as_deref(), Some(MEDIA));
    }

    #[test]
    fn mint_storage_covers_a_full_soul_and_full_metadata() {
        let mut contract = setup();
        ctx(accounts(3), MINT, DAY);
        let before = env::storage_usage();
        let id = contract.nft_mint_pet("x".repeat(32), Some("y".repeat(1024)), None);
        as_brain(DAY);
        let link = format!("ipfs://{}", "a".repeat(249));
        contract.set_metadata(id, link.clone(), hash(1, 32), link, hash(2, 32));
        let cost = env::storage_byte_cost().saturating_mul((env::storage_usage() - before) as u128);
        assert!(
            cost <= contract.config().mint_storage,
            "storage cost {cost}"
        );
    }

    const MILLI: u128 = NEAR / 1_000;

    /// Pet with a device and `near_milli` mNEAR stocked in its pantry by the owner wallet.
    fn stocked(near_milli: u128) -> (Contract, TokenId) {
        let (mut contract, id) = with_device();
        wallet(NearToken::from_yoctonear(near_milli * MILLI));
        contract.stock_pantry(id.clone());
        (contract, id)
    }

    fn device_at(ts: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(3))
            .signer_account_pk(device_pk())
            .block_timestamp(ts)
            .build());
    }

    #[test]
    fn device_feed_cap_defaults_to_one_near_a_day() {
        assert_eq!(
            setup().config().device_feed_max_per_day,
            NearToken::from_near(1)
        );
    }

    #[test]
    fn the_owner_stocks_the_pantry() {
        let (contract, id) = stocked(500);
        let json = near_sdk::serde_json::to_value(contract.get_pet(id)).unwrap();
        assert_eq!(json["pantry_yocto"], (500 * MILLI).to_string());
        assert!(events()
            .iter()
            .any(|e| e.contains("\"event\":\"pantry_stocked\"")
                && e.contains(&format!("\"pantry\":\"{}\"", 500 * MILLI))));
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER")]
    fn a_stranger_cannot_stock_the_pantry() {
        let (mut contract, id) = minted();
        ctx(accounts(4), NearToken::from_near(1), DAY);
        contract.stock_pantry(id);
    }

    #[test]
    #[should_panic(expected = "E_DEPOSIT")]
    fn stocking_nothing_is_rejected() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.stock_pantry(id);
    }

    #[test]
    fn stocking_stays_direct_in_approval_mode() {
        let (mut contract, id) = guarded();
        wallet(NearToken::from_near(1));
        contract.stock_pantry(id.clone());
        assert_eq!(contract.get_pet(id).pantry_yocto.0, NEAR);
    }

    #[test]
    fn the_device_feeds_from_the_pantry() {
        let (mut contract, id) = stocked(500);
        let before = contract.get_pet(id.clone());
        device();
        contract.feed_from_pantry(id.clone(), U128(200 * MILLI));
        let view = contract.get_pet(id);
        assert_eq!(view.food_yocto.0, before.food_yocto.0 + 200 * MILLI);
        assert_eq!(view.pantry_yocto.0, 300 * MILLI);
        assert_eq!(view.mood, (before.mood + 5).min(100));
        assert!(events()
            .iter()
            .any(|e| e.contains("\"event\":\"fed\"") && e.contains("\"source\":\"pantry\"")));
    }

    #[test]
    fn wallet_feeding_reports_its_source() {
        let (mut contract, id) = minted();
        ctx(accounts(4), NearToken::from_near(1), DAY);
        contract.feed(id);
        assert!(events()
            .iter()
            .any(|e| e.contains("\"event\":\"fed\"") && e.contains("\"source\":\"wallet\"")));
    }

    #[test]
    #[should_panic(expected = "E_DEVICE_CAP")]
    fn the_device_feeds_at_most_the_daily_cap() {
        let (mut contract, id) = stocked(2_000);
        device();
        contract.feed_from_pantry(id.clone(), U128(600 * MILLI));
        contract.feed_from_pantry(id, U128(401 * MILLI));
    }

    #[test]
    fn the_device_feed_cap_resets_the_next_day() {
        let (mut contract, id) = stocked(2_000);
        device_at(DAY);
        contract.feed_from_pantry(id.clone(), U128(NEAR));
        device_at(2 * DAY);
        contract.feed_from_pantry(id.clone(), U128(NEAR));
        assert_eq!(contract.get_pet(id).pantry_yocto.0, 0);
    }

    #[test]
    fn the_wallet_key_skips_the_device_cap() {
        let (mut contract, id) = stocked(2_000);
        wallet(NearToken::from_yoctonear(0));
        contract.feed_from_pantry(id.clone(), U128(2 * NEAR));
        assert_eq!(contract.get_pet(id).pantry_yocto.0, 0);
    }

    #[test]
    #[should_panic(expected = "E_PANTRY: Not enough in the pantry")]
    fn feeding_more_than_the_pantry_is_rejected() {
        let (mut contract, id) = stocked(500);
        device();
        contract.feed_from_pantry(id, U128(500 * MILLI + 1));
    }

    #[test]
    #[should_panic(expected = "E_PANTRY")]
    fn feeding_nothing_from_the_pantry_is_rejected() {
        let (mut contract, id) = stocked(500);
        device();
        contract.feed_from_pantry(id, U128(0));
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER")]
    fn a_stranger_cannot_feed_from_the_pantry() {
        let (mut contract, id) = stocked(500);
        ctx_signed(accounts(4), device_pk(), NearToken::from_yoctonear(0));
        contract.feed_from_pantry(id, U128(MILLI));
    }

    #[test]
    fn feeding_from_the_pantry_revives_a_starving_pet() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_near(1), DAY);
        contract.stock_pantry(id.clone());
        let later = DAY + 22 * DAY; // starter food lasts 20 days
        ctx(accounts(3), NearToken::from_yoctonear(0), later);
        assert_eq!(contract.get_pet(id.clone()).life_state, LifeState::Starving);
        contract.feed_from_pantry(id.clone(), U128(100 * MILLI));
        let view = contract.get_pet(id);
        assert_eq!(view.starving_since_ns, None);
        assert_ne!(view.life_state, LifeState::Starving);
    }

    #[test]
    fn the_owner_empties_the_pantry() {
        let (mut contract, id) = stocked(500);
        wallet(NearToken::from_yoctonear(0));
        contract.empty_pantry(id.clone(), U128(200 * MILLI));
        assert_eq!(
            transfers_to(&accounts(3)),
            vec![NearToken::from_millinear(200)]
        );
        assert_eq!(contract.get_pet(id).pantry_yocto.0, 300 * MILLI);
        assert!(events()
            .iter()
            .any(|e| e.contains("\"event\":\"pantry_emptied\"")));
    }

    #[test]
    #[should_panic(expected = "E_PANTRY")]
    fn emptying_more_than_the_pantry_is_rejected() {
        let (mut contract, id) = stocked(500);
        wallet(NearToken::from_yoctonear(0));
        contract.empty_pantry(id, U128(500 * MILLI + 1));
    }

    #[test]
    #[should_panic(expected = "E_PANTRY")]
    fn emptying_nothing_is_rejected() {
        let (mut contract, id) = stocked(500);
        wallet(NearToken::from_yoctonear(0));
        contract.empty_pantry(id, U128(0));
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER")]
    fn a_stranger_cannot_empty_the_pantry() {
        let (mut contract, id) = stocked(500);
        ctx(accounts(4), NearToken::from_yoctonear(0), DAY);
        contract.empty_pantry(id, U128(MILLI));
    }

    #[test]
    #[should_panic(expected = "E_APPROVAL_MODE")]
    fn emptying_the_pantry_is_gated_in_approval_mode() {
        let (mut contract, id) = stocked(500);
        contract.set_approval_mode(id.clone(), true);
        wallet(NearToken::from_yoctonear(0));
        contract.empty_pantry(id, U128(MILLI));
    }

    #[test]
    fn transfer_refunds_the_pantry_to_the_old_owner() {
        let (mut contract, id) = stocked(500);
        wallet(NearToken::from_yoctonear(1));
        contract.nft_transfer(accounts(4), id.clone(), None, None);
        assert_eq!(
            transfers_to(&accounts(3)),
            vec![NearToken::from_millinear(500)]
        );
        let view = contract.get_pet(id);
        assert_eq!((view.owner, view.pantry_yocto.0), (accounts(4), 0));
    }

    #[test]
    fn the_admin_dev_cheat_adds_xp_past_the_daily_cap_and_grows_the_pet() {
        let (mut contract, id) = minted();
        ctx(accounts(0), NearToken::from_yoctonear(0), DAY);
        contract.admin_add_xp(id.clone(), 120);
        let view = contract.get_pet(id);
        assert_eq!((view.xp, view.stage), (120, 2));
        assert!(events()
            .iter()
            .any(|e| e.contains("\"event\":\"stage_up\"") && e.contains("\"stage\":2")));
    }

    #[test]
    #[should_panic(expected = "E_NOT_ADMIN")]
    fn only_the_admin_can_cheat_xp() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.admin_add_xp(id, 500);
    }

    #[test]
    fn the_owner_hatches_the_egg_into_a_baby() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.hatch(id.clone());
        let view = contract.get_pet(id);
        assert_eq!((view.stage, view.xp), (1, 0));
        assert!(events()
            .iter()
            .any(|e| e.contains("\"event\":\"stage_up\"") && e.contains("\"stage\":1")));
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER")]
    fn only_the_owner_hatches() {
        let (mut contract, id) = minted();
        ctx(accounts(4), NearToken::from_yoctonear(0), DAY);
        contract.hatch(id);
    }

    #[test]
    #[should_panic(expected = "E_HATCHED: Already hatched")]
    fn an_egg_hatches_once() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.hatch(id.clone());
        contract.hatch(id);
    }

    #[test]
    fn a_hatched_baby_still_grows_by_xp() {
        let (mut contract, id) = minted();
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.hatch(id.clone());
        as_brain(DAY);
        for _ in 0..20 {
            chat(&mut contract, &id, 0, 5); // 5 xp each, 50 a day cap
        }
        as_brain(2 * DAY);
        for _ in 0..12 {
            chat(&mut contract, &id, 0, 5);
        }
        assert_eq!(contract.get_pet(id).stage, 2, "Teen at 100 xp");
    }

    #[test]
    #[should_panic(expected = "E_POOL_NOT_READY")]
    fn staking_waits_for_pool_registration() {
        let mut contract = unregistered();
        ctx(accounts(3), MINT, DAY);
        let id = contract.nft_mint_pet("Mochi".into(), None, None);
        ctx_full(accounts(3), NearToken::from_near(2), DAY, 10);
        let _ = contract.stake(id);
    }

    #[test]
    #[should_panic(expected = "E_POOL_NOT_READY")]
    fn device_staking_waits_for_pool_registration() {
        let mut contract = unregistered();
        ctx(accounts(3), MINT, DAY);
        let id = contract.nft_mint_pet("Mochi".into(), None, None);
        ctx(accounts(3), NearToken::from_near(3), DAY);
        contract.feed(id.clone());
        ctx(accounts(3), NearToken::from_yoctonear(0), DAY);
        contract.register_device(id.clone(), device_pk());
        device_stake(&mut contract, &id, 1_000);
    }

    #[test]
    fn registering_the_pool_makes_a_house_deposit() {
        let mut contract = unregistered();
        ctx_full(accounts(0), NearToken::from_millinear(200), DAY, 10);
        let _ = contract.register_pool();
        assert_eq!(
            pool_calls(),
            vec![(
                "deposit_and_stake".into(),
                "{}".into(),
                200 * NEAR / 1_000,
                400
            )]
        );
        callback(true);
        assert!(contract.on_register_pool(U128(200 * NEAR / 1_000)));
        assert!(contract.pool_registered);
        assert!(events().iter().any(|e| e.contains("pool_registered")));
    }

    #[test]
    fn a_failed_registration_refunds_the_admin() {
        let mut contract = unregistered();
        callback(false);
        assert!(!contract.on_register_pool(U128(200 * NEAR / 1_000)));
        assert!(!contract.pool_registered);
        assert_eq!(
            transfers_to(&accounts(0)),
            vec![NearToken::from_millinear(200)]
        );
    }

    #[test]
    #[should_panic(expected = "E_NOT_ADMIN")]
    fn only_the_admin_registers_the_pool() {
        let mut contract = unregistered();
        ctx_full(accounts(3), NearToken::from_millinear(200), DAY, 10);
        let _ = contract.register_pool();
    }

    #[test]
    #[should_panic(expected = "E_POOL_READY: Pool already registered")]
    fn the_pool_is_registered_once() {
        let mut contract = setup();
        ctx_full(accounts(0), NearToken::from_millinear(200), DAY, 10);
        let _ = contract.register_pool();
    }
}
