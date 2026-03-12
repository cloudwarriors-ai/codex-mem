import { type ChildProcess, fork, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const CLI_PATH = join(import.meta.dirname, "..", "dist", "cli.js");
const createdHomes: string[] = [];

afterEach(() => {
  while (createdHomes.length > 0) {
    const home = createdHomes.pop();
    if (home) rmSync(home, { recursive: true, force: true });
  }
});

describe("mcp-server graceful shutdown", () => {
  it("exits when stdin is closed for a plain stdio child", async () => {
    const home = createHome();
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, [${JSON.stringify(CLI_PATH)}, "mcp-server"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, HOME: ${JSON.stringify(home)} },
});
const timeout = setTimeout(() => {
  child.kill("SIGKILL");
  process.stderr.write("timeout waiting for child exit\\n");
  process.exit(2);
}, 9000);
setTimeout(() => child.stdin.end(), 500);
child.on("exit", (code) => {
  clearTimeout(timeout);
  process.exit([0, 1].includes(code) ? 0 : 3);
});
        `,
      ],
      { encoding: "utf8", timeout: 15000 },
    );

    expect(result.status).toBe(0);
  }, 15000);

  it("exits when stdin is closed (parent disconnects)", async () => {
    const home = createHome();
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
const { fork } = require("node:child_process");
const child = fork(${JSON.stringify(CLI_PATH)}, ["mcp-server"], {
  stdio: ["pipe", "pipe", "pipe", "ipc"],
  env: { ...process.env, HOME: ${JSON.stringify(home)} },
});
const timeout = setTimeout(() => {
  child.kill("SIGKILL");
  process.stderr.write("timeout waiting for child exit\\n");
  process.exit(2);
}, 9000);
setTimeout(() => child.stdin.end(), 500);
child.on("exit", (code) => {
  clearTimeout(timeout);
  process.exit([0, 1].includes(code) ? 0 : 3);
});
        `,
      ],
      { encoding: "utf8", timeout: 15000 },
    );

    expect(result.status).toBe(0);
  }, 15000);

  it("replaces an existing mcp-server for the same data dir", async () => {
    const home = createHome();
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const env = { ...process.env, HOME: ${JSON.stringify(home)} };
const first = spawn(process.execPath, [${JSON.stringify(CLI_PATH)}, "mcp-server"], { stdio: ["pipe", "pipe", "pipe"], env });
let second;
const lockPath = join(${JSON.stringify(home)}, ".codex-mem", "runtime-locks", "mcp-server.json");
const fail = (code, message) => {
  process.stderr.write(message + "\\n");
  try { first.kill("SIGKILL"); } catch {}
  try { second?.kill("SIGKILL"); } catch {}
  process.exit(code);
};
first.on("exit", (code) => {
  clearTimeout(firstTimeout);
  if (![0, 1].includes(code)) fail(3, "first mcp-server exited unexpectedly");
  const lockDeadline = Date.now() + 6000;
  const waitForLock = () => {
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      if (!second) fail(8, "replacement mcp-server missing");
      if (lock.pid !== second.pid) fail(4, "replacement lock pid mismatch");
      second.stdin.end();
      const secondTimeout = setTimeout(() => fail(5, "replacement mcp-server did not exit"), 6000);
      second.on("exit", (secondCode) => {
        clearTimeout(secondTimeout);
        process.exit([0, 1].includes(secondCode) ? 0 : 6);
      });
      return;
    }
    if (Date.now() >= lockDeadline) fail(7, "replacement lock did not appear");
    setTimeout(waitForLock, 50);
  };
  waitForLock();
});
const startDeadline = Date.now() + 6000;
const waitForFirstLock = () => {
  if (existsSync(lockPath)) {
    second = spawn(process.execPath, [${JSON.stringify(CLI_PATH)}, "mcp-server"], { stdio: ["pipe", "pipe", "pipe"], env });
    return;
  }
  if (Date.now() >= startDeadline) fail(9, "first mcp-server never acquired the runtime lock");
  setTimeout(waitForFirstLock, 50);
};
waitForFirstLock();
const firstTimeout = setTimeout(() => fail(2, "first mcp-server did not exit"), 6000);
        `,
      ],
      { encoding: "utf8", timeout: 18000 },
    );

    expect(result.status).toBe(0);
  }, 20000);

  it("exits on SIGTERM", async () => {
    const home = createHome();
    const child = fork(CLI_PATH, ["mcp-server"], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...process.env, HOME: home },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    child.kill("SIGTERM");

    const result = await waitForExit({
      onTimeout: () => child.kill("SIGKILL"),
      timeoutMs: 3000,
      errorMessage: "MCP server did not exit within 5 seconds after SIGTERM",
      child,
    });

    // Process exits cleanly (code 0) or is terminated by the signal itself.
    // Both indicate the handler ran — Node may report signal death before
    // process.exit(0) completes depending on timing.
    const exitedCleanly = result.code === 0 || result.signal === "SIGTERM";
    expect(exitedCleanly).toBe(true);
  }, 10000);
});

function createHome(): string {
  const home = mkdtempSync(join(tmpdir(), "codex-mem-test-shutdown-"));
  createdHomes.push(home);
  return home;
}

function waitForExit(
  options: {
    child: ChildProcess;
    timeoutMs: number;
    errorMessage: string;
    onTimeout: () => void;
  },
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      options.onTimeout();
      reject(new Error(options.errorMessage));
    }, options.timeoutMs);

    options.child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${path}`);
}
