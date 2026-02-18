import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryService } from "../src/memory-service.js";
import type { MemoryPaths } from "../src/types.js";

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
      expect(contextPack.sessions.length).toBeGreaterThan(0);
      expect(contextPack.notes.some((row) => row.type === "manual_note")).toBe(true);
      expect(contextPack.markdown).toContain("# codex-mem context");
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
