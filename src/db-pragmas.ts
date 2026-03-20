import type Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 2;
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
export const DEFAULT_WAL_AUTOCHECKPOINT = 200;

export function configurePragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);
  db.pragma(`wal_autocheckpoint = ${DEFAULT_WAL_AUTOCHECKPOINT}`);
}
