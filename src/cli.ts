#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "./config.js";
import {
  buildContextInputSchema,
  contextInputSchema,
  getObservationsInputSchema,
  projectListParamsSchema,
  saveMemoryInputSchema,
  searchInputSchema,
  sessionListParamsSchema,
  statsParamsSchema,
  timelineInputSchema,
} from "./contracts.js";
import { MemoryService } from "./memory-service.js";
import { runMcpServer } from "./mcp-server.js";
import { startDashboardServer } from "./dashboard-server.js";
import { runWorker } from "./worker.js";

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const HELP_TEXT = `codex-mem

Usage:
  codex-mem sync [--json]
  codex-mem search <query> [--limit N] [--offset N] [--cwd PATH] [--type TYPE] [--json]
  codex-mem timeline <anchorId> [--before N] [--after N] [--cwd PATH] [--json]
  codex-mem get <id...> [--json]
  codex-mem save <text> [--title TITLE] [--cwd PATH] [--json]
  codex-mem context [--query TEXT] [--limit N] [--cwd PATH]
  codex-mem stats [--cwd PATH] [--json]
  codex-mem projects [--limit N] [--json]
  codex-mem sessions [--cwd PATH] [--limit N] [--json]
  codex-mem build-context [--query TEXT] [--cwd PATH] [--limit N] [--session-limit N] [--json]
  codex-mem worker [--interval-seconds N] [--run-once] [--json]
  codex-mem dashboard [--host HOST] [--port PORT]
  codex-mem mcp-server
  codex-mem init-mcp [--name NAME]
`;

export async function main(argv = process.argv): Promise<void> {
  const parsed = parseArgs(argv);
  const command = parsed.command;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }

  const paths = resolvePaths();

  if (command === "mcp-server") {
    await runMcpServer(paths);
    return;
  }

  if (command === "dashboard") {
    const host = parseStringFlag(parsed.flags.host);
    const port = parseIntFlag(parsed.flags.port);
    const dashboard = await startDashboardServer(paths, { host, port });
    process.stdout.write(`codex-mem dashboard running at ${dashboard.url}\n`);

    const stop = async () => {
      await dashboard.close();
      process.exit(0);
    };

    process.on("SIGINT", () => {
      void stop();
    });

    process.on("SIGTERM", () => {
      void stop();
    });

    return;
  }

  if (command === "init-mcp") {
    runInitMcp(parsed.flags.name);
    return;
  }

  if (command === "worker") {
    await runWorker(paths, {
      intervalSeconds: parseIntFlag(parsed.flags["interval-seconds"]),
      runOnce: Boolean(parsed.flags["run-once"]),
      onSync: (result) => {
        if (parsed.flags.json) {
          process.stdout.write(
            `${JSON.stringify({ event: "sync", at: new Date().toISOString(), result })}\n`,
          );
        } else {
          process.stdout.write(
            `[codex-mem] sync ok files=${result.filesScanned} inserted=${result.observationsInserted}\n`,
          );
        }
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (parsed.flags.json) {
          process.stderr.write(
            `${JSON.stringify({
              error: { code: "WORKER_SYNC_ERROR", message },
              at: new Date().toISOString(),
            })}\n`,
          );
        } else {
          process.stderr.write(`[codex-mem] sync error: ${message}\n`);
        }
      },
    });
    return;
  }

  const service = new MemoryService(paths);

  try {
    switch (command) {
      case "sync": {
        const result = await service.sync();
        print(result, parsed.flags.json);
        return;
      }

      case "search": {
        const input = searchInputSchema.parse({
          query: parsePositionalText(parsed.positionals),
          limit: parseIntFlag(parsed.flags.limit),
          offset: parseIntFlag(parsed.flags.offset),
          cwd: parseStringFlag(parsed.flags.cwd),
          type: parseStringFlag(parsed.flags.type),
        });
        const observations = await service.search(input);
        print({ observations }, parsed.flags.json);
        return;
      }

      case "timeline": {
        const input = timelineInputSchema.parse({
          anchor: parseIntFlag(parsed.positionals[0]),
          before: parseIntFlag(parsed.flags.before),
          after: parseIntFlag(parsed.flags.after),
          cwd: parseStringFlag(parsed.flags.cwd),
        });
        const observations = await service.timeline(input.anchor, input);

        print({ observations }, parsed.flags.json);
        return;
      }

      case "get": {
        const input = getObservationsInputSchema.parse({
          ids: parsed.positionals.map((value) => parseInt(value, 10)),
        });
        const observations = await service.getByIds(input.ids);
        print({ observations }, parsed.flags.json);
        return;
      }

      case "save": {
        const input = saveMemoryInputSchema.parse({
          text: parsePositionalText(parsed.positionals),
          title: parseStringFlag(parsed.flags.title),
          cwd: parseStringFlag(parsed.flags.cwd),
        });
        const id = await service.saveMemory(input);

        print({ status: "saved", id }, parsed.flags.json);
        return;
      }

      case "context": {
        const input = contextInputSchema.parse({
          query: parseStringFlag(parsed.flags.query),
          limit: parseIntFlag(parsed.flags.limit),
          cwd: parseStringFlag(parsed.flags.cwd),
          type: parseStringFlag(parsed.flags.type),
        });
        const context = await service.context(input);
        process.stdout.write(`${context}\n`);
        return;
      }

      case "stats": {
        const input = statsParamsSchema.parse({
          cwd: parseStringFlag(parsed.flags.cwd),
        });
        const stats = await service.stats(input);
        print({ stats }, parsed.flags.json);
        return;
      }

      case "projects": {
        const input = projectListParamsSchema.parse({
          limit: parseIntFlag(parsed.flags.limit),
        });
        const projects = await service.projects(input);
        print({ projects }, parsed.flags.json);
        return;
      }

      case "sessions": {
        const input = sessionListParamsSchema.parse({
          cwd: parseStringFlag(parsed.flags.cwd),
          limit: parseIntFlag(parsed.flags.limit),
        });
        const sessions = await service.sessions(input);
        print({ sessions }, parsed.flags.json);
        return;
      }

      case "build-context": {
        const input = buildContextInputSchema.parse({
          query: parseStringFlag(parsed.flags.query),
          cwd: parseStringFlag(parsed.flags.cwd),
          limit: parseIntFlag(parsed.flags.limit),
          sessionLimit: parseIntFlag(parsed.flags["session-limit"]),
        });
        const contextPack = await service.buildContextPack(input);

        if (parsed.flags.json) {
          print({ contextPack }, true);
        } else {
          process.stdout.write(`${contextPack.markdown}\n`);
        }
        return;
      }

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    service.close();
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args[0] ?? "";
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (!token) continue;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return { command, positionals, flags };
}

function parseIntFlag(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseStringFlag(value: string | boolean | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}

function parsePositionalText(values: string[]): string | undefined {
  const text = values.join(" ").trim();
  return text.length > 0 ? text : undefined;
}

function print(value: unknown, asJson: string | boolean | undefined): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runInitMcp(nameFlag: string | boolean | undefined): void {
  const name = typeof nameFlag === "string" ? nameFlag : "codex-mem";
  const cliPath = fileURLToPath(import.meta.url);

  const result = spawnSync(
    "codex",
    ["mcp", "add", name, "--", process.execPath, cliPath, "mcp-server"],
    {
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`codex mcp add failed with status ${result.status}`);
  }
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${JSON.stringify({ error: { code: "CLI_ERROR", message } }, null, 2)}\n`,
    );
    process.exit(1);
  });
}

export function isDirectCliInvocation(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;

  const modulePath = toRealPath(fileURLToPath(moduleUrl));
  const invokedPath = toRealPath(argvPath);
  if (!modulePath || !invokedPath) return false;

  return modulePath === invokedPath;
}

function toRealPath(path: string): string | null {
  try {
    return realpathSync(resolvePath(path));
  } catch {
    return null;
  }
}
