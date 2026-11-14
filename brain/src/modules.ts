import type { Module } from "./deps";
import { authModule } from "./identity/auth";
import { careModule } from "./identity/care";
import { closetModule } from "./identity/closet";
import { devicesModule } from "./identity/devices";
import { hatchModule } from "./identity/hatch";
import { receiptsModule } from "./receipts/receipts";
import { inboxModule } from "./proactive/inbox";
import { createProactiveModule } from "./proactive/scheduler";
import { raceModule } from "./race/routes";
import { petsModule } from "./routes/pets";
import { streamModule } from "./stream/stream";
import { timelineModule } from "./timeline/timeline";
import { gardenModule } from "./fuel/garden";
import { ordersModule } from "./fuel/orders";
import { walletModule } from "./wallet/wallet";
import { chargeModule } from "./fuel/charge";
import { metadataModule } from "./metadata";
import { opsModule } from "./ops/ops";
import { relayModule } from "./relay/relay";
import { dueFollowUps } from "./talk/memory";
import { generateProactive, talkModule } from "./talk/talk";
import { voiceModule } from "./talk/voice-route";

// Each feature area registers here (one line each). Keep alphabetical-ish to ease merges.
export const MODULES: Module[] = [
  petsModule,
  authModule,
  devicesModule,
  hatchModule,
  careModule,
  closetModule,
  receiptsModule,
  inboxModule,
  createProactiveModule((deps) => ({ generateProactive, dueFollowUps: async (ref, owner, day) => dueFollowUps(deps, ref, owner, day) })),
  streamModule,
  timelineModule,
  ordersModule(),
  gardenModule(),
  walletModule(),
  raceModule,
  talkModule,
  voiceModule,
  chargeModule,
  opsModule(),
  metadataModule(),
  relayModule,
];
