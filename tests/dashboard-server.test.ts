import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startDashboardServer, type DashboardServer } from "../src/dashboard-server.js";
import type { MemoryPaths } from "../src/types.js";

const createdRoots: string[] = [];
const activeServers: DashboardServer[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    if (server) await server.close();
  }

  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("dashboard server", () => {
  it("serves UI, modular assets, and API endpoints", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const server = await startDashboardServer(paths, { host: "127.0.0.1", port: 0 });
    activeServers.push(server);

    const html = await fetchText(`${server.url}/`);
    expect(html).toContain("codex-mem atlas");

    const styles = await fetchText(`${server.url}/assets/dashboard.css`);
    expect(styles).toContain("--accent:");

    const clientJs = await fetchText(`${server.url}/assets/dashboard.js`);
    expect(clientJs).toContain("DashboardController");

    const controllerModule = await fetchText(`${server.url}/assets/client/controller.js`);
    expect(controllerModule).toContain("class DashboardController");

    const health = await fetchJson(`${server.url}/api/health`);
    expect(health.status).toBe("ok");
    expect(health.sync).toBeDefined();

    const search = await fetchJson(`${server.url}/api/search?query=schema%20migration&limit=10`);
    expect(Array.isArray(search.observations)).toBe(true);
    expect(search.observations.length).toBeGreaterThan(0);

    const firstId = search.observations[0]?.id;
    expect(typeof firstId).toBe("number");

    const timeline = await fetchJson(
      `${server.url}/api/timeline?anchor=${firstId}&before=2&after=2`,
    );
    expect(Array.isArray(timeline.observations)).toBe(true);
    expect(timeline.observations.length).toBeGreaterThan(0);

    const stats = await fetchJson(`${server.url}/api/stats`);
    expect(stats.stats.total).toBeGreaterThan(0);

    const projects = await fetchJson(`${server.url}/api/projects?limit=5`);
    expect(Array.isArray(projects.projects)).toBe(true);
    expect(projects.projects.length).toBeGreaterThan(0);

    const sessions = await fetchJson(`${server.url}/api/sessions?limit=5`);
    expect(Array.isArray(sessions.sessions)).toBe(true);
    expect(sessions.sessions.length).toBeGreaterThan(0);

    const contextPack = await fetchJson(`${server.url}/api/context_pack?limit=5&sessionLimit=3`);
    expect(contextPack.contextPack.highlights.length).toBeGreaterThan(0);
    expect(typeof contextPack.contextPack.markdown).toBe("string");

    const observation = await fetchJson(`${server.url}/api/observation/${firstId}`);
    expect(observation.observation.id).toBe(firstId);

    const saved = await fetchJson(`${server.url}/api/save_memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "remember dashboard smoke test" }),
    });

    expect(saved.status).toBe("saved");
    expect(typeof saved.id).toBe("number");

    const batch = await fetchJson(`${server.url}/api/observations/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [saved.id] }),
    });

    expect(batch.observations.length).toBe(1);
    expect(batch.observations[0]?.type).toBe("manual_note");

    const sseController = new AbortController();
    const sseResponse = await fetch(`${server.url}/api/events`, {
      signal: sseController.signal,
    });
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toContain("text/event-stream");
    sseController.abort();
  });

  it("returns structured input errors", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const server = await startDashboardServer(paths, { host: "127.0.0.1", port: 0 });
    activeServers.push(server);

    const res = await fetch(`${server.url}/api/timeline`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("validates type filters, id routes, module paths, and malformed JSON payloads", async () => {
    const paths = createFixture();
    seedCodexLogs(paths.codexHome);

    const server = await startDashboardServer(paths, { host: "127.0.0.1", port: 0 });
    activeServers.push(server);

    const invalidTypeRes = await fetch(`${server.url}/api/search?type=not_a_type`);
    expect(invalidTypeRes.status).toBe(400);
    const invalidTypeBody = (await invalidTypeRes.json()) as { error: { code: string } };
    expect(invalidTypeBody.error.code).toBe("INVALID_INPUT");

    const invalidObservationRes = await fetch(`${server.url}/api/observation/not-a-number`);
    expect(invalidObservationRes.status).toBe(400);

    const missingObservationRes = await fetch(`${server.url}/api/observation/999999`);
    expect(missingObservationRes.status).toBe(404);

    const invalidModuleRes = await fetch(`${server.url}/assets/client/%5ccontroller.js`);
    expect(invalidModuleRes.status).toBe(400);

    const malformedJsonRes = await fetch(`${server.url}/api/save_memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"text":',
    });
    expect(malformedJsonRes.status).toBe(400);
    const malformedJsonBody = (await malformedJsonRes.json()) as { error: { code: string } };
    expect(malformedJsonBody.error.code).toBe("INVALID_INPUT");

    const emptyBatchRes = await fetch(`${server.url}/api/observations/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(emptyBatchRes.status).toBe(400);
    const emptyBatchBody = (await emptyBatchRes.json()) as { error: { code: string } };
    expect(emptyBatchBody.error.code).toBe("INVALID_INPUT");
  });
});

function createFixture(): MemoryPaths {
  const root = mkdtempSync(join(tmpdir(), "codex-mem-dashboard-test-"));
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

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return await res.text();
}
