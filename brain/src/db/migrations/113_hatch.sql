-- Build Spec 1: the egg hatches at Hatch & Pair (or the owner's first hatch on the web). Off-chain;
-- chain xp stages (teen, adult) still come from the contract.
ALTER TABLE pet_profile ADD COLUMN hatched_at INTEGER;
