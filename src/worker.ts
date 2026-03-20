import { detectHostRuntimeContext, isSharedDefaultDataDir, resolvePaths } from "./config.js";
import { invokeDaemonMethod } from "./daemon-client.js";
import { bootstrapRuntime, ensureHealthySnapshot, inspectRuntimeHealth } from "./db-lifecycle.js";
import { acquireRuntimeLock } from "./runtime-lock.js";
import type { MemoryPaths, SyncResult } from "./types.js";

const DEFAULT_INTERVAL_SECONDS = 15;
const DEFAULT_INTEGRITY_CHECK_INTERVAL_SECONDS = 600;

export interface WorkerOptions {
  intervalSeconds?: number | undefined;
  runOnce?: boolean | undefined;
  onSync?: ((result: SyncResult) => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
}

export async function runWorker(
  paths: MemoryPaths = resolvePaths(),
  options?: WorkerOptions,
): Promise<void> {
  if (isSharedDefaultDataDir(paths.dataDir) && detectHostRuntimeContext() === "docker") {
    throw new Error(
      "worker cannot run against the shared live Codex store from docker; use the host daemon and host-side compatibility commands instead",
    );
  }
  if (isSharedDefaultDataDir(paths.dataDir)) {
    await runDaemonWorker(paths, options);
    return;
  }

  const runtime = await bootstrapRuntime(paths, "worker");
  if (!runtime.service) {
    throw new Error("Worker cannot start without a healthy database");
  }
  const service = runtime.service;
  const lock = acquireRuntimeLock(paths, "worker");
  const intervalMs = normalizeWorkerIntervalMs(options?.intervalSeconds);
  const integrityCheckIntervalMs = DEFAULT_INTEGRITY_CHECK_INTERVAL_SECONDS * 1000;
  let lastIntegrityCheckAt = 0;
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let resolveRun: (() => void) | null = null;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    lock.release();
    service.close();
    resolveRun?.();
  };

  const runSync = async (): Promise<void> => {
    try {
      if (Date.now() - lastIntegrityCheckAt >= integrityCheckIntervalMs) {
        const health = await inspectRuntimeHealth(paths, "worker");
        lastIntegrityCheckAt = Date.now();
        if (!health.safeToStart) {
          throw new Error(`database degraded: ${health.status}`);
        }
      }
      const result = await service.sync();
      await ensureHealthySnapshot(paths, service, "post-sync");
      options?.onSync?.(result);
    } catch (error) {
      options?.onError?.(error);
      stop();
    }
  };

  await runSync();

  if (options?.runOnce || stopping) {
    if (!stopping) stop();
    return;
  }

  await new Promise<void>((resolve) => {
    resolveRun = resolve;
    timer = setInterval(() => {
      if (!stopping) {
        void runSync();
      }
    }, intervalMs);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function runDaemonWorker(paths: MemoryPaths, options?: WorkerOptions): Promise<void> {
  const intervalMs = normalizeWorkerIntervalMs(options?.intervalSeconds);
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let resolveRun: (() => void) | null = null;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    resolveRun?.();
  };

  const runSync = async (): Promise<void> => {
    try {
      const result = await invokeDaemonMethod<{ sync: SyncResult }>(paths, "sync", {});
      options?.onSync?.(result.sync);
    } catch (error) {
      options?.onError?.(error);
      stop();
    }
  };

  await runSync();

  if (options?.runOnce || stopping) {
    if (!stopping) stop();
    return;
  }

  await new Promise<void>((resolve) => {
    resolveRun = resolve;
    timer = setInterval(() => {
      if (!stopping) {
        void runSync();
      }
    }, intervalMs);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function normalizeWorkerIntervalMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_INTERVAL_SECONDS * 1000;
  }
  const rounded = Math.floor(value);
  if (rounded < 1) return 1_000;
  if (rounded > 3_600) return 3_600_000;
  return rounded * 1000;
}
