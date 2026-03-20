import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { detectHostRuntimeContext, isSharedDefaultDataDir } from "./config.js";
import { bootstrapRuntime, ensureHealthySnapshot, inspectRuntimeHealth } from "./db-lifecycle.js";
import { acquireRuntimeLock, listRuntimeLocks } from "./runtime-lock.js";
import {
  buildContextInputSchema,
  contextInputSchema,
  getObservationsInputSchema,
  listPreferencesInputSchema,
  projectListParamsSchema,
  resolvePreferencesInputSchema,
  saveMemoryInputSchema,
  savePreferenceInputSchema,
  searchInputSchema,
  sessionListParamsSchema,
  statsParamsSchema,
  timelineInputSchema,
} from "./contracts.js";
import {
  clearDaemonRuntimeMetadata,
  ensureDaemonToken,
  generateDbGeneration,
  writeDaemonRuntimeMetadata,
} from "./daemon-runtime.js";
import type { DaemonRuntimeMetadata, MemoryPaths } from "./types.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_SYNC_INTERVAL_MS = 15_000;

export interface CodexMemDaemon {
  metadata: DaemonRuntimeMetadata;
  close: () => Promise<void>;
}

export async function startCodexMemDaemon(
  paths: MemoryPaths,
  options?: { host?: string | undefined; port?: number | undefined; syncIntervalMs?: number | undefined },
): Promise<CodexMemDaemon> {
  if (isSharedDefaultDataDir(paths.dataDir) && detectHostRuntimeContext() === "docker") {
    throw new Error("shared Codex memory daemon must run on the host; docker runtime is blocked for the live store");
  }
  const host = options?.host ?? DEFAULT_HOST;
  const activeLocks = listRuntimeLocks(paths).filter(
    (lock) => !["daemon", "daemon-start", "maintenance"].includes(lock.surface),
  );
  if (activeLocks.length > 0) {
    throw new Error(`daemon startup blocked by active runtime locks: ${activeLocks.map((lock) => lock.surface).join(", ")}`);
  }
  const maintenanceLocks = listRuntimeLocks(paths).filter((lock) => lock.surface === "maintenance");
  if (maintenanceLocks.length > 0) {
    throw new Error("daemon startup blocked while maintenance lock is held");
  }
  const runtime = await bootstrapRuntime(paths, "daemon", {
    skipServicePathPreflight: Boolean(process.env.CODEX_MEM_SKIP_SERVICE_PATH_PREFLIGHT),
  });
  if (!runtime.service) {
    throw new Error("daemon cannot start without a healthy database");
  }
  const service = runtime.service;
  const lock = acquireRuntimeLock(paths, "daemon");
  const { token, tokenPath } = ensureDaemonToken(paths);
  const dbGeneration = generateDbGeneration();
  const syncIntervalMs = options?.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;

  const state = {
    health: runtime.health,
    lastSync: null as null | { status: "ok"; filesScanned: number; observationsInserted: number },
  };

  const server = http.createServer(async (req, res) => {
    try {
      await routeDaemonRequest(req, res, service, token, state);
    } catch (error) {
      writeJson(res, 500, {
        error: {
          code: "MEMORY_DAEMON_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  const syncTimer = setInterval(() => {
    void (async () => {
      const health = await inspectRuntimeHealth(paths, "daemon");
      state.health = health;
      if (!health.safeToStart) return;
      const result = await service.sync();
      state.lastSync = result;
      await ensureHealthySnapshot(paths, service, "daemon-post-sync");
    })().catch(() => {
      // Health endpoint surfaces the latest known health; avoid crashing the daemon loop.
    });
  }, syncIntervalMs);
  syncTimer.unref?.();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options?.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options?.port ?? 0;
  const metadata: DaemonRuntimeMetadata = {
    pid: process.pid,
    port,
    host,
    tokenPath,
    startedAt: new Date().toISOString(),
    dbGeneration,
    dbPath: paths.dbPath,
  };
  writeDaemonRuntimeMetadata(paths, metadata);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(syncTimer);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    clearDaemonRuntimeMetadata(paths, process.pid);
    lock.release();
    service.close();
  };

  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

  return { metadata, close };
}

async function routeDaemonRequest(
  req: IncomingMessage,
  res: ServerResponse,
  service: NonNullable<Awaited<ReturnType<typeof bootstrapRuntime>>["service"]>,
  token: string,
  state: {
    health: Awaited<ReturnType<typeof inspectRuntimeHealth>>;
    lastSync: null | { status: "ok"; filesScanned: number; observationsInserted: number };
  },
): Promise<void> {
  if (!authorize(req, token)) {
    writeJson(res, 401, {
      error: {
        code: "MEMORY_DAEMON_UNAUTHORIZED",
        message: "missing or invalid daemon token",
      },
    });
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    writeJson(res, 200, {
      health: state.health,
      lastSync: state.lastSync,
    });
    return;
  }

  if (req.method !== "POST" || !url.pathname.startsWith("/rpc/")) {
    writeJson(res, 404, {
      error: {
        code: "MEMORY_DAEMON_NOT_FOUND",
        message: "route not found",
      },
    });
    return;
  }

  if (!state.health.safeToStart) {
    writeJson(res, 503, {
      error: {
        code: state.health.dbHealth === "db_corrupt" ? "MEMORY_DB_CORRUPT" : "MEMORY_RECOVERY_REQUIRED",
        message: state.health.degradedReason ?? state.health.status,
        details: state.health,
      },
    });
    return;
  }

  const method = url.pathname.slice("/rpc/".length);
  const body = await readJsonBody(req);
  try {
    const result = await dispatchMethod(method, body, service);
    writeJson(res, 200, { result });
  } catch (error) {
    writeJson(res, 400, {
      error: {
        code: "MEMORY_DAEMON_INVALID_REQUEST",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function dispatchMethod(method: string, body: Record<string, unknown>, service: any): Promise<unknown> {
  switch (method) {
    case "search":
      return { observations: await service.search(searchInputSchema.parse(body)) };
    case "timeline": {
      const input = timelineInputSchema.parse(body);
      return { observations: await service.timeline(input.anchor, input) };
    }
    case "get_observations": {
      const input = getObservationsInputSchema.parse(body);
      return { observations: await service.getByIds(input.ids) };
    }
    case "save_memory": {
      const input = saveMemoryInputSchema.parse(body);
      return { status: "saved", id: await service.saveMemory(input) };
    }
    case "save_preference": {
      const input = savePreferenceInputSchema.parse(body);
      return { status: "saved", id: await service.savePreference(input) };
    }
    case "list_preferences": {
      const input = listPreferencesInputSchema.parse(body);
      return {
        preferences: await service.listPreferences({
          cwd: input.cwd,
          key: input.key,
          scope: input.scope,
          limit: input.limit,
          includeSuperseded: input.include_superseded,
          scopeMode: input.scopeMode,
        }),
      };
    }
    case "resolve_preferences": {
      const input = resolvePreferencesInputSchema.parse(body);
      return {
        resolved: await service.resolvePreferences({
          cwd: input.cwd,
          keys: input.keys,
          limit: input.limit,
          scopeMode: input.scopeMode,
        }),
      };
    }
    case "context": {
      const input = contextInputSchema.parse(body);
      return { context: await service.context(input) };
    }
    case "stats":
      return { stats: await service.stats(statsParamsSchema.parse(body)) };
    case "projects":
      return { projects: await service.projects(projectListParamsSchema.parse(body)) };
    case "sessions":
      return { sessions: await service.sessions(sessionListParamsSchema.parse(body)) };
    case "build_context": {
      const input = buildContextInputSchema.parse(body);
      return { contextPack: await service.buildContextPack(input) };
    }
    case "sync":
      return { sync: await service.sync() };
    default:
      throw new Error(`unknown rpc method: ${method}`);
  }
}

function authorize(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  return header === `Bearer ${token}`;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}
