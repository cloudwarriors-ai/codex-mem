import { resolvePaths } from "./config.js";
import { MemoryService } from "./memory-service.js";
import type { MemoryPaths, SyncResult } from "./types.js";

const DEFAULT_INTERVAL_SECONDS = 15;

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
  const service = new MemoryService(paths);
  const intervalMs = normalizeWorkerIntervalMs(options?.intervalSeconds);

  const runSync = async (): Promise<void> => {
    try {
      const result = await service.sync();
      options?.onSync?.(result);
    } catch (error) {
      options?.onError?.(error);
    }
  };

  await runSync();

  if (options?.runOnce) {
    service.close();
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      void runSync();
    }, intervalMs);

    const stop = () => {
      clearInterval(timer);
      service.close();
      resolve();
    };

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
