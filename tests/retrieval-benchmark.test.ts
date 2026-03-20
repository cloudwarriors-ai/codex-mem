import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryService } from "../src/memory-service.js";
import type { MemoryPaths } from "../src/types.js";
import { retrievalBenchmarkCases } from "./retrieval-benchmark.cases.js";

const createdRoots: string[] = [];

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("retrieval benchmark corpus", () => {
  it("passes the benchmark corpus against representative fixture memory", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      await service.savePreference({
        schema_version: "pref-note.v1",
        key: "pref:tests.order",
        scope: "project",
        trigger: "When validating changes",
        preferred: "Run tests before lint",
        avoid: "Lint-only validation",
        example_good: "vitest then lint",
        example_bad: "lint only",
        confidence: 0.95,
        source: "user",
        supersedes: [],
        created_at: "2026-03-01T00:00:00.000Z",
        cwd: "/Users/chadsimon/code/my-project",
      });

      await service.saveMemory({
        text: "Root cause fixed: migration lock was missing before batch writes",
        title: "migration fix",
        cwd: "/Users/chadsimon/code/my-project",
      });

      await service.saveMemory({
        text: "Root cause fixed: in-scope schema lock issue",
        title: "schema lock fix",
        cwd: "/Users/chadsimon/code/my-project",
      });

      await service.saveMemory({
        text: "Root cause fixed: unrelated schema lock issue in other repo",
        title: "other repo fix",
        cwd: "/Users/chadsimon/code/other-project",
      });

      const results = await service.runRetrievalBenchmark(retrievalBenchmarkCases);
      expect(results.every((result) => result.passed)).toBe(true);
    } finally {
      service.close();
    }
  });
});

function createFixture(): MemoryPaths {
  const root = mkdtempSync(join(tmpdir(), "codex-mem-benchmark-test-"));
  createdRoots.push(root);

  const codexHome = join(root, ".codex");
  const dataDir = join(root, ".codex-mem");
  const dbPath = join(dataDir, "codex-mem.db");

  mkdirSync(codexHome, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  return { codexHome, dataDir, dbPath };
}

function seedCodexLogs(codexHome: string): void {
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
    JSON.stringify({
      timestamp: "2026-02-18T19:46:20.000Z",
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "Implemented schema migration with rollback safeguards",
      },
    }),
  ];

  writeFileSync(sessionPath, `${lines.join("\n")}\n`, "utf8");
}
