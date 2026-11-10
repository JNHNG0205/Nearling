import type { Module } from "./deps";
import { petsModule } from "./routes/pets";

// Each feature area registers here (one line each). Keep alphabetical-ish to ease merges.
export const MODULES: Module[] = [
  petsModule,
];
