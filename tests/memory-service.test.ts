import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryService } from "../src/memory-service.js";
import type { MemoryPaths, RetrievalBenchmarkCase } from "../src/types.js";

const createdRoots: string[] = [];

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("MemoryService", () => {
  it("ingests Codex session/history logs and supports search", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      const syncResult = await service.sync();
      expect(syncResult.status).toBe("ok");
      expect(syncResult.filesScanned).toBeGreaterThanOrEqual(2);
      expect(syncResult.observationsInserted).toBeGreaterThanOrEqual(5);

      const search = await service.search({ query: "schema migration" });
      expect(search.length).toBeGreaterThan(0);
      expect(search.some((row) => row.type === "assistant_message")).toBe(true);

      const noisy = await service.search({ query: "exec_command" });
      expect(noisy.some((row) => row.type === "tool_call")).toBe(false);

      const explicitTool = await service.search({
        query: "exec_command",
        type: "tool_call",
      });
      expect(explicitTool.some((row) => row.type === "tool_call")).toBe(true);
    } finally {
      service.close();
    }
  });

  it("does not duplicate observations on repeated sync", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      const first = await service.sync();
      const second = await service.sync();
      expect(first.observationsInserted).toBeGreaterThan(0);
      expect(second.observationsInserted).toBe(0);
    } finally {
      service.close();
    }
  });

  it("returns chronological timeline around an anchor", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      const rows = await service.search({ query: "build API" });
      expect(rows.length).toBeGreaterThan(0);

      const anchorId = rows[0]?.id;
      expect(anchorId).toBeDefined();

      const timeline = await service.timeline(anchorId!, { before: 2, after: 2 });
      expect(timeline.length).toBeGreaterThan(0);

      for (let i = 1; i < timeline.length; i += 1) {
        expect(timeline[i]!.createdAtEpoch).toBeGreaterThanOrEqual(
          timeline[i - 1]!.createdAtEpoch,
        );
      }

      expect(timeline.some((item) => item.id === anchorId)).toBe(true);
    } finally {
      service.close();
    }
  });

  it("saves and retrieves manual memory", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      const id = await service.saveMemory({
        text: "Remember to use the migration lock before batch writes",
        title: "migration lock",
      });

      const rows = await service.getByIds([id]);
      expect(rows.length).toBe(1);
      expect(rows[0]?.type).toBe("manual_note");
      expect(rows[0]?.title).toContain("migration lock");
      expect(rows[0]?.memoryClass).toBe("summary_note");
      expect(rows[0]?.memoryStatus).toBe("active");
    } finally {
      service.close();
    }
  });

  it("resolves preferences deterministically by scope, confidence, and timestamp", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      await service.savePreference({
        schema_version: "pref-note.v1",
        key: "pref:frontend.iteration_size",
        scope: "project",
        trigger: "When changing UI",
        preferred: "One UI region per iteration",
        avoid: "Multi-region rewrites",
        example_good: "Update settings panel only",
        example_bad: "Rewrite all routes together",
        confidence: 0.7,
        source: "user",
        supersedes: [],
        created_at: "2026-03-01T00:00:00.000Z",
        cwd: "/Users/chadsimon/code/my-project",
      });

      await service.savePreference({
        schema_version: "pref-note.v1",
        key: "pref:frontend.iteration_size",
        scope: "workspace",
        trigger: "When changing UI",
        preferred: "Two components at a time",
        avoid: "Global UI rewrites",
        example_good: "Update header + footer",
        example_bad: "Rewrite design system in one pass",
        confidence: 0.99,
        source: "session",
        supersedes: [],
        created_at: "2026-03-01T00:05:00.000Z",
        cwd: "/Users/chadsimon/code/my-project",
      });

      await service.savePreference({
        schema_version: "pref-note.v1",
        key: "pref:frontend.iteration_size",
        scope: "user",
        trigger: "When changing UI",
        preferred: "Single region with visual checkpoints",
        avoid: "Large multi-route updates",
        example_good: "Update one card and re-check visual output",
        example_bad: "Update all pages without checkpoints",
        confidence: 0.2,
        source: "user",
        supersedes: [],
        created_at: "2026-03-01T00:10:00.000Z",
        cwd: "/Users/chadsimon/code/my-project",
      });

      await service.savePreference({
        schema_version: "pref-note.v1",
        key: "pref:tests.order",
        scope: "project",
        trigger: "When adding non-trivial code",
        preferred: "Run typecheck, tests, then lint",
        avoid: "Skipping typecheck before tests",
        example_good: "tsc -> vitest -> lint",
        example_bad: "lint only",
        confidence: 0.6,
        source: "session",
        supersedes: [],
        created_at: "2026-03-01T00:00:00.000Z",
        cwd: "/Users/chadsimon/code/my-project",
      });

      await service.savePreference({
        schema_version: "pref-note.v1",
        key: "pref:tests.order",
        scope: "project",
        trigger: "When adding non-trivial code",
        preferred: "Run tests then typecheck then lint",
        avoid: "Skipping test run",
        example_good: "vitest -> tsc -> lint",
        example_bad: "commit without tests",
        confidence: 0.6,
        source: "session",
        supersedes: [],
        created_at: "2026-03-01T00:20:00.000Z",
        cwd: "/Users/chadsimon/code/my-project",
      });

      const resolved = await service.resolvePreferences({
        cwd: "/Users/chadsimon/code/my-project",
      });

      const frontend = resolved.find((item) => item.key === "pref:frontend.iteration_size");
      expect(frontend?.selected.scope).toBe("user");
      expect(frontend?.selected.preferred).toContain("Single region");

      const testOrder = resolved.find((item) => item.key === "pref:tests.order");
      expect(testOrder?.selected.created_at).toBe("2026-03-01T00:20:00.000Z");
      expect(testOrder?.ignored.length).toBeGreaterThan(0);
    } finally {
      service.close();
    }
  });

  it("handles supersedes chains and keeps only active preferences by default", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      const baseId = await service.savePreference({
        schema_version: "pref-note.v1",
        key: "pref:review.style",
        scope: "global",
        trigger: "When writing review summaries",
        preferred: "Brief summary first",
        avoid: "Long narrative upfront",
        example_good: "Findings first",
        example_bad: "Long intro",
        confidence: 0.5,
        source: "imported",
        supersedes: [],
        created_at: "2026-03-01T00:00:00.000Z",
      });

      const projectId = await service.savePreference({
        schema_version: "pref-note.v1",
        key: "pref:review.style",
        scope: "project",
        trigger: "When writing review summaries",
        preferred: "Findings list with severity ordering",
        avoid: "High-level only comments",
        example_good: "P1/P2 findings list",
        example_bad: "No severity",
        confidence: 0.8,
        source: "user",
        supersedes: [String(baseId)],
        created_at: "2026-03-01T00:05:00.000Z",
      });

      const userId = await service.savePreference({
        schema_version: "pref-note.v1",
        key: "pref:review.style",
        scope: "user",
        trigger: "When writing review summaries",
        preferred: "Findings first with file:line",
        avoid: "Missing code references",
        example_good: "P1 with file path and line",
        example_bad: "Vague comment",
        confidence: 0.9,
        source: "user",
        supersedes: [String(projectId)],
        created_at: "2026-03-01T00:10:00.000Z",
      });

      const active = await service.listPreferences({ key: "pref:review.style" });
      expect(active.length).toBe(1);
      expect(active[0]?.id).toBe(userId);

      const withSuperseded = await service.listPreferences({
        key: "pref:review.style",
        includeSuperseded: true,
      });
      expect(withSuperseded.length).toBe(3);

      const resolved = await service.resolvePreferences({ keys: ["pref:review.style"] });
      expect(resolved.length).toBe(1);
      expect(resolved[0]?.selected.id).toBe(userId);
      expect(resolved[0]?.ignored.length).toBe(0);
    } finally {
      service.close();
    }
  });

  it("blocks secret-like preference payloads", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      await expect(
        service.savePreference({
          schema_version: "pref-note.v1",
          key: "pref:security.example",
          scope: "user",
          trigger: "When saving secure examples",
          preferred: "Never store authorization: Bearer sk-123456789012345678901234",
          avoid: "Store tokens in notes",
          example_good: "Use placeholders only",
          example_bad: "token=abcdef1234567890",
          confidence: 0.9,
          source: "user",
          supersedes: [],
          created_at: "2026-03-01T01:00:00.000Z",
        }),
      ).rejects.toThrow("secret-like");
    } finally {
      service.close();
    }
  });

  it("builds stats, project/session summaries, and context packs", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      await service.sync();

      await service.saveMemory({
        text: "Use migration lock before batch writes",
        title: "migration lock",
        cwd: "/Users/chadsimon/code/my-project",
      });

      await service.saveMemory({
        text: "Follow-up entry for punctuation-aware query checks",
        title: "follow-up note",
        cwd: "/Users/chadsimon/code/my-project",
      });

      const stats = await service.stats({
        cwd: "/Users/chadsimon/code/my-project",
      });
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.uniqueProjects).toBe(1);

      const projects = await service.projects({ limit: 5 });
      expect(projects.length).toBeGreaterThan(0);
      expect(projects[0]?.cwd).toBe("/Users/chadsimon/code/my-project");

      const sessions = await service.sessions({
        cwd: "/Users/chadsimon/code/my-project",
        limit: 5,
      });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions[0]?.sessionId).toBe("019c7249-880e-79b3-9b32-17e738f5ffe6");

      const contextPack = await service.buildContextPack({
        query: "migration",
        cwd: "/Users/chadsimon/code/my-project",
        limit: 6,
        sessionLimit: 3,
      });
      expect(contextPack.highlights.length).toBeGreaterThan(0);
      expect(contextPack.durableMemories.length).toBeGreaterThan(0);
      expect(contextPack.retrievalSummary.confidenceBand).not.toBe("low");
      expect(contextPack.sessions.length).toBeGreaterThan(0);
      expect(contextPack.notes.some((row) => row.type === "manual_note")).toBe(true);
      expect(contextPack.markdown).toContain("# codex-mem context");
      expect(contextPack.markdown).toContain("## Durable Memories");
      expect(contextPack.markdown).toContain("## Retrieval Summary");
      expect(contextPack.markdown).toContain("## Recent Sessions");

      const punctuatedSearch = await service.search({
        query: "follow-up query",
        cwd: "/Users/chadsimon/code/my-project",
      });
      expect(punctuatedSearch.some((row) => row.title.includes("follow-up"))).toBe(true);
    } finally {
      service.close();
    }
  });

  it("backs existing manual notes into candidate durable memory while explicit saves become active", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      await service.sync();

      const legacyId = (service as any).repo.saveManualNote({
        text: "We decided to keep migration rollback evidence attached to each batch",
        title: "legacy decision note",
        cwd: "/Users/chadsimon/code/my-project",
        metadataJson: "{}",
        createdAt: "2026-03-01T00:00:00.000Z",
        createdAtEpoch: Date.parse("2026-03-01T00:00:00.000Z"),
      });
      await (service as any).backfillDurableMemoryCandidates();

      const preExisting = await service.saveMemory({
        text: "We decided to keep migrations single-writer and checkpoint every batch",
        title: "migration decision",
        cwd: "/Users/chadsimon/code/my-project",
      });

      const rows = await service.getByIds([legacyId, preExisting]);
      const legacy = rows.find((row) => row.id === legacyId);
      const explicit = rows.find((row) => row.id === preExisting);

      expect(legacy?.memoryStatus).toBeUndefined();
      expect(explicit?.memoryStatus).toBe("active");

      const candidates = (service as any).repo.listDurableMemoryCandidates();
      expect(candidates.some((row: { observationId: number }) => row.observationId === legacyId)).toBe(true);
    } finally {
      service.close();
    }
  });

  it("runs retrieval benchmarks against the context-pack output", async () => {
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

      const cases: RetrievalBenchmarkCase[] = [
        {
          id: "pref-recall",
          description: "Retrieve active coding preference",
          cwd: "/Users/chadsimon/code/my-project",
          query: "validation order",
          expectedMemoryClasses: ["preference_note"],
          expectedPreferenceKeys: ["pref:tests.order"],
          minimumConfidenceBand: "medium",
        },
        {
          id: "fix-recall",
          description: "Retrieve known migration fix",
          cwd: "/Users/chadsimon/code/my-project",
          query: "migration lock root cause",
          expectedMemoryClasses: ["fix_note"],
          minimumConfidenceBand: "medium",
        },
      ];

      const results = await service.runRetrievalBenchmark(cases);
      expect(results.every((result) => result.passed)).toBe(true);
    } finally {
      service.close();
    }
  });

  it("ranks in-scope durable memory ahead of cross-project memory", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      await service.saveMemory({
        text: "Root cause fixed: in-scope schema lock issue",
        title: "in-scope fix",
        cwd: "/Users/chadsimon/code/my-project",
      });

      await service.saveMemory({
        text: "Root cause fixed: unrelated schema lock issue in other repo",
        title: "other repo fix",
        cwd: "/Users/chadsimon/code/other-project",
      });

      const rows = await service.search({
        cwd: "/Users/chadsimon/code/my-project",
        query: "schema lock issue",
        limit: 5,
      });

      expect(rows[0]?.cwd).toBe("/Users/chadsimon/code/my-project");
      expect(rows[0]?.selectionReason).toContain("exact_scope_match");
    } finally {
      service.close();
    }
  });

  it("includes resolved preferences in context packs", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const service = new MemoryService(paths);
    try {
      await service.savePreference({
        schema_version: "pref-note.v1",
        key: "pref:frontend.mobile_required",
        scope: "project",
        trigger: "When shipping UI updates",
        preferred: "Always verify desktop and mobile layouts",
        avoid: "Desktop-only validation",
        example_good: "Run viewport checks for 390px and 1440px",
        example_bad: "No responsive check",
        confidence: 0.95,
        source: "user",
        supersedes: [],
        created_at: "2026-03-01T00:00:00.000Z",
        cwd: "/Users/chadsimon/code/my-project",
      });

      const contextPack = await service.buildContextPack({
        cwd: "/Users/chadsimon/code/my-project",
        preferenceKeys: ["pref:frontend.mobile_required"],
        preferenceLimit: 3,
      });

      expect(contextPack.resolvedPreferences.length).toBeGreaterThan(0);
      expect(contextPack.resolvedPreferences[0]?.key).toBe("pref:frontend.mobile_required");
      expect(contextPack.markdown).toContain("## Resolved Preferences");
      expect(contextPack.markdown).toContain("pref:frontend.mobile_required");
    } finally {
      service.close();
    }
  });
});

function createFixture(): MemoryPaths {
  const root = mkdtempSync(join(tmpdir(), "codex-mem-test-"));
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
  const archivedDir = join(codexHome, "archived_sessions");
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(archivedDir, { recursive: true });

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
      timestamp: "2026-02-18T19:46:12.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: "{\"cmd\":\"npm test\"}",
        call_id: "call-1",
      },
    }),
    JSON.stringify({
      timestamp: "2026-02-18T19:46:13.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: "tests passed",
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

  const historyPath = join(codexHome, "history.jsonl");
  const historyLines = [
    JSON.stringify({
      session_id: "019c7249-880e-79b3-9b32-17e738f5ffe6",
      ts: 1771438600,
      text: "review API contract edge cases",
    }),
  ];
  writeFileSync(historyPath, `${historyLines.join("\n")}\n`, "utf8");
}
