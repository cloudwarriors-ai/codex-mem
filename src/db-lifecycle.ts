import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "./memory-service.js";
import { listRuntimeLocks } from "./runtime-lock.js";
import { CURRENT_SCHEMA_VERSION, configurePragmas } from "./db-pragmas.js";
import type {
  DatabaseHealthReport,
  DatabaseHealthStatus,
  DatabasePragmas,
  DatabaseRepairReport,
  MemoryPaths,
  RuntimeContext,
  RuntimeSurface,
  ServicePathHealthStatus,
  ServiceProbeName,
  ServiceProbeResult,
  SnapshotManifest,
  SnapshotMetadata,
} from "./types.js";
import { initializeRepositorySchema } from "./repository/schema.js";
const SNAPSHOT_MIN_INTERVAL_MS = 15 * 60 * 1000;
const SNAPSHOT_KEEP_RECENT = 8;
const SNAPSHOT_KEEP_DAILY = 14;
const DEFAULT_PROBE_TIMEOUT_MS = 12_000;

const REQUIRED_TABLES = ["observations", "durable_memories", "source_offsets"] as const;
const REQUIRED_INDEXES = [
  "idx_observations_created",
  "idx_observations_workspace_id",
  "idx_durable_memories_status",
  "idx_durable_memories_workspace_id",
] as const;
const REQUIRED_TRIGGERS = ["observations_ai", "observations_ad", "observations_au"] as const;

export class DatabaseHealthError extends Error {
  constructor(public readonly report: DatabaseHealthReport) {
    super(report.degradedReason ?? report.status);
    this.name = "DatabaseHealthError";
  }
}

export interface RuntimeBootstrap {
  service: MemoryService | null;
  health: DatabaseHealthReport;
}

export async function bootstrapRuntime(
  paths: MemoryPaths,
  surface: RuntimeSurface,
  options?: { allowDegraded?: boolean | undefined; skipServicePathPreflight?: boolean | undefined },
): Promise<RuntimeBootstrap> {
  const initialHealth = inspectDatabase(paths);
  if (!initialHealth.safeToStart) {
    if (options?.allowDegraded) {
      return { service: null, health: initialHealth };
    }
    throw new DatabaseHealthError(initialHealth);
  }

  const service = new MemoryService(paths);
  if (!process.env.CODEX_MEM_SKIP_PRESTART_SNAPSHOT) {
    await ensureHealthySnapshot(paths, service, "prestart");
  }
  const health = await inspectRuntimeHealth(paths, surface, {
    skipServicePathPreflight: options?.skipServicePathPreflight,
  });
  if (!health.safeToStart) {
    service.close();
    if (options?.allowDegraded) {
      return { service: null, health };
    }
    throw new DatabaseHealthError(health);
  }
  return { service, health };
}

export function inspectDatabase(paths: MemoryPaths): DatabaseHealthReport {
  const checkedAt = new Date().toISOString();
  const latest = getSnapshotManifest(paths);
  const latestSnapshot = latest.snapshots.at(-1);
  const latestHealthySnapshot = [...latest.snapshots]
    .reverse()
    .find((snapshot) => snapshot.status === "healthy" || snapshot.status === "recovery_source");

  return inspectDatabasePath(paths.dbPath, {
    checkedAt,
    latestSnapshot,
    latestHealthySnapshot,
  });
}

export async function inspectRuntimeHealth(
  paths: MemoryPaths,
  surface: RuntimeSurface,
  options?: { skipServicePathPreflight?: boolean | undefined },
): Promise<DatabaseHealthReport> {
  const dbHealth = inspectDatabase(paths);
  if (!dbHealth.safeToStart || options?.skipServicePathPreflight) {
    return dbHealth;
  }

  const runtimeContext = detectRuntimeContext();
  const probeStartedAt = new Date().toISOString();
  const probeNames = serviceProbeNamesForSurface(surface);
  const probeResults = await Promise.all(
    probeNames.map((probe) =>
      executeServiceProbe(paths, probe, {
        surface,
        runtimeContext,
      }),
    ),
  );

  const servicePathHealth = summarizeServicePathHealth(probeResults);
  const safeToStart = dbHealth.safeToStart && servicePathHealth === "service_ok";
  const degradedReason =
    servicePathHealth === "service_ok"
      ? dbHealth.degradedReason
      : firstProbeFailure(probeResults) ??
        (servicePathHealth === "query_path_timeout"
          ? "service-path probe timed out"
          : "service-path probe failed");

  return {
    ...dbHealth,
    status: combineOverallStatus(dbHealth.dbHealth, servicePathHealth),
    dbHealth: dbHealth.dbHealth,
    servicePathHealth,
    runtimeContext,
    safeToStart,
    degradedReason,
    lastQueryProbeAt: probeStartedAt,
    lastQueryProbeResults: probeResults,
  };
}

function inspectDatabasePath(
  dbPath: string,
  options?: {
    checkedAt?: string;
    latestSnapshot?: SnapshotMetadata | undefined;
    latestHealthySnapshot?: SnapshotMetadata | undefined;
  },
): DatabaseHealthReport {
  const checkedAt = options?.checkedAt ?? new Date().toISOString();
  const latestSnapshot = options?.latestSnapshot;
  const latestHealthySnapshot = options?.latestHealthySnapshot;

  if (!existsSync(dbPath)) {
    return {
      status: "db_missing",
      dbHealth: "db_missing",
      servicePathHealth: "service_probe_skipped",
      runtimeContext: detectRuntimeContext(),
      checkedAt,
      dbPath,
      safeToStart: true,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pragmas: null,
      latestSnapshot,
      latestHealthySnapshot,
    };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { fileMustExist: true });
    configurePragmas(db);
    const quickCheck = String(db.pragma("quick_check", { simple: true }) ?? "");
    if (quickCheck.toLowerCase() !== "ok") {
      return {
        status: "db_corrupt",
        dbHealth: "db_corrupt",
        servicePathHealth: "service_probe_skipped",
        runtimeContext: detectRuntimeContext(),
        checkedAt,
        dbPath,
        safeToStart: false,
        schemaVersion: getUserVersion(db),
        pragmas: readPragmas(db),
        degradedReason: "db_corrupt",
        quickCheck,
        latestSnapshot,
        latestHealthySnapshot,
      };
    }

    if (!schemaLooksValid(db)) {
      return {
        status: "schema_invalid",
        dbHealth: "schema_invalid",
        servicePathHealth: "service_probe_skipped",
        runtimeContext: detectRuntimeContext(),
        checkedAt,
        dbPath,
        safeToStart: false,
        schemaVersion: getUserVersion(db),
        pragmas: readPragmas(db),
        degradedReason: "schema_invalid",
        quickCheck,
        latestSnapshot,
        latestHealthySnapshot,
      };
    }

    for (const table of REQUIRED_TABLES) {
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    }

    return {
      status: "db_ok_service_ok",
      dbHealth: "ok",
      servicePathHealth: "service_probe_skipped",
      runtimeContext: detectRuntimeContext(),
      checkedAt,
      dbPath,
      safeToStart: true,
      schemaVersion: getUserVersion(db),
      pragmas: readPragmas(db),
      quickCheck,
      latestSnapshot,
      latestHealthySnapshot,
    };
  } catch (error) {
    return {
      status: "db_unreadable",
      dbHealth: "db_unreadable",
      servicePathHealth: "service_probe_skipped",
      runtimeContext: detectRuntimeContext(),
      checkedAt,
      dbPath,
      safeToStart: false,
      schemaVersion: 0,
      pragmas: null,
      degradedReason: error instanceof Error ? error.message : String(error),
      latestSnapshot,
      latestHealthySnapshot,
    };
  } finally {
    db?.close();
  }
}

export async function ensureHealthySnapshot(
  paths: MemoryPaths,
  service: MemoryService,
  reason: string,
): Promise<SnapshotMetadata | null> {
  const manifest = getSnapshotManifest(paths);
  const latestHealthy = [...manifest.snapshots]
    .reverse()
    .find((snapshot) => snapshot.status === "healthy" || snapshot.status === "recovery_source");
  const now = Date.now();
  if (latestHealthy && now - Date.parse(latestHealthy.createdAt) < SNAPSHOT_MIN_INTERVAL_MS) {
    return latestHealthy;
  }
  const snapshot = await createSnapshot(paths, reason);
  pruneSnapshots(paths);
  return snapshot;
}

export async function createSnapshot(paths: MemoryPaths, reason: string): Promise<SnapshotMetadata> {
  mkdirSync(getBackupsDir(paths), { recursive: true });
  if (!existsSync(paths.dbPath)) {
    throw new Error("Cannot snapshot missing database");
  }

  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
  const snapshotPath = join(getBackupsDir(paths), `codex-mem-${timestamp}.db`);
  const db = new Database(paths.dbPath, { fileMustExist: true });
  try {
    configurePragmas(db);
    await db.backup(snapshotPath);
  } finally {
    db.close();
  }

  const report = inspectPath(snapshotPath);
  const rowCounts = readRowCounts(snapshotPath);
  const metadata: SnapshotMetadata = {
    id: basename(snapshotPath),
    path: snapshotPath,
    createdAt: new Date().toISOString(),
    reason,
    status: report.safeToStart ? "healthy" : "failed_preflight",
    schemaVersion: report.schemaVersion,
    observationCount: rowCounts.observationCount,
    durableMemoryCount: rowCounts.durableMemoryCount,
    sourceOffsetCount: rowCounts.sourceOffsetCount,
  };
  appendSnapshotMetadata(paths, metadata);
  return metadata;
}

export function repairDatabase(paths: MemoryPaths): DatabaseRepairReport {
  const locks = listRuntimeLocks(paths);
  if (locks.length > 0) {
    return {
      status: "blocked",
      sourcePath: paths.dbPath,
      incidentDir: "",
      checkedAt: new Date().toISOString(),
      schemaVersion: 0,
      observationCount: 0,
      durableMemoryCount: 0,
      sourceOffsetCount: 0,
      validationStatus: "db_unreadable",
      validationMessage: `active runtime locks: ${locks.map((lock) => lock.surface).join(", ")}`,
    };
  }

  mkdirSync(getBackupsDir(paths), { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
  const incidentDir = join(getBackupsDir(paths), `incident-${timestamp}`);
  mkdirSync(incidentDir, { recursive: true });

  const liveDb = paths.dbPath;
  const liveWal = `${liveDb}-wal`;
  const liveShm = `${liveDb}-shm`;
  if (existsSync(liveDb)) copyFileSync(liveDb, join(incidentDir, "codex-mem.db.corrupt.original"));
  if (existsSync(liveWal)) copyFileSync(liveWal, join(incidentDir, "codex-mem.db-wal.corrupt.original"));
  if (existsSync(liveShm)) copyFileSync(liveShm, join(incidentDir, "codex-mem.db-shm.corrupt.original"));

  const repairedPath = join(incidentDir, "codex-mem.repaired.db");
  rmSync(repairedPath, { force: true });

  const target = new Database(repairedPath);
  try {
    configurePragmas(target);
    initializeRepositorySchema(target);
    target.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    target.pragma("foreign_keys = OFF");
    target.exec(`ATTACH DATABASE '${escapeSqlitePath(liveDb)}' AS old`);
    target.exec(`
      INSERT INTO observations (
        id, source, session_id, cwd, workspace_root, workspace_id, visibility, sensitivity,
        scope_policy, role, type, title, text, metadata_json, created_at, created_at_epoch
      )
      SELECT
        id, source, session_id, cwd, workspace_root, workspace_id, visibility, sensitivity,
        scope_policy, role, type, title, text, metadata_json, created_at, created_at_epoch
      FROM old.observations
      ORDER BY id;
    `);
    target.exec(`
      INSERT INTO source_offsets (source_path, last_offset, last_mtime_ms)
      SELECT source_path, last_offset, last_mtime_ms
      FROM old.source_offsets;
    `);
    target.exec(`
      INSERT INTO durable_memories (
        id, observation_id, memory_class, title, body, cwd, workspace_root, workspace_id,
        visibility, sensitivity, scope_policy, trust_level, scope, source_kind, supersedes_json,
        related_paths_json, related_topics_json, status, created_at, updated_at
      )
      SELECT
        id, observation_id, memory_class, title, body, cwd, workspace_root, workspace_id,
        visibility, sensitivity, scope_policy, trust_level, scope, source_kind, supersedes_json,
        related_paths_json, related_topics_json, status, created_at, updated_at
      FROM old.durable_memories
      ORDER BY id;
    `);
    target.exec("DETACH DATABASE old");
    target.exec(`INSERT INTO observations_fts(observations_fts) VALUES('rebuild')`);
    target.pragma("foreign_keys = ON");
  } finally {
    target.close();
  }

  const validation = inspectPath(repairedPath);
  const rowCounts = readRowCounts(repairedPath);
  const report: DatabaseRepairReport = {
    status: validation.safeToStart ? "repaired" : "failed",
    sourcePath: liveDb,
    repairedPath,
    incidentDir,
    checkedAt: new Date().toISOString(),
    schemaVersion: validation.schemaVersion,
    observationCount: rowCounts.observationCount,
    durableMemoryCount: rowCounts.durableMemoryCount,
    sourceOffsetCount: rowCounts.sourceOffsetCount,
    validationStatus: validation.dbHealth,
    validationMessage: validation.quickCheck ?? validation.degradedReason ?? validation.status,
  };

  writeFileSync(join(incidentDir, "repair-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (!validation.safeToStart) {
    return report;
  }

  const previousDir = join(incidentDir, "pre-swap");
  mkdirSync(previousDir, { recursive: true });
  if (existsSync(liveDb)) rmSync(join(previousDir, "codex-mem.db.pre-swap"), { force: true });
  if (existsSync(liveDb)) copyFileSync(liveDb, join(previousDir, "codex-mem.db.pre-swap"));
  if (existsSync(liveWal)) copyFileSync(liveWal, join(previousDir, "codex-mem.db-wal.pre-swap"));
  if (existsSync(liveShm)) copyFileSync(liveShm, join(previousDir, "codex-mem.db-shm.pre-swap"));

  rmSync(liveWal, { force: true });
  rmSync(liveShm, { force: true });
  copyFileSync(repairedPath, liveDb);

  const recoverySnapshot = {
    id: basename(repairedPath),
    path: repairedPath,
    createdAt: report.checkedAt,
    reason: "repair-db",
    status: "recovery_source" as const,
    schemaVersion: report.schemaVersion,
    observationCount: report.observationCount,
    durableMemoryCount: report.durableMemoryCount,
    sourceOffsetCount: report.sourceOffsetCount,
  };
  appendSnapshotMetadata(paths, recoverySnapshot);
  return report;
}

export async function rebuildQueryLayer(paths: MemoryPaths): Promise<DatabaseRepairReport> {
  const locks = listRuntimeLocks(paths);
  if (locks.length > 0) {
    return {
      status: "blocked",
      sourcePath: paths.dbPath,
      incidentDir: "",
      checkedAt: new Date().toISOString(),
      schemaVersion: 0,
      observationCount: 0,
      durableMemoryCount: 0,
      sourceOffsetCount: 0,
      validationStatus: "db_unreadable",
      validationMessage: `active runtime locks: ${locks.map((lock) => lock.surface).join(", ")}`,
    };
  }

  mkdirSync(getBackupsDir(paths), { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
  const incidentDir = join(getBackupsDir(paths), `query-rebuild-${timestamp}`);
  mkdirSync(incidentDir, { recursive: true });
  const liveDb = paths.dbPath;
  const liveWal = `${liveDb}-wal`;
  const liveShm = `${liveDb}-shm`;
  if (existsSync(liveDb)) copyFileSync(liveDb, join(incidentDir, "codex-mem.db.pre-rebuild"));
  if (existsSync(liveWal)) copyFileSync(liveWal, join(incidentDir, "codex-mem.db-wal.pre-rebuild"));
  if (existsSync(liveShm)) copyFileSync(liveShm, join(incidentDir, "codex-mem.db-shm.pre-rebuild"));

  let db: Database.Database | null = null;
  try {
    db = new Database(liveDb, { fileMustExist: true });
    configurePragmas(db);
    initializeRepositorySchema(db);
    db.exec(`INSERT INTO observations_fts(observations_fts) VALUES('rebuild')`);
    db.exec("REINDEX");
    db.exec("ANALYZE");
  } catch (error) {
    db?.close();
    return {
      status: "failed",
      sourcePath: paths.dbPath,
      incidentDir,
      checkedAt: new Date().toISOString(),
      schemaVersion: 0,
      observationCount: 0,
      durableMemoryCount: 0,
      sourceOffsetCount: 0,
      validationStatus: "db_unreadable",
      validationMessage: error instanceof Error ? error.message : String(error),
    };
  } finally {
    db?.close();
  }

  const health = await inspectRuntimeHealth(paths, "cli");
  const rowCounts = readRowCounts(paths.dbPath);
  const report: DatabaseRepairReport = {
    status: health.safeToStart ? "repaired" : "failed",
    sourcePath: paths.dbPath,
    incidentDir,
    checkedAt: new Date().toISOString(),
    schemaVersion: health.schemaVersion,
    observationCount: rowCounts.observationCount,
    durableMemoryCount: rowCounts.durableMemoryCount,
    sourceOffsetCount: rowCounts.sourceOffsetCount,
    validationStatus: health.dbHealth,
    validationMessage: health.degradedReason ?? health.status,
  };
  writeFileSync(join(incidentDir, "rebuild-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function recoverDatabase(
  paths: MemoryPaths,
  mode: "auto" | "db" | "service-path" = "auto",
): Promise<{ modeUsed: "db" | "service-path"; report: DatabaseRepairReport; health: DatabaseHealthReport }> {
  const health = await inspectRuntimeHealth(paths, "cli");
  if (mode === "db") {
    return { modeUsed: "db", report: repairDatabase(paths), health };
  }
  if (mode === "service-path") {
    return { modeUsed: "service-path", report: await rebuildQueryLayer(paths), health };
  }
  if (health.dbHealth !== "ok" && health.dbHealth !== "db_missing") {
    return { modeUsed: "db", report: repairDatabase(paths), health };
  }
  return {
    modeUsed: "service-path",
    report: await rebuildQueryLayer(paths),
    health,
  };
}

export async function getStatusReport(paths: MemoryPaths, surface: RuntimeSurface = "cli"): Promise<DatabaseHealthReport> {
  return inspectRuntimeHealth(paths, surface);
}

export function getSnapshotManifest(paths: MemoryPaths): SnapshotManifest {
  const path = getSnapshotManifestPath(paths);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SnapshotManifest;
    if (Array.isArray(parsed.snapshots)) return parsed;
  } catch {
    // ignore
  }
  return { snapshots: [] };
}

function appendSnapshotMetadata(paths: MemoryPaths, metadata: SnapshotMetadata): void {
  const manifest = getSnapshotManifest(paths);
  manifest.snapshots.push(metadata);
  writeSnapshotManifest(paths, manifest);
}

function writeSnapshotManifest(paths: MemoryPaths, manifest: SnapshotManifest): void {
  mkdirSync(getBackupsDir(paths), { recursive: true });
  writeFileSync(getSnapshotManifestPath(paths), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function pruneSnapshots(paths: MemoryPaths): void {
  const manifest = getSnapshotManifest(paths);
  const keep = new Set<string>();
  const snapshots = [...manifest.snapshots].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  for (const snapshot of snapshots.slice(0, SNAPSHOT_KEEP_RECENT)) {
    keep.add(snapshot.path);
  }

  const daily = new Map<string, SnapshotMetadata>();
  for (const snapshot of snapshots) {
    const day = snapshot.createdAt.slice(0, 10);
    if (!daily.has(day)) {
      daily.set(day, snapshot);
    }
    if (daily.size >= SNAPSHOT_KEEP_DAILY) break;
  }
  for (const snapshot of daily.values()) {
    keep.add(snapshot.path);
  }

  const nextSnapshots = manifest.snapshots.filter((snapshot) => keep.has(snapshot.path));
  for (const snapshot of manifest.snapshots) {
    if (keep.has(snapshot.path)) continue;
    rmSync(snapshot.path, { force: true });
  }
  writeSnapshotManifest(paths, { snapshots: nextSnapshots });
}

function inspectPath(dbPath: string): DatabaseHealthReport {
  return inspectDatabasePath(dbPath);
}

export async function runServiceProbeCommand(
  paths: MemoryPaths,
  probe: ServiceProbeName,
  surface: RuntimeSurface,
): Promise<ServiceProbeResult> {
  return executeServiceProbeInline(paths, probe, surface);
}

async function executeServiceProbe(
  paths: MemoryPaths,
  probe: ServiceProbeName,
  options: { surface: RuntimeSurface; runtimeContext: RuntimeContext },
): Promise<ServiceProbeResult> {
  const forced = readForcedProbeFailure(probe);
  if (forced) {
    return forced;
  }

  if (shouldUseInlineProbe()) {
    return executeServiceProbeInline(paths, probe, options.surface);
  }
  return executeServiceProbeSubprocess(paths, probe, options.surface, options.runtimeContext);
}

async function executeServiceProbeInline(
  paths: MemoryPaths,
  probe: ServiceProbeName,
  surface: RuntimeSurface,
): Promise<ServiceProbeResult> {
  const startedAt = Date.now();
  const cwd = process.cwd();
  const service = new MemoryService(paths);
  try {
    switch (probe) {
      case "query_smoke_search":
        await service.probeSearch({ query: "runtime", cwd, limit: 3, scopeMode: "exact_workspace" });
        break;
      case "query_smoke_context":
        await service.probeBuildContextPack({
          cwd,
          query: "runtime",
          limit: 3,
          sessionLimit: 1,
          scopeMode: "exact_workspace",
        });
        break;
      case "query_smoke_sessions":
        await service.probeSessions({ cwd, limit: 2, scopeMode: "exact_workspace" });
        break;
      case "sync_dry_probe":
        if (surface === "worker") {
          await service.syncDryProbe();
        }
        break;
    }
    return {
      probe,
      status: "ok",
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      probe,
      status: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    service.close();
  }
}

function executeServiceProbeSubprocess(
  paths: MemoryPaths,
  probe: ServiceProbeName,
  surface: RuntimeSurface,
  runtimeContext: RuntimeContext,
): ServiceProbeResult {
  const startedAt = Date.now();
  const cliPath = resolveCliEntrypoint();
  if (!cliPath) {
    return {
      probe,
      status: "error",
      errorMessage: "unable to resolve cli.js for service probe",
      durationMs: Date.now() - startedAt,
    };
  }

  const result = spawnSync(
    process.execPath,
    [cliPath, "service-probe", "--probe", probe, "--surface", surface, "--json"],
    {
      env: {
        ...process.env,
        CODEX_MEM_SKIP_SERVICE_PATH_PREFLIGHT: "1",
        CODEX_MEM_SKIP_PRESTART_SNAPSHOT: "1",
        CODEX_MEM_RUNTIME_CONTEXT: runtimeContext,
        CODEX_HOME: paths.codexHome,
        CODEX_MEM_DATA_DIR: paths.dataDir,
        CODEX_MEM_DB_PATH: paths.dbPath,
      },
      encoding: "utf8",
      timeout: DEFAULT_PROBE_TIMEOUT_MS,
    },
  );

  if (result.error) {
    return {
      probe,
      status: result.error.message.toLowerCase().includes("timed out") ? "timeout" : "error",
      errorMessage: result.error.message,
      durationMs: Date.now() - startedAt,
    };
  }
  if (result.signal) {
    return {
      probe,
      status: "timeout",
      errorMessage: `terminated by signal ${result.signal}`,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const parsed = JSON.parse(result.stdout || "{}") as { probe?: ServiceProbeResult };
    if (parsed.probe) {
      return {
        ...parsed.probe,
        probe,
        durationMs: parsed.probe.durationMs || Date.now() - startedAt,
      };
    }
  } catch {
    // fall through
  }

  return {
    probe,
    status: result.status === 0 ? "ok" : "error",
    errorMessage: result.status === 0 ? undefined : (result.stderr || result.stdout || "service probe failed").trim(),
    durationMs: Date.now() - startedAt,
  };
}

function resolveCliEntrypoint(): string | null {
  const candidate = fileURLToPath(new URL("./cli.js", import.meta.url));
  return existsSync(candidate) ? candidate : null;
}

function shouldUseInlineProbe(): boolean {
  return Boolean(process.env.VITEST) || !resolveCliEntrypoint();
}

function summarizeServicePathHealth(results: ServiceProbeResult[]): ServicePathHealthStatus {
  if (results.length === 0) return "service_probe_skipped";
  if (results.some((result) => result.status === "timeout")) return "query_path_timeout";
  if (results.some((result) => result.status === "error")) return "query_path_error";
  if (results.every((result) => result.status === "skipped")) return "service_probe_skipped";
  return "service_ok";
}

function firstProbeFailure(results: ServiceProbeResult[]): string | undefined {
  const failed = results.find((result) => result.status !== "ok" && result.status !== "skipped");
  if (!failed) return undefined;
  return failed.errorMessage ? `${failed.probe}: ${failed.errorMessage}` : failed.probe;
}

function combineOverallStatus(
  dbHealth: DatabaseHealthStatus,
  servicePathHealth: ServicePathHealthStatus,
): DatabaseHealthReport["status"] {
  if (dbHealth !== "ok" && dbHealth !== "db_missing") return dbHealth;
  const serviceOk = servicePathHealth === "service_ok" || servicePathHealth === "service_probe_skipped";
  if (dbHealth === "db_missing") {
    return serviceOk ? "db_missing_service_ok" : "db_missing_service_degraded";
  }
  return serviceOk ? "db_ok_service_ok" : "db_ok_service_degraded";
}

function serviceProbeNamesForSurface(surface: RuntimeSurface): ServiceProbeName[] {
  switch (surface) {
    case "worker":
      return ["query_smoke_search", "query_smoke_context", "query_smoke_sessions", "sync_dry_probe"];
    case "dashboard":
    case "mcp-server":
    case "cli":
      return ["query_smoke_search", "query_smoke_context", "query_smoke_sessions"];
  }
}

function detectRuntimeContext(): RuntimeContext {
  if (process.env.CODEX_MEM_RUNTIME_CONTEXT === "docker") return "docker";
  return existsSync("/.dockerenv") ? "docker" : "host";
}

function readForcedProbeFailure(probe: ServiceProbeName): ServiceProbeResult | null {
  const raw = process.env.CODEX_MEM_FORCE_PROBE_FAILURE;
  if (!raw) return null;
  const [name, status, ...rest] = raw.split(":");
  if (name !== probe) return null;
  const forcedStatus = status === "timeout" ? "timeout" : "error";
  return {
    probe,
    status: forcedStatus,
    errorMessage: rest.join(":") || `forced ${forcedStatus}`,
    durationMs: 0,
  };
}

function readPragmas(db: Database.Database): DatabasePragmas {
  return {
    journalMode: String(db.pragma("journal_mode", { simple: true }) ?? ""),
    synchronous: Number(db.pragma("synchronous", { simple: true }) ?? 0),
    walAutocheckpoint: Number(db.pragma("wal_autocheckpoint", { simple: true }) ?? 0),
    foreignKeys: Number(db.pragma("foreign_keys", { simple: true }) ?? 0),
    busyTimeout: Number(db.pragma("busy_timeout", { simple: true }) ?? 0),
  };
}

function getUserVersion(db: Database.Database): number {
  return Number(db.pragma("user_version", { simple: true }) ?? 0);
}

function schemaLooksValid(db: Database.Database): boolean {
  const rows = db
    .prepare(`SELECT type, name FROM sqlite_master WHERE type IN ('table','index','trigger')`)
    .all() as Array<{ type: string; name: string }>;
  const names = new Set(rows.map((row) => `${row.type}:${row.name}`));
  for (const table of REQUIRED_TABLES) {
    if (!names.has(`table:${table}`)) return false;
  }
  for (const index of REQUIRED_INDEXES) {
    if (!names.has(`index:${index}`)) return false;
  }
  for (const trigger of REQUIRED_TRIGGERS) {
    if (!names.has(`trigger:${trigger}`)) return false;
  }
  return true;
}

function readRowCounts(dbPath: string): {
  observationCount: number;
  durableMemoryCount: number;
  sourceOffsetCount: number;
} {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const observationRow = db.prepare("SELECT count(*) AS count FROM observations").get() as
      | { count?: number }
      | undefined;
    const durableRow = db.prepare("SELECT count(*) AS count FROM durable_memories").get() as
      | { count?: number }
      | undefined;
    const offsetRow = db.prepare("SELECT count(*) AS count FROM source_offsets").get() as
      | { count?: number }
      | undefined;
    return {
      observationCount: Number(observationRow?.count ?? 0),
      durableMemoryCount: Number(durableRow?.count ?? 0),
      sourceOffsetCount: Number(offsetRow?.count ?? 0),
    };
  } finally {
    db.close();
  }
}

function getBackupsDir(paths: MemoryPaths): string {
  return join(paths.dataDir, "backups");
}

function getSnapshotManifestPath(paths: MemoryPaths): string {
  return join(getBackupsDir(paths), "manifest.json");
}

function escapeSqlitePath(path: string): string {
  return path.replaceAll("'", "''");
}
