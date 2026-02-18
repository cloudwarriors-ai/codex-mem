import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isDirectCliInvocation } from "../src/cli.js";

const createdRoots: string[] = [];

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("cli entrypoint detection", () => {
  it("matches direct module invocation paths", () => {
    const root = createFixture();
    const modulePath = join(root, "dist", "cli.js");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(modulePath, "#!/usr/bin/env node\n", "utf8");

    const moduleUrl = pathToFileURL(modulePath).href;
    expect(isDirectCliInvocation(moduleUrl, modulePath)).toBe(true);
  });

  it("matches symlinked argv paths used by npm bin wrappers", () => {
    const root = createFixture();
    const modulePath = join(root, "lib", "node_modules", "codex-mem", "dist", "cli.js");
    const binPath = join(root, "bin", "codex-mem");

    mkdirSync(join(root, "lib", "node_modules", "codex-mem", "dist"), { recursive: true });
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(modulePath, "#!/usr/bin/env node\n", "utf8");
    symlinkSync(modulePath, binPath);

    const moduleUrl = pathToFileURL(modulePath).href;
    expect(isDirectCliInvocation(moduleUrl, binPath)).toBe(true);
  });

  it("returns false for missing or unrelated invocation paths", () => {
    const root = createFixture();
    const modulePath = join(root, "dist", "cli.js");
    const otherPath = join(root, "other", "cli.js");

    mkdirSync(join(root, "dist"), { recursive: true });
    mkdirSync(join(root, "other"), { recursive: true });
    writeFileSync(modulePath, "#!/usr/bin/env node\n", "utf8");
    writeFileSync(otherPath, "#!/usr/bin/env node\n", "utf8");

    const moduleUrl = pathToFileURL(modulePath).href;
    expect(isDirectCliInvocation(moduleUrl, undefined)).toBe(false);
    expect(isDirectCliInvocation(moduleUrl, otherPath)).toBe(false);
  });
});

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "codex-mem-cli-entry-"));
  createdRoots.push(root);
  return root;
}
