import type { Module } from "./deps";
import { gardenModule } from "./fuel/garden";
import { ordersModule } from "./fuel/orders";
import { petsModule } from "./routes/pets";
import { walletModule } from "./wallet/wallet";

// Each feature area registers here (one line each). Keep alphabetical-ish to ease merges.
export const MODULES: Module[] = [
  petsModule,
  ordersModule(),
  gardenModule(),
  walletModule(),
];
