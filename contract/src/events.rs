//! NEP-297 events, standard `nearling` (CLAUDE.md 7.5).

use near_sdk::env;
use near_sdk::serde_json::{json, Value};

pub fn emit(event: &str, data: Value) {
    let log = json!({
        "standard": "nearling",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{log}"));
}
