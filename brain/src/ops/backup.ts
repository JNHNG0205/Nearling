import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/db";
import { log } from "../log";

/**
 * O2: daily SQLite backup (memories, orders, inbox) with better-sqlite3's online `db.backup()`,
 * into `BACKUP_DIR`, keeping the newest KEEP files. Backups hold sealed memories, so the folder
 * needs the same care as the live DB (and the same MEMORY_MASTER_KEY to be useful).
 */

export const KEEP = 7;
export const BACKUP_EVERY_MS = 24 * 3600_000;
const NAME = /^nearling-\d{8}T\d{6}Z\.db$/;

export const backupName = (now: number) =>
  `nearling-${new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.db`;

/** Backup files, newest first. */
export function listBackups(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse();
  } catch {
    return [];
  }
}

/** Time (unix ms, from the file name) of the newest backup, or null if none. */
export function lastBackupAt(dir: string): number | null {
  const [newest] = listBackups(dir);
  const m = newest?.match(/^nearling-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/);
  if (!m) return null;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}

export async function backupOnce(db: Db, dir: string, now: number, keep = KEEP): Promise<string | null> {
  if (db.memory) return null; // tests and :memory: dev runs
  mkdirSync(dir, { recursive: true });
  const name = backupName(now);
  const t0 = Date.now();
  try {
    await db.backup(join(dir, name));
  } catch (e) {
    log.alert("sqlite backup failed", { error: e instanceof Error ? e.name : "Error" });
    return null;
  }
  for (const old of listBackups(dir).slice(keep)) {
    try {
      unlinkSync(join(dir, old));
    } catch {
      // ignore: retried on the next run
    }
  }
  log.info("sqlite backup", { file: name, ms: Date.now() - t0 });
  return name;
}
