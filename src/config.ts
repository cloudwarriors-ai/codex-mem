import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { MemoryPaths } from "./types.js";

export const DEFAULT_CODEX_HOME = join(homedir(), ".codex");
export const DEFAULT_DATA_DIR = join(homedir(), ".codex-mem");
const DEFAULT_DB_FILE = "codex-mem.db";
export const DEFAULT_RUNTIME_DIR = "runtime";

export function resolvePaths(input?: {
  codexHome?: string;
  dataDir?: string;
  dbPath?: string;
}): MemoryPaths {
  const codexHome = resolve(
    input?.codexHome ?? process.env.CODEX_HOME ?? DEFAULT_CODEX_HOME,
  );

  const dataDir = resolve(
    input?.dataDir ?? process.env.CODEX_MEM_DATA_DIR ?? DEFAULT_DATA_DIR,
  );

  mkdirSync(dataDir, { recursive: true });

  const dbPath = resolve(
    input?.dbPath ??
      process.env.CODEX_MEM_DB_PATH ??
      join(dataDir, DEFAULT_DB_FILE),
  );

  return { codexHome, dataDir, dbPath };
}

export const MAX_STORED_TEXT_LENGTH = 8_000;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;

export function isSharedDefaultDataDir(dataDir: string): boolean {
  return resolve(dataDir) === resolve(DEFAULT_DATA_DIR);
}

export function resolveRuntimeDir(dataDir: string): string {
  return join(resolve(dataDir), DEFAULT_RUNTIME_DIR);
}

export function detectHostRuntimeContext(): "host" | "docker" {
  if (process.env.CODEX_MEM_RUNTIME_CONTEXT === "docker") return "docker";
  return existsSync("/.dockerenv") ? "docker" : "host";
}
