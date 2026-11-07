//! Throwaway S6 spike (CLAUDE.md 14): can a contract be the NEARON iNEAR holder?
//! One owner-only passthrough to any pool method, with the result logged by a callback.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Spike {
    owner: AccountId,
    pool: AccountId,
}

#[near]
impl Spike {
    #[init]
    pub fn new(owner: AccountId, pool: AccountId) -> Self {
        Self { owner, pool }
    }

    /// Calls `pool.method(args)` with `deposit` yocto from this contract's balance and `gas_tgas` gas.
    pub fn call_pool(
        &mut self,
        method: String,
        args: String,
        deposit: U128,
        gas_tgas: u64,
    ) -> Promise {
        require!(env::predecessor_account_id() == self.owner, "Only owner");
        env::log_str(&format!(
            "call {method} deposit={} gas={gas_tgas}T prepaid={}T",
            deposit.0,
            env::prepaid_gas().as_tgas()
        ));
        Promise::new(self.pool.clone())
            .function_call(
                method.clone(),
                args.into_bytes(),
                NearToken::from_yoctonear(deposit.0),
                Gas::from_tgas(gas_tgas),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(5))
                    .on_pool(method),
            )
    }

    #[private]
    pub fn on_pool(&mut self, method: String) -> bool {
        match env::promise_result_checked(0, 4096) {
            Ok(bytes) => {
                env::log_str(&format!("ok {method}: {}", String::from_utf8_lossy(&bytes)));
                true
            }
            Err(e) => {
                env::log_str(&format!("failed {method}: {e:?}"));
                false
            }
        }
    }
}
