//! Pet state and lazy settlement (CLAUDE.md 5.2, 5.3, 7.1). Pure: no env calls.

use crate::Config;
use near_sdk::near;

const MINUTE_NS: u64 = 60 * 1_000_000_000;
const HOUR_NS: u64 = 60 * MINUTE_NS;
pub const DAY_NS: u64 = 24 * HOUR_NS;
const YOCTO_PER_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

/// Mood -2 per hour awake.
const MOOD_NS_PER_POINT: u64 = 30 * MINUTE_NS;
/// Energy +8 per hour asleep.
const ENERGY_NS_PER_POINT: u64 = 450 * 1_000_000_000;
const DORMANT_AFTER_NS: u64 = 72 * HOUR_NS;

pub const START_MOOD: u8 = 80;
pub const START_ENERGY: u8 = 100;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LifeState {
    Happy,
    Sad,
    Hungry,
    Sleepy,
    Starving,
    Dormant,
}

/// Stored state only; `get_pet` exposes it as `PetView`.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pet {
    pub name: String,
    pub born_at_ns: u64,
    pub food_yocto: u128,
    pub credit_micro: u64,
    /// Each lazy value has its own "as of" time, advanced only by the time it actually used,
    /// so frequent writes never round decay away.
    pub budget_at_ns: u64,
    pub mood: u8,
    pub mood_at_ns: u64,
    pub energy: u8,
    pub energy_at_ns: u64,
    pub asleep_since_ns: Option<u64>,
    pub xp: u32,
    pub stage: u8,
    pub traits: [u8; 5],
    pub starving_since_ns: Option<u64>,
    pub last_life_state: LifeState,
}

impl Pet {
    pub fn new(name: String, now: u64, food_yocto: u128, traits: [u8; 5]) -> Self {
        Self {
            name,
            born_at_ns: now,
            food_yocto,
            credit_micro: 0,
            budget_at_ns: now,
            mood: START_MOOD,
            mood_at_ns: now,
            energy: START_ENERGY,
            energy_at_ns: now,
            asleep_since_ns: None,
            xp: 0,
            stage: 0,
            traits,
            starving_since_ns: None,
            last_life_state: LifeState::Happy,
        }
    }

    /// Budget in micro-USD: credit plus food at the configured NEAR price.
    pub fn budget_micro(&self, cfg: &Config) -> u64 {
        let food_micro = self.food_yocto * cfg.near_usd_rate_micro as u128 / YOCTO_PER_NEAR;
        self.credit_micro.saturating_add(food_micro as u64)
    }

    /// Brings every lazy value forward to `now` (CLAUDE.md 7.1 lazy settlement).
    pub fn settle(&mut self, now: u64, cfg: &Config) {
        self.settle_budget(now, cfg);
        let awake_from = self.settle_energy(now);
        self.settle_mood(now, awake_from);
    }

    /// Metabolism: credit first, then food.
    fn settle_budget(&mut self, now: u64, cfg: &Config) {
        let rate = cfg.metabolism_micro_per_day as u128;
        let budget = self.budget_micro(cfg) as u128;
        if rate == 0 {
            self.budget_at_ns = now;
            return;
        }
        let elapsed = now.saturating_sub(self.budget_at_ns) as u128;
        let cost = elapsed * rate / DAY_NS as u128;
        if cost >= budget {
            if self.starving_since_ns.is_none() {
                self.starving_since_ns =
                    Some(self.budget_at_ns + (budget * DAY_NS as u128 / rate) as u64);
            }
            self.credit_micro = 0;
            self.food_yocto = 0;
            self.budget_at_ns = now;
            return;
        }
        let from_credit = cost.min(self.credit_micro as u128);
        self.credit_micro -= from_credit as u64;
        let from_food = cost - from_credit;
        if from_food > 0 {
            let yocto = (from_food * YOCTO_PER_NEAR).div_ceil(cfg.near_usd_rate_micro as u128);
            self.food_yocto = self.food_yocto.saturating_sub(yocto);
        }
        self.budget_at_ns += (cost * DAY_NS as u128 / rate) as u64;
    }

    /// Energy rises while asleep; auto-wake at 100. Returns when the pet was awake from,
    /// or `None` if it slept through `now`.
    fn settle_energy(&mut self, now: u64) -> Option<u64> {
        if self.asleep_since_ns.is_none() {
            self.energy_at_ns = now;
            return Some(0);
        }
        let points = now.saturating_sub(self.energy_at_ns) / ENERGY_NS_PER_POINT;
        let needed = (100 - self.energy.min(100)) as u64;
        if points >= needed {
            let woke_at = self.energy_at_ns + needed * ENERGY_NS_PER_POINT;
            self.energy = 100;
            self.energy_at_ns = now;
            self.asleep_since_ns = None;
            return Some(woke_at);
        }
        self.energy += points as u8;
        self.energy_at_ns += points * ENERGY_NS_PER_POINT;
        None
    }

    fn settle_mood(&mut self, now: u64, awake_from: Option<u64>) {
        let Some(awake_from) = awake_from else {
            self.mood_at_ns = now;
            return;
        };
        self.mood_at_ns = self.mood_at_ns.max(awake_from);
        let points = now.saturating_sub(self.mood_at_ns) / MOOD_NS_PER_POINT;
        if points >= self.mood as u64 {
            self.mood = 0;
            self.mood_at_ns = now;
        } else {
            self.mood -= points as u8;
            self.mood_at_ns += points * MOOD_NS_PER_POINT;
        }
    }

    /// 0 to 100; 100 means 3+ days of budget at the current daily burn.
    pub fn fullness(&self, cfg: &Config) -> u8 {
        let burn = cfg.metabolism_micro_per_day as u128;
        if burn == 0 {
            return 100;
        }
        (self.budget_micro(cfg) as u128 * 100 / (3 * burn)).min(100) as u8
    }

    /// Call after `settle(now)`.
    pub fn life_state(&self, now: u64, cfg: &Config) -> LifeState {
        if let Some(since) = self.starving_since_ns {
            return if now.saturating_sub(since) >= DORMANT_AFTER_NS {
                LifeState::Dormant
            } else {
                LifeState::Starving
            };
        }
        if self.asleep_since_ns.is_some() || self.energy < 15 {
            LifeState::Sleepy
        } else if self.fullness(cfg) < 40 {
            LifeState::Hungry
        } else if self.mood < 40 {
            LifeState::Sad
        } else {
            LifeState::Happy
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::accounts;

    const T0: u64 = 1_000 * DAY_NS;

    fn cfg() -> Config {
        // $0.20 per NEAR, metabolism $0.001 per day.
        Config::with_defaults(
            accounts(0),
            accounts(1),
            accounts(2),
            accounts(3),
            "org".into(),
        )
    }

    /// Food worth `micro` micro-USD at the default rate.
    fn food(micro: u128) -> u128 {
        micro * YOCTO_PER_NEAR / 200_000
    }

    fn pet(credit_micro: u64, food_micro: u128) -> Pet {
        let mut p = Pet::new("Mochi".into(), T0, food(food_micro), [1, 2, 3, 4, 5]);
        p.credit_micro = credit_micro;
        p
    }

    #[test]
    fn new_pet_starts_happy_and_full_of_energy() {
        let p = pet(0, 20_000); // starter food: 0.1 NEAR at $0.20
        assert_eq!((p.mood, p.energy), (START_MOOD, START_ENERGY));
        assert_eq!(p.life_state(T0, &cfg()), LifeState::Happy);
    }

    #[test]
    fn metabolism_spends_credit_before_food() {
        let mut p = pet(1_500, 10_000);
        p.settle(T0 + DAY_NS, &cfg()); // costs 1_000
        assert_eq!(p.credit_micro, 500);
        assert_eq!(p.budget_micro(&cfg()), 10_500);

        p.settle(T0 + 2 * DAY_NS, &cfg()); // 500 from credit, 500 from food
        assert_eq!(p.credit_micro, 0);
        assert_eq!(p.budget_micro(&cfg()), 9_500);
    }

    #[test]
    fn frequent_settles_lose_no_decay() {
        let mut every_min = pet(0, 10_000);
        let mut once = every_min.clone();
        for m in 1..=(24 * 60) {
            every_min.settle(T0 + m * MINUTE_NS, &cfg());
        }
        once.settle(T0 + DAY_NS, &cfg());
        assert_eq!(every_min.budget_micro(&cfg()), once.budget_micro(&cfg()));
        assert_eq!(every_min.mood, once.mood);
        assert_eq!(once.mood, START_MOOD - 48);
    }

    #[test]
    fn starving_since_is_exact_time_budget_hit_zero() {
        let mut p = pet(0, 500); // half a day of metabolism
        p.settle(T0 + 3 * DAY_NS, &cfg());
        assert_eq!(p.budget_micro(&cfg()), 0);
        assert_eq!(p.starving_since_ns, Some(T0 + DAY_NS / 2));
        assert_eq!(p.life_state(T0 + 3 * DAY_NS, &cfg()), LifeState::Starving);
    }

    #[test]
    fn starving_for_72_hours_is_dormant() {
        let mut p = pet(0, 0);
        p.settle(T0 + 1, &cfg());
        assert_eq!(p.starving_since_ns, Some(T0));
        let later = T0 + 72 * HOUR_NS;
        p.settle(later, &cfg());
        assert_eq!(
            p.starving_since_ns,
            Some(T0),
            "stays at first starving time"
        );
        assert_eq!(p.life_state(later, &cfg()), LifeState::Dormant);
    }

    #[test]
    fn mood_does_not_decay_while_asleep() {
        let mut p = pet(0, 10_000);
        p.energy = 10;
        p.asleep_since_ns = Some(T0);
        p.settle(T0 + 2 * HOUR_NS, &cfg());
        assert_eq!(p.mood, START_MOOD);
        assert_eq!(p.energy, 26);
        assert_eq!(p.life_state(T0 + 2 * HOUR_NS, &cfg()), LifeState::Sleepy);
    }

    #[test]
    fn auto_wakes_at_100_energy_then_mood_decays() {
        let mut p = pet(0, 10_000);
        p.energy = 92; // 1 hour of sleep to full
        p.asleep_since_ns = Some(T0);
        p.settle(T0 + 3 * HOUR_NS, &cfg());
        assert_eq!(p.energy, 100);
        assert_eq!(p.asleep_since_ns, None);
        assert_eq!(p.mood, START_MOOD - 4, "decays only for the 2 awake hours");
    }

    #[test]
    fn low_energy_is_sleepy() {
        let mut p = pet(0, 10_000);
        p.energy = 14;
        assert_eq!(p.life_state(T0, &cfg()), LifeState::Sleepy);
    }

    #[test]
    fn fullness_is_100_at_three_days_of_budget() {
        assert_eq!(pet(0, 3_000).fullness(&cfg()), 100);
        assert_eq!(pet(0, 30_000).fullness(&cfg()), 100);
        assert_eq!(pet(0, 1_500).fullness(&cfg()), 50);
    }

    #[test]
    fn low_fullness_is_hungry() {
        let p = pet(0, 1_000); // 1 of 3 days = 33
        assert_eq!(p.life_state(T0, &cfg()), LifeState::Hungry);
    }

    #[test]
    fn fed_but_low_mood_is_sad() {
        let mut p = pet(0, 10_000);
        p.mood = 39;
        assert_eq!(p.life_state(T0, &cfg()), LifeState::Sad);
    }
}
