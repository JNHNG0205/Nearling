import type { PetState } from "@nearling/shared";

export const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL ?? "http://localhost:8787";

export class BrainRequestError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function getPetState(petRef: string, init?: RequestInit): Promise<PetState> {
  const res = await fetch(`${BRAIN_URL}/pets/${encodeURIComponent(petRef)}/state`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new BrainRequestError(res.status, body?.error?.code ?? "upstream");
  }
  return (await res.json()) as PetState;
}
