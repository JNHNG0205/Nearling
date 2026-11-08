//! Pet state and lazy settlement (CLAUDE.md 5.2, 5.3, 7.1). Pure: no env calls.

use crate::Config;
use near_sdk::json_types::{U128, U64};
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

/// XP needed for Baby, Teen, Adult (CLAUDE.md 5.4).
const STAGE_XP: [u32; 3] = [10, 100, 500];
const CHECKIN_XP: u32 = 2;
const ENERGY_PER_CHAT: u8 = 3;
const TRAIT_MOVE_PER_DAY: i8 = 2;

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
    /// UTC day index (`now / DAY_NS`) the daily counters below belong to.
    pub today: u32,
    pub spent_today_micro: u64,
    pub xp_today: u32,
    pub traits_moved_today: [i8; 5],
    /// EMA of daily thought spend, updated on day rollover.
    pub avg_daily_spend_micro: u64,
    pub last_checkin_day: Option<u32>,
    pub streak: u16,
    /// Owner's NEARON stake for this pet (yocto). Credit accrues on it from `credit_at_ns`.
    pub staked: u128,
    pub credit_at_ns: u64,
    pub pending_unstake: Option<PendingUnstake>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingUnstake {
    pub amount: U128,
    pub unlock_epoch: U64,
}

/// What the brain asks `charge` to apply; all values are clamped (CLAUDE.md 7.2).
pub struct Thought {
    pub cost_micro: u64,
    pub xp_gain: u32,
    pub mood_delta: i8,
    pub trait_deltas: [i8; 5],
}

#[derive(Debug, PartialEq)]
pub struct ThoughtOutcome {
    pub charged_micro: u64,
    /// Food spent on this thought; goes to the treasury.
    pub food_yocto: u128,
    pub stage_up: Option<u8>,
}

pub fn day_of(now: u64) -> u32 {
    (now / DAY_NS) as u32
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
            today: day_of(now),
            spent_today_micro: 0,
            xp_today: 0,
            traits_moved_today: [0; 5],
            avg_daily_spend_micro: 0,
            last_checkin_day: None,
            streak: 0,
            staked: 0,
            credit_at_ns: now,
            pending_unstake: None,
        }
    }

    /// Spends up to `micro`, credit first, then food. Returns (micro spent, food yocto spent).
    pub fn spend(&mut self, micro: u64, cfg: &Config) -> (u64, u128) {
        let micro = micro.min(self.budget_micro(cfg));
        let from_credit = micro.min(self.credit_micro);
        self.credit_micro -= from_credit;
        let from_food = (micro - from_credit) as u128;
        if from_food == 0 {
            return (micro, 0);
        }
        let yocto = (from_food * YOCTO_PER_NEAR)
            .div_ceil(cfg.near_usd_rate_micro as u128)
            .min(self.food_yocto);
        self.food_yocto -= yocto;
        (micro, yocto)
    }

    /// Resets daily counters on a new UTC day and folds the old day into the spend EMA.
    pub fn roll_day(&mut self, today: u32) {
        if today <= self.today {
            return;
        }
        let mut avg = (self.avg_daily_spend_micro * 3 + self.spent_today_micro) / 4;
        for _ in 1..(today - self.today).min(30) {
            avg = avg * 3 / 4;
        }
        self.avg_daily_spend_micro = avg;
        self.today = today;
        self.spent_today_micro = 0;
        self.xp_today = 0;
        self.traits_moved_today = [0; 5];
    }

    /// First owner interaction of a UTC day: extends the streak. Returns the check-in xp.
    pub fn check_in(&mut self, today: u32) -> u32 {
        match self.last_checkin_day {
            Some(day) if day == today => return 0,
            Some(day) if day + 1 == today => self.streak = self.streak.saturating_add(1),
            _ => self.streak = 1,
        }
        self.last_checkin_day = Some(today);
        CHECKIN_XP
    }

    /// Adds xp; returns the new stage if a threshold was crossed.
    pub fn add_xp(&mut self, xp: u32) -> Option<u8> {
        self.xp = self.xp.saturating_add(xp);
        let stage = STAGE_XP.iter().filter(|&&t| self.xp >= t).count() as u8;
        if stage > self.stage {
            self.stage = stage;
            return Some(stage);
        }
        None
    }

    /// One billed chat from the brain. Call after `settle(now)`.
    pub fn apply_thought(&mut self, t: Thought, now: u64, cfg: &Config) -> ThoughtOutcome {
        let today = day_of(now);
        self.roll_day(today);

        let day_left = cfg
            .charge_max_per_day_micro
            .saturating_sub(self.spent_today_micro);
        let cost = t
            .cost_micro
            .min(cfg.charge_max_per_call_micro)
            .min(day_left);
        let (charged_micro, food_yocto) = self.spend(cost, cfg);
        self.spent_today_micro += charged_micro;
        if self.budget_micro(cfg) == 0 && self.starving_since_ns.is_none() {
            self.starving_since_ns = Some(now);
        }

        self.energy = self.energy.saturating_sub(ENERGY_PER_CHAT);
        let max = cfg.mood_delta_max as i16;
        let mood = self.mood as i16 + (t.mood_delta as i16).clamp(-max, max);
        self.mood = mood.clamp(0, 100) as u8;

        for (i, delta) in t.trait_deltas.iter().enumerate() {
            let moved = self.traits_moved_today[i];
            let target = moved
                .saturating_add(*delta)
                .clamp(-TRAIT_MOVE_PER_DAY, TRAIT_MOVE_PER_DAY);
            let value = (self.traits[i] as i16 + (target - moved) as i16).clamp(0, 100);
            self.traits_moved_today[i] += value as i8 - self.traits[i] as i8;
            self.traits[i] = value as u8;
        }

        let xp = t
            .xp_gain
            .min(cfg.xp_max_per_call)
            .min(cfg.xp_max_per_day.saturating_sub(self.xp_today));
        self.xp_today += xp;
        let checkin_xp = self.check_in(today);
        let stage_up = self.add_xp(xp + checkin_xp);

        ThoughtOutcome {
            charged_micro,
            food_yocto,
            stage_up,
        }
    }

    /// Budget in micro-USD: credit plus food at the configured NEAR price.
    pub fn budget_micro(&self, cfg: &Config) -> u64 {
        let food_micro = self.food_yocto * cfg.near_usd_rate_micro as u128 / YOCTO_PER_NEAR;
        self.credit_micro.saturating_add(food_micro as u64)
    }

    /// CREDIT earned per day by this pet's stake, in micro-USD.
    pub fn daily_credit_micro(&self, cfg: &Config) -> u64 {
        (self.staked * cfg.farm_rate_micro_per_near_day as u128 / YOCTO_PER_NEAR) as u64
    }

    /// Daily credit covers metabolism plus average thought spend.
    pub fn self_sustaining(&self, cfg: &Config) -> bool {
        let daily = self.daily_credit_micro(cfg);
        daily > 0 && daily >= cfg.metabolism_micro_per_day + self.avg_daily_spend_micro
    }

    /// Brings every lazy value forward to `now` (CLAUDE.md 7.1 lazy settlement).
    pub fn settle(&mut self, now: u64, cfg: &Config) {
        self.settle_credit(now, cfg);
        self.settle_budget(now, cfg);
        let awake_from = self.settle_energy(now);
        self.settle_mood(now, awake_from);
    }

    fn settle_credit(&mut self, now: u64, cfg: &Config) {
        let daily = self.daily_credit_micro(cfg) as u128;
        if daily == 0 {
            self.credit_at_ns = now;
            return;
        }
        let points = now.saturating_sub(self.credit_at_ns) as u128 * daily / DAY_NS as u128;
        self.credit_micro = self.credit_micro.saturating_add(points as u64);
        self.credit_at_ns += (points * DAY_NS as u128 / daily) as u64;
    }

    /// Metabolism: credit first, then food. A starving pet is revived only by a stake that
    /// covers its burn; smaller accruals are eaten by metabolism (CLAUDE.md 6).
    fn settle_budget(&mut self, now: u64, cfg: &Config) {
        if self.starving_since_ns.is_some() && self.self_sustaining(cfg) {
            self.starving_since_ns = None;
        }
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
        self.spend(cost as u64, cfg);
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
        let burn = cfg.metabolism_micro_per_day as u128 + self.avg_daily_spend_micro as u128;
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

    fn thought(cost_micro: u64) -> Thought {
        Thought {
            cost_micro,
            xp_gain: 0,
            mood_delta: 0,
            trait_deltas: [0; 5],
        }
    }

    #[test]
    fn spend_takes_credit_then_food_and_caps_at_budget() {
        let mut p = pet(300, 1_000);
        assert_eq!(p.spend(500, &cfg()), (500, food(200)));
        assert_eq!(p.credit_micro, 0);
        assert_eq!(p.spend(5_000, &cfg()), (800, food(800)));
        assert_eq!(p.budget_micro(&cfg()), 0);
    }

    #[test]
    fn thought_cost_is_clamped_to_per_call_cap() {
        let mut p = pet(0, 100_000);
        let out = p.apply_thought(thought(9_000), T0, &cfg());
        assert_eq!(out.charged_micro, 5_000);
        assert_eq!(out.food_yocto, food(5_000));
    }

    #[test]
    fn thought_cost_is_clamped_to_daily_cap() {
        let mut p = pet(0, 1_000_000);
        for _ in 0..20 {
            p.apply_thought(thought(5_000), T0, &cfg());
        }
        assert_eq!(p.apply_thought(thought(5_000), T0, &cfg()).charged_micro, 0);
        let next_day = p.apply_thought(thought(5_000), T0 + DAY_NS, &cfg());
        assert_eq!(next_day.charged_micro, 5_000);
    }

    #[test]
    fn thought_on_short_budget_charges_what_is_left_and_starves() {
        let mut p = pet(0, 1_200);
        let out = p.apply_thought(thought(5_000), T0, &cfg());
        assert_eq!(out.charged_micro, 1_200);
        assert_eq!(p.starving_since_ns, Some(T0));
        assert_eq!(p.life_state(T0, &cfg()), LifeState::Starving);
    }

    #[test]
    fn thought_costs_energy() {
        let mut p = pet(0, 10_000);
        p.apply_thought(thought(100), T0, &cfg());
        assert_eq!(p.energy, START_ENERGY - 3);
    }

    #[test]
    fn mood_delta_is_clamped() {
        let mut p = pet(0, 10_000);
        p.apply_thought(
            Thought {
                mood_delta: -50,
                ..thought(0)
            },
            T0,
            &cfg(),
        );
        assert_eq!(p.mood, START_MOOD - 10);
        p.apply_thought(
            Thought {
                mood_delta: 50,
                ..thought(0)
            },
            T0,
            &cfg(),
        );
        assert_eq!(p.mood, START_MOOD);
    }

    #[test]
    fn traits_move_at_most_two_per_day() {
        let mut p = pet(0, 10_000);
        let up = Thought {
            trait_deltas: [5, -1, 0, 0, 0],
            ..thought(0)
        };
        p.apply_thought(up, T0, &cfg());
        let up = Thought {
            trait_deltas: [5, -5, 0, 0, 0],
            ..thought(0)
        };
        p.apply_thought(up, T0, &cfg());
        assert_eq!(p.traits, [3, 0, 3, 4, 5], "trait 1 starts at 2, floor 0");
        let up = Thought {
            trait_deltas: [1, 0, 0, 0, 0],
            ..thought(0)
        };
        p.apply_thought(up, T0 + DAY_NS, &cfg());
        assert_eq!(p.traits[0], 4);
    }

    #[test]
    fn xp_is_clamped_per_call_and_per_day() {
        let mut p = pet(0, 10_000);
        p.apply_thought(
            Thought {
                xp_gain: 100,
                ..thought(0)
            },
            T0,
            &cfg(),
        );
        assert_eq!(p.xp, 5 + 2, "per-call cap plus check-in");
        for _ in 0..20 {
            p.apply_thought(
                Thought {
                    xp_gain: 5,
                    ..thought(0)
                },
                T0,
                &cfg(),
            );
        }
        assert_eq!(p.xp, 50 + 2);
    }

    #[test]
    fn check_in_gives_xp_once_per_day_and_builds_a_streak() {
        let mut p = pet(0, 10_000);
        let day = day_of(T0);
        assert_eq!(p.check_in(day), 2);
        assert_eq!(p.check_in(day), 0);
        assert_eq!(p.check_in(day + 1), 2);
        assert_eq!(p.streak, 2);
        p.check_in(day + 3);
        assert_eq!(p.streak, 1, "missed a day");
    }

    #[test]
    fn crossing_a_stage_threshold_reports_it_once() {
        let mut p = pet(0, 10_000);
        assert_eq!(p.add_xp(9), None);
        assert_eq!(p.add_xp(1), Some(1));
        assert_eq!(p.add_xp(1), None);
        assert_eq!(p.add_xp(500), Some(3), "can skip to Adult");
    }

    #[test]
    fn day_rollover_updates_spend_average() {
        let mut p = pet(0, 1_000_000);
        p.apply_thought(thought(4_000), T0, &cfg());
        p.roll_day(day_of(T0) + 1);
        assert_eq!(p.avg_daily_spend_micro, 1_000);
        assert_eq!(p.spent_today_micro, 0);
        p.roll_day(day_of(T0) + 3);
        assert_eq!(p.avg_daily_spend_micro, 562, "two idle days decay it");
    }

    #[test]
    fn fullness_counts_average_spend_in_daily_burn() {
        let mut p = pet(0, 6_000);
        p.avg_daily_spend_micro = 1_000; // burn 2_000/day, 3 days = 6_000
        assert_eq!(p.fullness(&cfg()), 100);
        p.avg_daily_spend_micro = 3_000; // burn 4_000/day
        assert_eq!(p.fullness(&cfg()), 50);
    }

    #[test]
    fn stake_accrues_credit_over_time() {
        let mut p = pet(0, 100_000);
        p.staked = 10 * YOCTO_PER_NEAR; // 6_570 micro per day at the default farm rate
        assert_eq!(p.daily_credit_micro(&cfg()), 6_570);
        p.settle(T0 + DAY_NS, &cfg());
        assert_eq!(
            p.credit_micro,
            6_570 - 1_000,
            "accrued, then metabolism spent credit first"
        );
    }

    #[test]
    fn frequent_settles_lose_no_credit() {
        let mut every_min = pet(0, 100_000);
        every_min.staked = 3 * YOCTO_PER_NEAR;
        let mut once = every_min.clone();
        for m in 1..=(24 * 60) {
            every_min.settle(T0 + m * MINUTE_NS, &cfg());
        }
        once.settle(T0 + DAY_NS, &cfg());
        assert_eq!(every_min.budget_micro(&cfg()), once.budget_micro(&cfg()));
    }

    #[test]
    fn self_sustaining_when_credit_covers_daily_burn() {
        let mut p = pet(0, 10_000);
        p.staked = YOCTO_PER_NEAR; // 657 < 1_000
        assert!(!p.self_sustaining(&cfg()));
        p.staked = 2 * YOCTO_PER_NEAR; // 1_314
        assert!(p.self_sustaining(&cfg()));
        p.avg_daily_spend_micro = 500; // burn 1_500
        assert!(!p.self_sustaining(&cfg()));
    }

    #[test]
    fn small_stake_does_not_revive_a_starving_pet() {
        let mut p = pet(0, 0);
        p.settle(T0, &cfg());
        p.staked = YOCTO_PER_NEAR;
        p.credit_at_ns = T0;
        p.settle(T0 + 72 * HOUR_NS, &cfg());
        assert_eq!(p.starving_since_ns, Some(T0));
        assert_eq!(p.life_state(T0 + 72 * HOUR_NS, &cfg()), LifeState::Dormant);
    }

    #[test]
    fn self_sustaining_stake_revives_a_starving_pet() {
        let mut p = pet(0, 0);
        p.settle(T0, &cfg());
        p.staked = 10 * YOCTO_PER_NEAR;
        p.credit_at_ns = T0;
        p.settle(T0 + DAY_NS, &cfg());
        assert_eq!(p.starving_since_ns, None);
        assert!(p.credit_micro > 0);
    }
}
