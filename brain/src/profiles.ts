import type { Db } from "./db/db";

export interface PetProfile {
  pet_ref: string;
  owner_account: string;
  owner_tz: string | null;
  form: "base" | "winged";
  evolved_at: number | null;
  care_pat: number;
  care_rock: number;
  care_sleep: number;
  care_mood: number;
  care_mood_at: number | null;
  sleeping_until: number | null;
  equipped_shirt: string | null;
  hatched_at: number | null;
  last_owner_turn_at: number | null;
  created_at: number;
}

export function getProfile(db: Db, petRef: string): PetProfile | null {
  return (db.prepare("SELECT * FROM pet_profile WHERE pet_ref = ?").get(petRef) as PetProfile | undefined) ?? null;
}

/** Returns the profile, creating it for a pet seen for the first time. */
export function ensureProfile(db: Db, petRef: string, owner: string, now: number): PetProfile {
  db.prepare(
    "INSERT INTO pet_profile (pet_ref, owner_account, created_at) VALUES (?, ?, ?) ON CONFLICT(pet_ref) DO NOTHING",
  ).run(petRef, owner, now);
  return getProfile(db, petRef)!;
}
