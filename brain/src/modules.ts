import type { Module } from "./deps";
import { authModule } from "./identity/auth";
import { careModule } from "./identity/care";
import { closetModule } from "./identity/closet";
import { devicesModule } from "./identity/devices";
import { receiptsModule } from "./receipts/receipts";
import { inboxModule } from "./proactive/inbox";
import { proactiveModule } from "./proactive/scheduler";
import { petsModule } from "./routes/pets";
import { streamModule } from "./stream/stream";
import { timelineModule } from "./timeline/timeline";

// Each feature area registers here (one line each). Keep alphabetical-ish to ease merges.
export const MODULES: Module[] = [
  petsModule,
  authModule,
  devicesModule,
  careModule,
  closetModule,
  receiptsModule,
  inboxModule,
  proactiveModule,
  streamModule,
  timelineModule,
];
