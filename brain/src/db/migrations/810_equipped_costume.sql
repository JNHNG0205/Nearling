-- Costume key of the equipped Closet token (shirts contract `buy(costume)`), null for a plain shirt or none.
ALTER TABLE pet_profile ADD COLUMN equipped_costume TEXT;
