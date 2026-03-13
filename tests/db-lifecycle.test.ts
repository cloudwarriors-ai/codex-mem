import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryService } from "../src/memory-service.js";
import {
  bootstrapRuntime,
  createSnapshot,
  DatabaseHealthError,
  getSnapshotManifest,
  getStatusReport,
  rebuildQueryLayer,
  recoverDatabase,
  repairDatabase,
} from "../src/db-lifecycle.js";
import type { MemoryPaths } from "../src/types.js";

const createdRoots: string[] = [];

afterEach(() => {
  delete process.env.CODEX_MEM_FORCE_PROBE_FAILURE;
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("db lifecycle", () => {
  it("reports hardened pragmas on a healthy database", async () => {
    const paths = createFixture();
    const service = new MemoryService(paths);
    service.close();

    const health = await getStatusReport(paths);
    expect(health.dbHealth).toBe("ok");
    expect(health.servicePathHealth).toBe("service_ok");
    expect(health.pragmas?.journalMode.toLowerCase()).toBe("wal");
    expect(health.pragmas?.synchronous).toBe(2);
    expect(health.pragmas?.foreignKeys).toBe(1);
    expect(health.pragmas?.busyTimeout).toBeGreaterThan(0);
  });

  it("blocks bootstrap on an unreadable database", async () => {
    const paths = createFixture();
    writeFileSync(paths.dbPath, "definitely not sqlite", "utf8");

    await expect(bootstrapRuntime(paths, "cli")).rejects.toMatchObject({
      name: "DatabaseHealthError",
      report: expect.objectContaining({
        safeToStart: false,
        status: expect.stringMatching(/db_(unreadable|corrupt)/),
      }),
    });
  });

  it("creates healthy snapshots and records them in the manifest", async () => {
    const paths = createFixture();
    const service = new MemoryService(paths);
    await service.saveMemory({ text: "snapshot test", cwd: "/Users/chadsimon/code/project-a" });
    service.close();

    const snapshot = await createSnapshot(paths, "test-snapshot");
    const manifest = getSnapshotManifest(paths);

    expect(snapshot.status).toBe("healthy");
    expect(manifest.snapshots.some((entry) => entry.path === snapshot.path)).toBe(true);
  });

  it("repairs a schema-invalid database by rebuilding canonical tables", async () => {
    const paths = createFixture();
    const service = new MemoryService(paths);
    await service.saveMemory({
      text: "repair keeps durable rows",
      title: "Repair Durable",
      cwd: "/Users/chadsimon/code/project-a",
    });
    service.close();

    const db = new Database(paths.dbPath);
    try {
      db.exec(`
        DROP TRIGGER IF EXISTS observations_ai;
        DROP TRIGGER IF EXISTS observations_ad;
        DROP TRIGGER IF EXISTS observations_au;
        DROP TABLE IF EXISTS observations_fts;
        DROP TABLE IF EXISTS observations_fts_data;
        DROP TABLE IF EXISTS observations_fts_idx;
        DROP TABLE IF EXISTS observations_fts_docsize;
        DROP TABLE IF EXISTS observations_fts_config;
      `);
    } finally {
      db.close();
    }

    expect((await getStatusReport(paths)).dbHealth).toBe("schema_invalid");

    const report = repairDatabase(paths);
    expect(report.status).toBe("repaired");
    expect(report.validationStatus).toBe("ok");

    const health = await getStatusReport(paths);
    expect(health.dbHealth).toBe("ok");

    const verify = new MemoryService(paths);
    try {
      const rows = await verify.search({
        query: "repair durable",
        cwd: "/Users/chadsimon/code/project-a",
      });
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      verify.close();
    }
  });

  it("rebuilds the query layer and restores healthy service-path status", async () => {
    const paths = createFixture();
    const service = new MemoryService(paths);
    await service.saveMemory({ text: "query layer rebuild", cwd: "/Users/chadsimon/code/project-a" });
    service.close();

    const report = await rebuildQueryLayer(paths);
    expect(report.status).toBe("repaired");

    const health = await getStatusReport(paths);
    expect(health.dbHealth).toBe("ok");
    expect(health.servicePathHealth).toBe("service_ok");
    expect(health.safeToStart).toBe(true);
  });

  it("prefers service-path recovery when the DB is readable but probes fail", async () => {
    const paths = createFixture();
    const service = new MemoryService(paths);
    await service.saveMemory({ text: "auto recovery", cwd: "/Users/chadsimon/code/project-a" });
    service.close();
    process.env.CODEX_MEM_FORCE_PROBE_FAILURE = "query_smoke_search:error:forced service probe failure";

    const recovery = await recoverDatabase(paths, "auto");
    expect(recovery.modeUsed).toBe("service-path");
  });
});

function createFixture(): MemoryPaths {
  const root = mkdtempSync(join(tmpdir(), "codex-mem-db-lifecycle-"));
  createdRoots.push(root);

  const codexHome = join(root, ".codex");
  const dataDir = join(root, ".codex-mem");
  const dbPath = join(dataDir, "codex-mem.db");

  mkdirSync(codexHome, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  return { codexHome, dataDir, dbPath };
}
