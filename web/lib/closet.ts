// Closet items from shirts-contract tokens: a plain shirt, or a costume bought with `buy(costume)`
// (its key in `metadata.extra`, drawn by @petto/sprites). Pure helpers, tested.
import { COSTUME_KEYS, isCostume, type CostumeKey } from "@petto/sprites";
import type { NftToken } from "./chain";

export interface ClosetItem {
  tokenId: string;
  title: string;
  costume: CostumeKey | null;
}

function costumeOf(t: NftToken): CostumeKey | null {
  try {
    const key = (JSON.parse(t.metadata?.extra ?? "null") as { costume?: unknown } | null)?.costume;
    return typeof key === "string" && isCostume(key) ? key : null;
  } catch {
    return null;
  }
}

/** "ice_cube" -> "Ice cube". */
export function costumeLabel(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function closetItems(tokens: NftToken[]): ClosetItem[] {
  return tokens.map((t) => {
    const costume = costumeOf(t);
    return { tokenId: t.token_id, title: costume ? costumeLabel(costume) : t.metadata?.title || "Petto Shirt", costume };
  });
}

/** Costumes the owner does not have yet, in catalog order. */
export function shopCostumes(items: ClosetItem[]): CostumeKey[] {
  const owned = new Set(items.map((i) => i.costume));
  return COSTUME_KEYS.filter((k) => !owned.has(k));
}

/** Costume key -> the token to wear for it (the first one bought). */
export function ownedCostumes(items: ClosetItem[]): Map<CostumeKey, string> {
  const owned = new Map<CostumeKey, string>();
  for (const i of items) if (i.costume && !owned.has(i.costume)) owned.set(i.costume, i.tokenId);
  return owned;
}
