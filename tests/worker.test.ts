import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryService } from "../src/memory-service.js";
import { runWorker } from "../src/worker.js";
import type { MemoryPaths, SyncResult } from "../src/types.js";

const createdRoots: string[] = [];

afterEach(() => {
  delete process.env.CODEX_MEM_FORCE_PROBE_FAILURE;
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("worker", () => {
  it("captures new session entries across run-once sync cycles", async () => {
    const paths = createFixture();
    const sessionPath = seedInitialSession(paths.codexHome);

    const firstSyncs: SyncResult[] = [];
    await runWorker(paths, {
      runOnce: true,
      onSync: (result) => {
        firstSyncs.push(result);
      },
    });

    expect(firstSyncs.length).toBe(1);
    expect(firstSyncs[0]?.observationsInserted).toBeGreaterThan(0);

    appendFileSync(
      sessionPath,
      `${JSON.stringify({
        timestamp: "2026-02-18T19:46:42.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "Follow-up: captured new worker sync entry",
        },
      })}\n`,
      "utf8",
    );

    const secondSyncs: SyncResult[] = [];
    await runWorker(paths, {
      runOnce: true,
      onSync: (result) => {
        secondSyncs.push(result);
      },
    });

    expect(secondSyncs.length).toBe(1);
    expect(secondSyncs[0]?.observationsInserted).toBeGreaterThan(0);

    const service = new MemoryService(paths);
    try {
      const rows = await service.search({
        query: "follow-up entry",
        cwd: "/Users/chadsimon/code/my-project",
      });
      expect(rows.some((row) => row.text.toLowerCase().includes("follow-up"))).toBe(true);
    } finally {
      service.close();
    }
  });

  it("refuses to start when the database fails integrity preflight", async () => {
    const paths = createFixture();
    writeFileSync(paths.dbPath, "not sqlite", "utf8");

    await expect(
      runWorker(paths, {
        runOnce: true,
      }),
    ).rejects.toMatchObject({
      name: "DatabaseHealthError",
      report: expect.objectContaining({
        safeToStart: false,
        dbHealth: expect.stringMatching(/db_(unreadable|corrupt)/),
      }),
    });
  });

  it("refuses to start when service-path probes fail even if the DB is healthy", async () => {
    const paths = createFixture();
    seedInitialSession(paths.codexHome);
    process.env.CODEX_MEM_FORCE_PROBE_FAILURE = "query_smoke_search:error:forced probe failure";

    await expect(
      runWorker(paths, {
        runOnce: true,
      }),
    ).rejects.toMatchObject({
      name: "DatabaseHealthError",
      report: expect.objectContaining({
        dbHealth: "ok",
        servicePathHealth: "query_path_error",
        safeToStart: false,
      }),
    });
  });
});

function createFixture(): MemoryPaths {
  const root = mkdtempSync(join(tmpdir(), "codex-mem-worker-test-"));
  createdRoots.push(root);

  const codexHome = join(root, ".codex");
  const dataDir = join(root, ".codex-mem");
  const dbPath = join(dataDir, "codex-mem.db");

  mkdirSync(codexHome, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  return { codexHome, dataDir, dbPath };
}

function seedInitialSession(codexHome: string): string {
  const sessionDir = join(codexHome, "sessions", "2026", "02", "18");
  mkdirSync(sessionDir, { recursive: true });

  const sessionPath = join(
    sessionDir,
    "rollout-2026-02-18T14-45-47-019c7249-880e-79b3-9b32-17e738f5ffe6.jsonl",
  );

  const lines = [
    JSON.stringify({
      timestamp: "2026-02-18T19:45:51.334Z",
      type: "session_meta",
      payload: {
        id: "019c7249-880e-79b3-9b32-17e738f5ffe6",
        cwd: "/Users/chadsimon/code/my-project",
      },
    }),
    JSON.stringify({
      timestamp: "2026-02-18T19:46:10.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "build API schema migration workflow",
      },
    }),
  ];

  writeFileSync(sessionPath, `${lines.join("\n")}\n`, "utf8");
  return sessionPath;
}
