import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRuntimeDir } from "./config.js";
import type { DaemonRuntimeMetadata, MemoryPaths } from "./types.js";

const DAEMON_STATE_FILE = "daemon.json";
const DAEMON_TOKEN_FILE = "daemon.token";

export function ensureDaemonRuntimeDir(paths: MemoryPaths): string {
  const runtimeDir = resolveRuntimeDir(paths.dataDir);
  mkdirSync(runtimeDir, { recursive: true });
  return runtimeDir;
}

export function getDaemonStatePath(paths: MemoryPaths): string {
  return join(ensureDaemonRuntimeDir(paths), DAEMON_STATE_FILE);
}

export function getDaemonTokenPath(paths: MemoryPaths): string {
  return join(ensureDaemonRuntimeDir(paths), DAEMON_TOKEN_FILE);
}

export function readDaemonRuntimeMetadata(paths: MemoryPaths): DaemonRuntimeMetadata | null {
  try {
    return JSON.parse(readFileSync(getDaemonStatePath(paths), "utf8")) as DaemonRuntimeMetadata;
  } catch {
    return null;
  }
}

export function writeDaemonRuntimeMetadata(paths: MemoryPaths, metadata: DaemonRuntimeMetadata): void {
  writeFileSync(getDaemonStatePath(paths), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export function clearDaemonRuntimeMetadata(paths: MemoryPaths, pid?: number): void {
  const statePath = getDaemonStatePath(paths);
  if (typeof pid === "number") {
    const current = readDaemonRuntimeMetadata(paths);
    if (current && current.pid !== pid) {
      return;
    }
  }
  rmSync(statePath, { force: true });
}

export function ensureDaemonToken(paths: MemoryPaths): { token: string; tokenPath: string } {
  const tokenPath = getDaemonTokenPath(paths);
  if (existsSync(tokenPath)) {
    return {
      token: readFileSync(tokenPath, "utf8").trim(),
      tokenPath,
    };
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return { token, tokenPath };
}

export function readDaemonToken(paths: MemoryPaths): string | null {
  try {
    return readFileSync(getDaemonTokenPath(paths), "utf8").trim();
  } catch {
    return null;
  }
}

export function generateDbGeneration(): string {
  return randomBytes(12).toString("hex");
}
