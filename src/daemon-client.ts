import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireRuntimeLock } from "./runtime-lock.js";
import { detectHostRuntimeContext, isSharedDefaultDataDir } from "./config.js";
import {
  clearDaemonRuntimeMetadata,
  readDaemonRuntimeMetadata,
  readDaemonToken,
} from "./daemon-runtime.js";
import type { DaemonHealthReport, DaemonRuntimeMetadata, MemoryPaths } from "./types.js";

const DEFAULT_DAEMON_WAIT_MS = 12_000;
const DAEMON_POLL_INTERVAL_MS = 125;

export class DaemonClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = "DaemonClientError";
  }
}

export async function ensureDaemon(paths: MemoryPaths): Promise<DaemonRuntimeMetadata> {
  if (isSharedDefaultDataDir(paths.dataDir) && detectHostRuntimeContext() === "docker") {
    throw new DaemonClientError(
      "MEMORY_HOST_DAEMON_REQUIRED",
      "shared Codex memory daemon must run on the host; docker compatibility clients may not own or spawn the live store",
      503,
    );
  }
  const existing = await getHealthyDaemon(paths);
  if (existing) return existing;

  let startupLock: { path: string; release: () => void } | null = null;
  try {
    startupLock = tryAcquireDaemonStartLock(paths);
    if (startupLock) {
      spawnDaemon(paths);
    }
    return await waitForDaemon(paths, DEFAULT_DAEMON_WAIT_MS);
  } finally {
    if (startupLock) {
      try {
        startupLock.release();
      } catch {
        // Ignore cleanup races on shutdown.
      }
    }
  }
}

export async function readDaemonHealth(paths: MemoryPaths): Promise<DaemonHealthReport> {
  const metadata = readDaemonRuntimeMetadata(paths);
  if (!metadata) {
    return {
      daemonState: "unavailable",
      errorCode: "MEMORY_DAEMON_UNAVAILABLE",
      errorMessage: "daemon metadata missing",
    };
  }
  const token = readDaemonToken(paths);
  if (!token) {
    return {
      daemonState: "unavailable",
      metadata,
      errorCode: "MEMORY_DAEMON_UNAVAILABLE",
      errorMessage: "daemon token missing",
    };
  }

  try {
    const response = await fetch(`http://${metadata.host}:${metadata.port}/health`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const body = (await response.json()) as {
      health?: { safeToStart?: boolean; degradedReason?: string; status?: string };
      error?: { code?: string; message?: string };
    };
    if (!response.ok) {
      return {
        daemonState: "degraded",
        metadata,
        errorCode: body.error?.code ?? "MEMORY_DAEMON_UNAVAILABLE",
        errorMessage: body.error?.message ?? `daemon returned ${response.status}`,
      };
    }
    if (body.health?.safeToStart === false) {
      return {
        daemonState: "degraded",
        metadata,
        errorCode: "MEMORY_RECOVERY_REQUIRED",
        errorMessage: body.health.degradedReason ?? body.health.status ?? "daemon reported degraded health",
      };
    }
    return {
      daemonState: "running",
      metadata,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (metadata && !isPidAlive(metadata.pid)) {
      clearDaemonRuntimeMetadata(paths, metadata.pid);
    }
    return {
      daemonState: "unavailable",
      metadata,
      errorCode: "MEMORY_DAEMON_UNAVAILABLE",
      errorMessage: message,
    };
  }
}

export async function invokeDaemonMethod<T>(
  paths: MemoryPaths,
  method: string,
  input: Record<string, unknown>,
): Promise<T> {
  const metadata = await ensureDaemon(paths);
  const token = readDaemonToken(paths);
  if (!token) {
    throw new DaemonClientError("MEMORY_DAEMON_UNAVAILABLE", "daemon token missing", 503);
  }
  const response = await fetch(`http://${metadata.host}:${metadata.port}/rpc/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    result?: T;
    error?: { code?: string; message?: string; details?: unknown };
  };
  if (!response.ok) {
    throw new DaemonClientError(
      payload.error?.code ?? "MEMORY_DAEMON_UNAVAILABLE",
      payload.error?.message ?? `daemon rpc ${method} failed`,
      response.status,
      payload.error?.details,
    );
  }
  return payload.result as T;
}

async function getHealthyDaemon(paths: MemoryPaths): Promise<DaemonRuntimeMetadata | null> {
  const health = await readDaemonHealth(paths);
  return health.daemonState === "running" ? health.metadata ?? null : null;
}

function tryAcquireDaemonStartLock(paths: MemoryPaths): { path: string; release: () => void } | null {
  try {
    return acquireRuntimeLock(paths, "daemon-start");
  } catch {
    return null;
  }
}

function spawnDaemon(paths: MemoryPaths): void {
  const cliPath = resolveCliEntrypoint();
  const child = spawn(process.execPath, [cliPath, "daemon", "--host", "127.0.0.1", "--port", "0"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CODEX_HOME: paths.codexHome,
      CODEX_MEM_DATA_DIR: paths.dataDir,
      CODEX_MEM_DB_PATH: paths.dbPath,
    },
  });
  child.unref();
}

async function waitForDaemon(paths: MemoryPaths, timeoutMs: number): Promise<DaemonRuntimeMetadata> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "daemon did not become healthy";
  while (Date.now() < deadline) {
    const health = await readDaemonHealth(paths);
    if (health.daemonState === "running" && health.metadata) {
      return health.metadata;
    }
    if (health.errorMessage) lastError = health.errorMessage;
    await sleep(DAEMON_POLL_INTERVAL_MS);
  }
  throw new DaemonClientError("MEMORY_DAEMON_UNAVAILABLE", lastError, 503);
}

function resolveCliEntrypoint(): string {
  return fileURLToPath(new URL("./cli.js", import.meta.url));
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
