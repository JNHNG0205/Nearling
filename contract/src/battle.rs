//! Pet battles (docs/superpowers/specs/2026-11-14-pet-battle-design.md 3.1): battle level and XP
//! per pet, written only by the brain after it refereed a battle. Stored in their own collections
//! (built on demand from `StorageKey`), so `Pet` and the contract struct keep their layout and the
//! contract updates in place. The XP table equals `xpFor`/`addXp` in packages/battle.

use crate::pet::DAY_NS;
use crate::*;
use near_sdk::store::LookupSet;

const MAX_LEVEL: u8 = 20;
const DAILY_XP_CAP: u32 = 100;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct BattleRecord {
    pub level: u8,
    pub xp: u32,
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
    /// XP gained on `day` (UTC day index), capped at 100
    pub xp_today: u32,
    pub day: u32,
}

impl Default for BattleRecord {
    fn default() -> Self {
        Self {
            level: 1,
            xp: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            xp_today: 0,
            day: 0,
        }
    }
}

impl BattleRecord {
    /// Adds `gain` under the daily cap and levels up at 20 x L; returns (applied xp, levels gained).
    fn add(&mut self, gain: u32, day: u32) -> (u32, u8) {
        if self.day != day {
            self.day = day;
            self.xp_today = 0;
        }
        let gain = gain.min(DAILY_XP_CAP.saturating_sub(self.xp_today));
        self.xp_today += gain;
        self.xp += gain;
        let mut gained = 0;
        while self.level < MAX_LEVEL && self.xp >= 20 * u32::from(self.level) {
            self.xp -= 20 * u32::from(self.level);
            self.level += 1;
            gained += 1;
        }
        (gain, gained)
    }
}

fn win_xp(own: u8, opp: u8) -> u32 {
    (20 + 5 * (i32::from(opp) - i32::from(own))).clamp(10, 40) as u32
}

fn records() -> LookupMap<TokenId, BattleRecord> {
    LookupMap::new(StorageKey::Battles)
}

fn seen_ids() -> LookupSet<[u8; 8]> {
    LookupSet::new(StorageKey::BattleIds)
}

#[near]
impl Contract {
    /// Brain only. Scores one finished battle for both pets; a `battle_id` seen before is a no-op,
    /// so the brain can retry. `loser_ran`: the loser conceded (Run) and gets no XP.
    pub fn record_battle(
        &mut self,
        winner: TokenId,
        loser: TokenId,
        draw: bool,
        loser_ran: bool,
        battle_id: String,
    ) {
        self.require_brain();
        require!(winner != loser, "E_BATTLE: A pet cannot battle itself");
        self.owner_of(&winner);
        self.owner_of(&loser);

        let mut ids = seen_ids();
        let hash = env::sha256_array(battle_id.as_bytes());
        let mut key = [0u8; 8];
        key.copy_from_slice(&hash[..8]);
        if ids.contains(&key) {
            return;
        }
        ids.insert(key);

        let day = (env::block_timestamp() / DAY_NS) as u32;
        let mut map = records();
        let mut w = map.get(&winner).cloned().unwrap_or_default();
        let mut l = map.get(&loser).cloned().unwrap_or_default();
        let (w_gain, l_gain) = if draw {
            (10, 10)
        } else {
            (win_xp(w.level, l.level), if loser_ran { 0 } else { 8 })
        };
        let (w_xp, w_up) = w.add(w_gain, day);
        let (l_xp, l_up) = l.add(l_gain, day);
        if draw {
            w.draws += 1;
            l.draws += 1;
        } else {
            w.wins += 1;
            l.losses += 1;
        }

        events::emit(
            "battle",
            json!({
                "battle_id": battle_id, "winner": winner, "loser": loser, "draw": draw,
                "xp": [w_xp, l_xp], "level": [w.level, l.level],
            }),
        );
        for (pet_id, up, level) in [(&winner, w_up, w.level), (&loser, l_up, l.level)] {
            if up > 0 {
                events::emit(
                    "battle_level_up",
                    json!({ "pet_id": pet_id, "level": level }),
                );
            }
        }
        map.insert(winner, w);
        map.insert(loser, l);
        map.flush();
    }

    /// A pet's battle record; level 1 and zeros before its first battle.
    pub fn get_battle(&self, pet_id: TokenId) -> BattleRecord {
        self.owner_of(&pet_id);
        records().get(&pet_id).cloned().unwrap_or_default()
    }
}
