//! The pet's Soul: a short, public, versioned personality prompt (CLAUDE.md 1.1, Build Spec 2).
//! Only the current prompt is stored; every change emits `soul_updated` with the full text.

use crate::pet::Pet;
use crate::{events, Contract, ContractExt};
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::serde_json::json;
use near_sdk::{near, require};

const MAX_SOUL_BYTES: usize = 1024;

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct SoulView {
    pub version: u32,
    pub prompt: String,
}

#[near]
impl Contract {
    /// Owner only, at most 1 KB. Bumps the version.
    pub fn set_soul(&mut self, pet_id: TokenId, prompt: String) {
        self.require_owner(&pet_id);
        let mut pet = self.load_pet(&pet_id);
        write_soul(&pet_id, &mut pet, prompt);
        self.save_pet(&pet_id, pet);
    }

    pub fn get_soul(&self, pet_id: TokenId) -> SoulView {
        let pet = self.stored_pet(&pet_id);
        SoulView {
            version: pet.soul_version,
            prompt: pet.soul,
        }
    }
}

/// Checks the size, stores the prompt, bumps the version and emits `soul_updated`.
pub(crate) fn write_soul(pet_id: &TokenId, pet: &mut Pet, prompt: String) {
    require!(
        prompt.len() <= MAX_SOUL_BYTES,
        "E_SOUL_SIZE: Soul must be at most 1024 bytes"
    );
    pet.soul_version += 1;
    events::emit(
        "soul_updated",
        json!({ "pet_id": pet_id, "version": pet.soul_version, "prompt": prompt }),
    );
    pet.soul = prompt;
}
