import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryPaths, RuntimeSurface } from "./types.js";

export interface RuntimeLock {
  surface: RuntimeSurface | string;
  pid: number;
  ppid: number;
  createdAt: string;
  command: string;
}

export interface RuntimeLockHandle {
  path: string;
  release: () => void;
}

export interface RuntimeLockOptions {
  replaceExisting?: boolean;
  expectedCommandSubstrings?: string[];
  gracefulWaitMs?: number;
  forceKillWaitMs?: number;
}

function getLocksDir(paths: MemoryPaths): string {
  return join(paths.dataDir, "runtime-locks");
}

function getLockPath(paths: MemoryPaths, surface: string): string {
  return join(getLocksDir(paths), `${surface}.json`);
}

export function acquireRuntimeLock(
  paths: MemoryPaths,
  surface: RuntimeSurface | string,
  options: RuntimeLockOptions = {},
): RuntimeLockHandle {
  mkdirSync(getLocksDir(paths), { recursive: true });
  const path = getLockPath(paths, surface);
  const existing = readRuntimeLock(path);
  if (existing && existing.pid !== process.pid && isPidAlive(existing.pid)) {
    if (!options.replaceExisting) {
      throw new Error(`runtime lock already held for ${surface} by pid ${existing.pid}`);
    }
    const expectedSubstrings = options.expectedCommandSubstrings ?? [];
    const command = readProcessCommand(existing.pid);
    const matchesExpected =
      expectedSubstrings.length === 0 || expectedSubstrings.every((part) => command.includes(part));
    if (!matchesExpected) {
      throw new Error(
        `runtime lock for ${surface} is held by unexpected pid ${existing.pid}: ${command || "unknown"}`,
      );
    }
    terminateProcess(
      existing.pid,
      options.gracefulWaitMs ?? 1500,
      options.forceKillWaitMs ?? 500,
    );
  }
  const payload: RuntimeLock = {
    surface,
    pid: process.pid,
    ppid: process.ppid,
    createdAt: new Date().toISOString(),
    command: process.argv.join(" "),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  let released = false;
  return {
    path,
    release: () => {
      if (released) return;
      released = true;
      const current = readRuntimeLock(path);
      if (current?.pid === process.pid && current.surface === surface) {
        rmSync(path, { force: true });
      }
    },
  };
}

export function listRuntimeLocks(paths: MemoryPaths): RuntimeLock[] {
  mkdirSync(getLocksDir(paths), { recursive: true });
  const locks: RuntimeLock[] = [];
  for (const entry of readdirSync(getLocksDir(paths))) {
    if (!entry.endsWith(".json")) continue;
    const path = join(getLocksDir(paths), entry);
    const payload = readRuntimeLock(path);
    if (payload) locks.push(payload);
  }
  return locks;
}

function readRuntimeLock(path: string): RuntimeLock | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RuntimeLock;
  } catch {
    // Ignore missing or malformed locks; repair flow can still proceed manually.
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readProcessCommand(pid: number): string {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function terminateProcess(pid: number, gracefulWaitMs: number, forceKillWaitMs: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  if (!waitForExit(pid, gracefulWaitMs)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return;
    }
    waitForExit(pid, forceKillWaitMs);
  }
}

function waitForExit(pid: number, timeoutMs: number): boolean {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    sleepSync(50);
  }
  return !isPidAlive(pid);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
