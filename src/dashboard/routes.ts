import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { DASHBOARD_STYLES } from "./assets.js";
import { DashboardEventHub } from "./events.js";
import {
  InputError,
  normalizeInputError,
  readJsonBody,
  requireJsonObject,
  writeCss,
  writeError,
  writeHtml,
  writeJavascript,
  writeJson,
} from "./http.js";
import {
  parseBatchBody,
  parseBuildContextParams,
  parseContextParams,
  parseProjectListParams,
  parseSaveMemoryBody,
  parseSearchParams,
  parseSessionListParams,
  parseStatsParams,
  parseTimelineParams,
} from "./parsers.js";
import { renderDashboardHtml } from "./template.js";
import { MemoryService } from "../memory-service.js";
import { inferProcessWorkspaceIdentity, ScopeIsolationError } from "../workspace-identity.js";
import type { DatabaseHealthReport, SyncResult } from "../types.js";

const VERSION = "0.1.0";
const DASHBOARD_CLIENT_ENTRY =
  loadDashboardClientScript("index.js") ??
  "console.error('codex-mem dashboard client bundle is missing. Rebuild codex-mem.');";

export async function routeDashboardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  service: MemoryService | null,
  host: string,
  events: DashboardEventHub,
  healthState: {
    dbHealth: DatabaseHealthReport;
    lastIntegrityCheckAt: string;
    lastHealthySnapshotAt?: string | undefined;
    degradedReason?: string | undefined;
    lastSync: SyncResult | null;
  },
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${host}`);

  if (method === "GET" && url.pathname === "/") {
    writeHtml(res, renderDashboardHtml());
    return;
  }

  if (method === "GET" && url.pathname === "/assets/dashboard.css") {
    writeCss(res, DASHBOARD_STYLES);
    return;
  }

  if (method === "GET" && url.pathname === "/assets/dashboard.js") {
    writeJavascript(res, DASHBOARD_CLIENT_ENTRY);
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/assets/client/")) {
    serveDashboardClientModule(res, url.pathname);
    return;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    handleHealth(res, healthState);
    return;
  }

  if (service === null || !healthState.dbHealth.safeToStart) {
    writeError(res, 503, "DB_DEGRADED", healthState.degradedReason ?? "Database is degraded.");
    return;
  }

  if (method === "GET" && url.pathname === "/api/search") {
    await handleSearch(res, service, url);
    return;
  }

  if (method === "GET" && url.pathname === "/api/timeline") {
    await handleTimeline(res, service, url);
    return;
  }

  if (method === "GET" && url.pathname === "/api/context") {
    await handleContext(res, service, url);
    return;
  }

  if (method === "GET" && url.pathname === "/api/context_pack") {
    await handleContextPack(res, service, url);
    return;
  }

  if (method === "GET" && url.pathname === "/api/stats") {
    await handleStats(res, service, url);
    return;
  }

  if (method === "GET" && url.pathname === "/api/projects") {
    await handleProjects(res, service, url);
    return;
  }

  if (method === "GET" && url.pathname === "/api/sessions") {
    await handleSessions(res, service, url);
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/api/observation/")) {
    await handleObservationById(res, service, url.pathname);
    return;
  }

  if (method === "GET" && url.pathname === "/api/events") {
    events.attach(res);
    return;
  }

  if (method === "POST" && url.pathname === "/api/save_memory") {
    await handleSaveMemory(req, res, service);
    return;
  }

  if (method === "POST" && url.pathname === "/api/observations/batch") {
    await handleBatch(req, res, service);
    return;
  }

  writeError(res, 404, "NOT_FOUND", "Route not found.");
}

function handleHealth(
  res: ServerResponse,
  healthState: {
    dbHealth: DatabaseHealthReport;
    lastIntegrityCheckAt: string;
    lastHealthySnapshotAt?: string | undefined;
    degradedReason?: string | undefined;
    lastSync: SyncResult | null;
  },
): void {
  writeJson(res, 200, {
    status: healthState.dbHealth.safeToStart ? "ok" : "degraded",
    version: VERSION,
    sync: healthState.lastSync,
    dbHealth: healthState.dbHealth.dbHealth,
    servicePathHealth: healthState.dbHealth.servicePathHealth,
    runtimeContext: healthState.dbHealth.runtimeContext,
    serviceStatus: healthState.dbHealth.status,
    lastIntegrityCheckAt: healthState.lastIntegrityCheckAt,
    lastQueryProbeAt: healthState.dbHealth.lastQueryProbeAt,
    lastQueryProbeResults: healthState.dbHealth.lastQueryProbeResults,
    lastHealthySnapshotAt: healthState.lastHealthySnapshotAt,
    degradedReason: healthState.degradedReason,
    now: new Date().toISOString(),
  });
}

async function handleSearch(res: ServerResponse, service: MemoryService, url: URL): Promise<void> {
  const params = parseSearchParams(url);
  const cwd = params.cwd ?? inferProcessWorkspaceIdentity().cwd;
  const result = await service.searchWithSummary({
    ...params,
    cwd,
    scopeMode: params.scopeMode ?? "exact_workspace",
  });
  writeJson(res, 200, {
    observations: result.observations,
    retrievalSummary: result.retrievalSummary,
  });
}

async function handleTimeline(res: ServerResponse, service: MemoryService, url: URL): Promise<void> {
  const params = parseTimelineParams(url);
  const observations = await service.timeline(params.anchor, {
    before: params.before,
      after: params.after,
      cwd: params.cwd ?? inferProcessWorkspaceIdentity().cwd,
      scopeMode: params.scopeMode ?? "exact_workspace",
  });
  writeJson(res, 200, { observations });
}

async function handleContext(res: ServerResponse, service: MemoryService, url: URL): Promise<void> {
  const params = parseContextParams(url);
  const context = await service.context({
    ...params,
    cwd: params.cwd ?? inferProcessWorkspaceIdentity().cwd,
    scopeMode: params.scopeMode ?? "exact_workspace",
  });
  writeJson(res, 200, { context });
}

async function handleContextPack(
  res: ServerResponse,
  service: MemoryService,
  url: URL,
): Promise<void> {
  const params = parseBuildContextParams(url);
  const contextPack = await service.buildContextPack({
    ...params,
    cwd: params.cwd ?? inferProcessWorkspaceIdentity().cwd,
    scopeMode: params.scopeMode ?? "exact_workspace",
  });
  writeJson(res, 200, { contextPack });
}

async function handleStats(res: ServerResponse, service: MemoryService, url: URL): Promise<void> {
  const params = parseStatsParams(url);
  const stats = await service.stats({
    ...params,
    cwd: params.cwd ?? inferProcessWorkspaceIdentity().cwd,
    scopeMode: params.scopeMode ?? "exact_workspace",
  });
  writeJson(res, 200, { stats });
}

async function handleProjects(res: ServerResponse, service: MemoryService, url: URL): Promise<void> {
  const params = parseProjectListParams(url);
  const projects = await service.projects(params);
  writeJson(res, 200, { projects });
}

async function handleSessions(res: ServerResponse, service: MemoryService, url: URL): Promise<void> {
  const params = parseSessionListParams(url);
  const sessions = await service.sessions({
    ...params,
    cwd: params.cwd ?? inferProcessWorkspaceIdentity().cwd,
    scopeMode: params.scopeMode ?? "exact_workspace",
  });
  writeJson(res, 200, { sessions });
}

async function handleObservationById(
  res: ServerResponse,
  service: MemoryService,
  pathname: string,
): Promise<void> {
  const id = parseObservationPathId(pathname);
  const observations = await service.getByIds([id]);

  if (observations.length === 0) {
    writeError(res, 404, "NOT_FOUND", `Observation ${id} not found.`);
    return;
  }

  writeJson(res, 200, {
    observation: observations[0],
  });
}

async function handleSaveMemory(
  req: IncomingMessage,
  res: ServerResponse,
  service: MemoryService,
): Promise<void> {
  const json = await readJsonBody(req);
  const body = requireJsonObject(json);
  const input = parseSaveMemoryBody(body);
  const id = await service.saveMemory({
    ...input,
    cwd: input.cwd ?? inferProcessWorkspaceIdentity().cwd,
  });

  writeJson(res, 200, {
    status: "saved",
    id,
  });
}

async function handleBatch(
  req: IncomingMessage,
  res: ServerResponse,
  service: MemoryService,
): Promise<void> {
  const json = await readJsonBody(req);
  const body = requireJsonObject(json);
  const input = parseBatchBody(body);
  const observations = await service.getByIds(input.ids);
  writeJson(res, 200, { observations });
}

function serveDashboardClientModule(res: ServerResponse, pathname: string): void {
  const encodedModulePath = pathname.slice("/assets/client/".length);
  const modulePath = safeDecodeUriComponent(encodedModulePath);

  if (!modulePath || !isSafeModulePath(modulePath)) {
    writeError(res, 400, "INVALID_INPUT", "Invalid dashboard module path.");
    return;
  }

  const code = loadDashboardClientScript(modulePath);
  if (!code) {
    writeError(res, 404, "NOT_FOUND", "Dashboard module not found.");
    return;
  }

  writeJavascript(res, code);
}

function parseObservationPathId(pathname: string): number {
  const raw = pathname.slice("/api/observation/".length);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new InputError("observation: id must be a positive integer.");
  }
  return parsed;
}

function isSafeModulePath(pathname: string): boolean {
  if (!pathname.endsWith(".js")) return false;
  if (pathname.includes("..") || pathname.includes("\\") || pathname.startsWith("/")) {
    return false;
  }

  return /^[a-zA-Z0-9_./-]+$/.test(pathname);
}

function loadDashboardClientScript(path: string): string | null {
  try {
    return readFileSync(new URL(`./client/${path}`, import.meta.url), "utf8");
  } catch {
    return null;
  }
}

function safeDecodeUriComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function normalizeDashboardError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const normalized = normalizeInputError(error);
  if (normalized) {
    return {
      status: 400,
      code: "INVALID_INPUT",
      message: normalized.message,
    };
  }

  if (error instanceof ScopeIsolationError) {
    return {
      status: 400,
      code: error.reason.toUpperCase(),
      message: error.message,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message,
  };
}
