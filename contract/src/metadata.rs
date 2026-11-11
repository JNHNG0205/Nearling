//! NEP-177 token metadata synced with the pet: the brain pins the pet's image and public JSON to
//! IPFS and points the NFT at them; the description follows the Soul.

use crate::pet::Pet;
use crate::{events, Contract, ContractExt};
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::Base64VecU8;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require};

const MAX_LINK_BYTES: usize = 256;
const HASH_BYTES: usize = 32;
const DESCRIPTION_BYTES: usize = 200;
const METADATA_COOLDOWN_NS: u64 = 60 * 1_000_000_000;

#[near]
impl Contract {
    /// Brain only, at most once a minute per pet. `media` and `reference` are `ipfs://` links,
    /// each hash is the sha256 of the pinned file.
    pub fn set_metadata(
        &mut self,
        pet_id: TokenId,
        media: String,
        media_hash: Base64VecU8,
        reference: String,
        reference_hash: Base64VecU8,
    ) {
        self.require_brain();
        let mut pet = self.load_pet(&pet_id);
        for link in [&media, &reference] {
            require!(
                link.len() <= MAX_LINK_BYTES && link.starts_with("ipfs://"),
                "E_METADATA: Links must be ipfs:// and at most 256 bytes"
            );
        }
        for hash in [&media_hash, &reference_hash] {
            require!(
                hash.0.len() == HASH_BYTES,
                "E_METADATA: Hashes must be 32 bytes (sha256)"
            );
        }
        let now = env::block_timestamp();
        require!(
            pet.metadata_at_ns
                .is_none_or(|t| now >= t + METADATA_COOLDOWN_NS),
            "E_COOLDOWN: Metadata updates at most once a minute"
        );
        pet.metadata_at_ns = Some(now);
        let mut m = self.token_metadata(&pet_id);
        m.description = soul_description(&pet);
        m.media = Some(media.clone());
        m.media_hash = Some(media_hash);
        m.reference = Some(reference.clone());
        m.reference_hash = Some(reference_hash);
        m.updated_at = Some(env::block_timestamp_ms().to_string());
        self.write_token_metadata(&pet_id, &m);
        self.save_pet(&pet_id, pet);
        events::emit(
            "metadata_updated",
            json!({ "pet_id": pet_id, "media": media, "reference": reference }),
        );
    }
}

impl Contract {
    /// Wallets show the new Soul before the brain re-pins the image and JSON.
    pub(crate) fn sync_description(&mut self, pet_id: &TokenId, pet: &Pet) {
        let mut m = self.token_metadata(pet_id);
        m.description = soul_description(pet);
        self.write_token_metadata(pet_id, &m);
    }

    fn token_metadata(&self, pet_id: &TokenId) -> TokenMetadata {
        self.tokens
            .token_metadata_by_id
            .as_ref()
            .and_then(|by_id| by_id.get(pet_id))
            .unwrap_or_default()
    }

    fn write_token_metadata(&mut self, pet_id: &TokenId, m: &TokenMetadata) {
        if let Some(by_id) = self.tokens.token_metadata_by_id.as_mut() {
            by_id.insert(pet_id, m);
        }
    }
}

/// The first 200 bytes of the Soul, cut on a char boundary; `None` without a Soul.
pub(crate) fn soul_description(pet: &Pet) -> Option<String> {
    let mut end = pet.soul.len().min(DESCRIPTION_BYTES);
    while !pet.soul.is_char_boundary(end) {
        end -= 1;
    }
    Some(pet.soul[..end].to_string()).filter(|d| !d.is_empty())
}
