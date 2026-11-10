import { EventEmitter } from "node:events";

/**
 * In-process bus for live updates to web sessions (SSE, `GET /pets/:petRef/stream`).
 * One brain instance, so an EventEmitter is enough (AI-brain 01 section 6).
 * Event names (08-api-reference): state, fuel_charged, fuel_added, inbox, paired,
 * approval_ready, approval_status, evolved, receipt_ready.
 */
export interface PetEvent {
  petRef: string;
  type: string;
  data: Record<string, unknown>;
}

const bus = new EventEmitter();
bus.setMaxListeners(1000);

export function publish(petRef: string, type: string, data: Record<string, unknown> = {}): void {
  bus.emit("pet", { petRef, type, data } satisfies PetEvent);
}

export function subscribe(petRef: string, fn: (e: PetEvent) => void): () => void {
  const h = (e: PetEvent) => {
    if (e.petRef === petRef) fn(e);
  };
  bus.on("pet", h);
  return () => bus.off("pet", h);
}

/** Every pet's events (background jobs that react to any pet, e.g. the evolved inbox line). */
export function subscribeAll(fn: (e: PetEvent) => void): () => void {
  bus.on("pet", fn);
  return () => bus.off("pet", fn);
}
