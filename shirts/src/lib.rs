//! Nearling shirts: a separate NEP-171 collection for the Closet (CLAUDE.md 5.6, Build Spec 5).
//! One free claim per account; the claimer pays the token's storage. The app reads ownership
//! with `nft_tokens_for_owner` and the device draws the equipped shirt as a sprite layer.

use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::store::LookupSet;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};
use std::collections::HashMap;

/// Attached by the claimer; covers the token's storage, the rest is refunded.
const CLAIM_DEPOSIT: NearToken = NearToken::from_millinear(10);

/// Price of one costume (storage included); it stays with the contract.
const COSTUME_PRICE: NearToken = NearToken::from_millinear(50);

/// Costume keys the sprites draw (packages/sprites costumes); one NFT per purchase.
const COSTUMES: [&str; 38] = [
    "cap",
    "sunglasses",
    "fire",
    "scarf",
    "ice_cube",
    "wizard_hat",
    "pirate_hat",
    "flower_crown",
    "top_hat",
    "striped_shirt",
    "headphones",
    "detective",
    "ninja",
    "devil_wings",
    "chef_hat",
    "astronaut",
    "clown",
    "cyborg",
    "explorer",
    "bow_tie",
    "crown",
    "fairy_wings",
    "graduate",
    "viking",
    "raincoat",
    "volcano",
    "mummy",
    "tuxedo",
    "ghost",
    "knight",
    "angel",
    "superhero",
    "cowboy",
    "party_hat",
    "sweater",
    "ice_crystal",
    "ceo",
    "spy",
];

/// `costumes()` view: the catalog and the flat price.
#[near(serializers = [json])]
pub struct Catalog {
    pub costumes: Vec<String>,
    pub price: U128,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Owners,
    TokenMetadata,
    Enumeration,
    Claimed,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Shirts {
    tokens: NonFungibleToken,
    claimed: LookupSet<AccountId>,
    next_id: u64,
}

#[near]
impl Shirts {
    #[init]
    pub fn new() -> Self {
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::Owners,
                env::current_account_id(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                None::<StorageKey>,
            ),
            claimed: LookupSet::new(StorageKey::Claimed),
            next_id: 0,
        }
    }

    /// One shirt per account, ever. Attach `CLAIM_DEPOSIT` (0.01 NEAR) for storage.
    #[payable]
    pub fn claim(&mut self) -> TokenId {
        require!(
            env::attached_deposit() >= CLAIM_DEPOSIT,
            "E_DEPOSIT: Attach 0.01 NEAR for storage"
        );
        let owner = env::predecessor_account_id();
        require!(
            self.claimed.insert(owner.clone()),
            "E_CLAIMED: One shirt per account"
        );
        let id = self.next_id.to_string();
        self.next_id += 1;
        let metadata = TokenMetadata {
            title: Some("Petto Shirt".to_string()),
            ..Default::default()
        };
        // Refunds the deposit beyond the token's storage and emits nft_mint.
        self.tokens.internal_mint(id.clone(), owner, Some(metadata));
        id
    }

    /// Buy a costume for the Closet: attach exactly `COSTUME_PRICE` (0.05 NEAR). The NFT records
    /// its costume in `metadata.extra` ({"costume": key}); the price stays with the contract.
    #[payable]
    pub fn buy(&mut self, costume: String) -> TokenId {
        require!(
            env::attached_deposit() == COSTUME_PRICE,
            format!("E_DEPOSIT: Attach exactly {COSTUME_PRICE}")
        );
        require!(
            COSTUMES.contains(&costume.as_str()),
            "E_COSTUME: Unknown costume"
        );
        let id = self.next_id.to_string();
        self.next_id += 1;
        let metadata = TokenMetadata {
            title: Some(format!("Petto costume: {costume}")),
            extra: Some(format!(r#"{{"costume":"{costume}"}}"#)),
            ..Default::default()
        };
        // no refund account: the whole price stays (it covers the token's storage too)
        self.tokens.internal_mint_with_refund(
            id.clone(),
            env::predecessor_account_id(),
            Some(metadata),
            None,
        );
        id
    }

    pub fn costumes(&self) -> Catalog {
        Catalog {
            costumes: COSTUMES.iter().map(|c| c.to_string()).collect(),
            price: U128(COSTUME_PRICE.as_yoctonear()),
        }
    }
}

#[near]
impl NonFungibleTokenCore for Shirts {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.tokens
            .nft_transfer(receiver_id, token_id, approval_id, memo)
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Shirts {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

#[near]
impl NonFungibleTokenEnumeration for Shirts {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Shirts {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Petto Shirts".to_string(),
            symbol: "PSHIRT".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(who: AccountId, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who)
            .attached_deposit(deposit)
            .build());
    }

    fn setup() -> Shirts {
        ctx(accounts(0), NearToken::from_yoctonear(0));
        Shirts::new()
    }

    #[test]
    fn buying_a_costume_mints_it_with_its_key_and_keeps_the_price() {
        let mut shirts = setup();
        ctx(accounts(1), COSTUME_PRICE);
        let id = shirts.buy("wizard_hat".to_string());
        let token = shirts.nft_token(id).unwrap();
        assert_eq!(token.owner_id, accounts(1));
        let m = token.metadata.unwrap();
        assert_eq!(m.title.as_deref(), Some("Petto costume: wizard_hat"));
        assert_eq!(m.extra.as_deref(), Some(r#"{"costume":"wizard_hat"}"#));
        assert!(
            near_sdk::test_utils::get_created_receipts().is_empty(),
            "no refund: the price is the price"
        );
    }

    #[test]
    #[should_panic(expected = "E_DEPOSIT: Attach exactly 0.050 NEAR")]
    fn a_costume_costs_exactly_its_price() {
        let mut shirts = setup();
        ctx(accounts(1), CLAIM_DEPOSIT);
        shirts.buy("crown".to_string());
    }

    #[test]
    #[should_panic(expected = "E_COSTUME: Unknown costume")]
    fn only_listed_costumes_can_be_bought() {
        let mut shirts = setup();
        ctx(accounts(1), COSTUME_PRICE);
        shirts.buy("tiara".to_string());
    }

    #[test]
    fn the_catalog_lists_all_38_costumes_and_the_price() {
        let c = setup().costumes();
        assert_eq!(c.costumes.len(), 38);
        assert!(c.costumes.contains(&"ceo".to_string()));
        assert!(c.costumes.contains(&"spy".to_string()));
        assert_eq!(c.price, U128(COSTUME_PRICE.as_yoctonear()));
        assert!(c.costumes.contains(&"ghost".to_string()));
    }

    #[test]
    fn claiming_mints_a_shirt_to_the_caller() {
        let mut shirts = setup();
        ctx(accounts(1), CLAIM_DEPOSIT);
        let id = shirts.claim();
        assert_eq!(id, "0");
        let token = shirts.nft_token(id).unwrap();
        assert_eq!(token.owner_id, accounts(1));
        assert_eq!(
            token.metadata.unwrap().title.as_deref(),
            Some("Petto Shirt")
        );
        assert!(get_logs().iter().any(|l| l.contains("nft_mint")));
    }

    #[test]
    fn the_collection_is_named_petto_shirts() {
        let m = setup().nft_metadata();
        assert_eq!(
            (m.name.as_str(), m.symbol.as_str()),
            ("Petto Shirts", "PSHIRT")
        );
    }

    #[test]
    fn each_account_gets_its_own_shirt() {
        let mut shirts = setup();
        ctx(accounts(1), CLAIM_DEPOSIT);
        shirts.claim();
        ctx(accounts(2), CLAIM_DEPOSIT);
        assert_eq!(shirts.claim(), "1");
        assert_eq!(shirts.nft_total_supply().0, 2);
    }

    #[test]
    #[should_panic(expected = "E_CLAIMED: One shirt per account")]
    fn an_account_can_claim_only_once() {
        let mut shirts = setup();
        ctx(accounts(1), CLAIM_DEPOSIT);
        shirts.claim();
        shirts.claim();
    }

    #[test]
    #[should_panic(expected = "E_DEPOSIT: Attach 0.01 NEAR for storage")]
    fn claiming_needs_the_storage_deposit() {
        let mut shirts = setup();
        ctx(accounts(1), NearToken::from_millinear(9));
        shirts.claim();
    }

    #[test]
    fn a_shirt_follows_its_owner_and_the_giver_cannot_claim_again() {
        let mut shirts = setup();
        ctx(accounts(1), CLAIM_DEPOSIT);
        let id = shirts.claim();
        ctx(accounts(1), NearToken::from_yoctonear(1));
        shirts.nft_transfer(accounts(2), id.clone(), None, None);
        assert_eq!(shirts.nft_token(id).unwrap().owner_id, accounts(2));
        assert_eq!(
            shirts.nft_tokens_for_owner(accounts(1), None, None).len(),
            0
        );
        ctx(accounts(1), CLAIM_DEPOSIT);
        let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| shirts.claim()));
        assert!(again.is_err(), "claim is once per account, ever");
    }
}
