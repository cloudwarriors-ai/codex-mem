import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

const createdRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CODEX_HOME;
  delete process.env.CODEX_MEM_DATA_DIR;
  delete process.env.CODEX_MEM_DB_PATH;
  delete process.env.CODEX_MEM_FORCE_PROBE_FAILURE;

  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("cli lifecycle commands", () => {
  it("status reports degraded health for an unreadable database", async () => {
    const fixture = createFixture();
    process.env.CODEX_HOME = fixture.codexHome;
    process.env.CODEX_MEM_DATA_DIR = fixture.dataDir;
    process.env.CODEX_MEM_DB_PATH = fixture.dbPath;
    writeFileSync(fixture.dbPath, "not sqlite", "utf8");

    const writes: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });

    await main(["node", "codex-mem", "status", "--json"]);

    stdoutSpy.mockRestore();
    const parsed = JSON.parse(writes.join("")) as {
      health: { dbHealth: string; servicePathHealth: string; safeToStart: boolean };
    };
    expect(parsed.health.dbHealth).toMatch(/db_(unreadable|corrupt)/);
    expect(parsed.health.safeToStart).toBe(false);
  });

  it("status reports service-path degradation separately from DB health", async () => {
    const fixture = createFixture();
    process.env.CODEX_HOME = fixture.codexHome;
    process.env.CODEX_MEM_DATA_DIR = fixture.dataDir;
    process.env.CODEX_MEM_DB_PATH = fixture.dbPath;
    process.env.CODEX_MEM_FORCE_PROBE_FAILURE = "query_smoke_search:error:forced service probe failure";

    const writes: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });

    await main(["node", "codex-mem", "status", "--json"]);

    stdoutSpy.mockRestore();
    const parsed = JSON.parse(writes.join("")) as {
      health: { dbHealth: string; servicePathHealth: string; status: string; safeToStart: boolean };
    };
    expect(parsed.health.dbHealth).toBe("db_missing");
    expect(parsed.health.servicePathHealth).toBe("query_path_error");
    expect(parsed.health.status).toBe("db_missing_service_degraded");
    expect(parsed.health.safeToStart).toBe(false);
  });
});

function createFixture(): { codexHome: string; dataDir: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "codex-mem-cli-lifecycle-"));
  createdRoots.push(root);

  const codexHome = join(root, ".codex");
  const dataDir = join(root, ".codex-mem");
  const dbPath = join(dataDir, "codex-mem.db");

  mkdirSync(codexHome, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  return { codexHome, dataDir, dbPath };
}
