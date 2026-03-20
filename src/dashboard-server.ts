import http from "node:http";
import { isSharedDefaultDataDir } from "./config.js";
import { acquireRuntimeLock } from "./runtime-lock.js";
import { bootstrapRuntime, ensureHealthySnapshot, inspectRuntimeHealth } from "./db-lifecycle.js";
import type { MemoryPaths } from "./types.js";
import { DashboardEventHub } from "./dashboard/events.js";
import { writeError } from "./dashboard/http.js";
import { normalizeDashboardError, routeDashboardRequest } from "./dashboard/routes.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 37811;
const DEFAULT_SYNC_INTERVAL_MS = 10_000;

export interface DashboardServer {
  url: string;
  host: string;
  port: number;
  close: () => Promise<void>;
}

export async function startDashboardServer(
  paths: MemoryPaths,
  options?: { host?: string | undefined; port?: number | undefined },
): Promise<DashboardServer> {
  if (isSharedDefaultDataDir(paths.dataDir)) {
    throw new Error(
      "dashboard cannot open the shared Codex memory store directly; use daemon-backed CLI/MCP or migrate dashboard proxy support first",
    );
  }
  const host = options?.host ?? process.env.CODEX_MEM_DASHBOARD_HOST ?? DEFAULT_HOST;
  const port = sanitizePort(options?.port ?? Number(process.env.CODEX_MEM_DASHBOARD_PORT ?? DEFAULT_PORT));
  const runtime = await bootstrapRuntime(paths, "dashboard", { allowDegraded: true });
  const service = runtime.service;
  const lock = service ? acquireRuntimeLock(paths, "dashboard") : null;
  const events = new DashboardEventHub();
  const state = {
    dbHealth: runtime.health,
    lastIntegrityCheckAt: runtime.health.checkedAt,
    lastHealthySnapshotAt: runtime.health.latestHealthySnapshot?.createdAt,
    degradedReason: runtime.health.degradedReason,
    lastSync: null as null | { status: "ok"; filesScanned: number; observationsInserted: number },
  };

  const server = http.createServer(async (req, res) => {
    try {
      await routeDashboardRequest(req, res, service, host, events, state);
    } catch (error) {
      const mapped = normalizeDashboardError(error);
      writeError(res, mapped.status, mapped.code, mapped.message);
    }
  });

  const syncIntervalMs = readSyncIntervalMs();
  const syncTimer =
    service === null
      ? null
      : setInterval(() => {
          void (async () => {
            const health = await inspectRuntimeHealth(paths, "dashboard");
            state.dbHealth = health;
            state.lastIntegrityCheckAt = health.checkedAt;
            state.lastHealthySnapshotAt = health.latestHealthySnapshot?.createdAt;
            state.degradedReason = health.degradedReason;
            if (!health.safeToStart) {
              events.publishSyncError(`database degraded: ${health.status}`);
              return;
            }
            const sync = await service.sync();
            state.lastSync = sync;
            await ensureHealthySnapshot(paths, service, "dashboard-post-sync");
            events.publishSync(sync);
          })().catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            events.publishSyncError(message);
          });
        }, syncIntervalMs);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    if (syncTimer) clearInterval(syncTimer);
    events.close();
    service?.close();
    lock?.release();
    throw error;
  }

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;

  return {
    host,
    port: actualPort,
    url,
    close: async () => {
      if (syncTimer) clearInterval(syncTimer);
      events.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      service?.close();
      lock?.release();
    },
  };
}

function sanitizePort(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PORT;
  const rounded = Math.floor(value);
  if (rounded < 0 || rounded > 65_535) return DEFAULT_PORT;
  return rounded;
}

function readSyncIntervalMs(): number {
  const raw = Number(process.env.CODEX_MEM_DASHBOARD_SYNC_INTERVAL_MS ?? DEFAULT_SYNC_INTERVAL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_SYNC_INTERVAL_MS;
  const rounded = Math.floor(raw);
  if (rounded < 1_000) return 1_000;
  if (rounded > 120_000) return 120_000;
  return rounded;
}
