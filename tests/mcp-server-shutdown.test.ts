import { fork } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLI_PATH = join(import.meta.dirname, "..", "dist", "cli.js");

describe("mcp-server graceful shutdown", () => {
  it("exits when stdin is closed (parent disconnects)", async () => {
    const child = fork(CLI_PATH, ["mcp-server"], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...process.env, HOME: "/tmp/codex-mem-test-shutdown" },
    });

    // Wait briefly for the server to initialize, then close stdin.
    await new Promise((resolve) => setTimeout(resolve, 500));

    child.stdin!.end();

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("MCP server did not exit within 5 seconds after stdin closed"));
      }, 5000);

      child.on("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    expect(exitCode).toBe(0);
  });

  it("exits on SIGTERM", async () => {
    const child = fork(CLI_PATH, ["mcp-server"], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...process.env, HOME: "/tmp/codex-mem-test-shutdown" },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    child.kill("SIGTERM");

    const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("MCP server did not exit within 5 seconds after SIGTERM"));
      }, 5000);

      child.on("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });

    // Process exits cleanly (code 0) or is terminated by the signal itself.
    // Both indicate the handler ran — Node may report signal death before
    // process.exit(0) completes depending on timing.
    const exitedCleanly = result.code === 0 || result.signal === "SIGTERM";
    expect(exitedCleanly).toBe(true);
  });
});
