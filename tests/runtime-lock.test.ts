import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireRuntimeLock } from "../src/runtime-lock.js";
import type { MemoryPaths } from "../src/types.js";

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime lock ownership", () => {
  it("does not remove a newer lock owned by another pid", () => {
    const paths = createPaths();
    const handle = acquireRuntimeLock(paths, "mcp-server");
    const lockPath = handle.path;

    writeFileSync(
      lockPath,
      `${JSON.stringify(
        {
          surface: "mcp-server",
          pid: process.pid + 1,
          ppid: process.ppid,
          createdAt: new Date().toISOString(),
          command: "node dist/cli.js mcp-server",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    handle.release();

    const current = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number };
    expect(current.pid).toBe(process.pid + 1);
  });
});

function createPaths(): MemoryPaths {
  const root = join(tmpdir(), `codex-mem-runtime-lock-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  createdDirs.push(root);
  const codexHome = join(root, ".codex");
  const dataDir = join(root, ".codex-mem");
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  return {
    codexHome,
    dataDir,
    dbPath: join(dataDir, "codex-mem.db"),
  };
}
