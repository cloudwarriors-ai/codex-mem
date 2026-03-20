#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { isSharedDefaultDataDir, resolvePaths } from "./config.js";
import {
  buildContextInputSchema,
  contextInputSchema,
  getObservationsInputSchema,
  listPreferencesInputSchema,
  projectListParamsSchema,
  resolvePreferencesInputSchema,
  saveMemoryInputSchema,
  savePreferenceInputSchema,
  searchInputSchema,
  sessionListParamsSchema,
  statsParamsSchema,
  timelineInputSchema,
} from "./contracts.js";
import {
  bootstrapRuntime,
  createSnapshot,
  DatabaseHealthError,
  getStatusReport,
  rebuildQueryLayer,
  recoverDatabase,
  repairDatabase,
  runServiceProbeCommand,
} from "./db-lifecycle.js";
import { DaemonClientError, ensureDaemon, invokeDaemonMethod, readDaemonHealth } from "./daemon-client.js";
import { startCodexMemDaemon } from "./daemon-server.js";
import { runMcpServer } from "./mcp-server.js";
import { startDashboardServer } from "./dashboard-server.js";
import { runWorker } from "./worker.js";
import type { RuntimeSurface, ServiceProbeName } from "./types.js";

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const HELP_TEXT = `codex-mem

Usage:
  codex-mem sync [--json]
  codex-mem search <query> [--limit N] [--offset N] [--cwd PATH] [--type TYPE] [--json]
  codex-mem timeline <anchorId> [--before N] [--after N] [--cwd PATH] [--scope-mode MODE] [--json]
  codex-mem get <id...> [--json]
  codex-mem save <text> [--title TITLE] [--cwd PATH] [--json]
  codex-mem save-preference --key KEY --scope SCOPE --trigger TEXT --preferred TEXT --avoid TEXT --example-good TEXT --example-bad TEXT --confidence N --source SOURCE [--supersedes CSV] [--created-at ISO] [--title TITLE] [--cwd PATH] [--json]
  codex-mem list-preferences [--cwd PATH] [--key KEY] [--scope SCOPE] [--limit N] [--include-superseded] [--json]
  codex-mem resolve-preferences [--cwd PATH] [--keys CSV] [--limit N] [--json]
  codex-mem context [--query TEXT] [--limit N] [--cwd PATH] [--scope-mode MODE]
  codex-mem stats [--cwd PATH] [--scope-mode MODE] [--json]
  codex-mem projects [--limit N] [--json]
  codex-mem sessions [--cwd PATH] [--limit N] [--scope-mode MODE] [--json]
  codex-mem build-context [--query TEXT] [--cwd PATH] [--limit N] [--session-limit N] [--preference-keys CSV] [--preference-limit N] [--scope-mode MODE] [--json]
  codex-mem worker [--interval-seconds N] [--run-once] [--json]
  codex-mem doctor [--json]
  codex-mem status [--json]
  codex-mem daemon [--host HOST] [--port PORT] [--json]
  codex-mem ensure-daemon [--json]
  codex-mem daemon-status [--json]
  codex-mem snapshot-now [--json]
  codex-mem repair-db [--mode MODE] [--json]
  codex-mem rebuild-query-layer [--json]
  codex-mem recover [--mode MODE] [--json]
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
  const useDaemon = shouldUseDaemonForCommand(command, paths);

  if (command === "mcp-server") {
    await runMcpServer(paths);
    return;
  }

  if (command === "daemon") {
    const host = parseStringFlag(parsed.flags.host);
    const port = parseIntFlag(parsed.flags.port);
    const daemon = await startCodexMemDaemon(paths, { host, port });
    if (parsed.flags.json) {
      print({ status: "running", daemon: daemon.metadata }, true);
    } else {
      process.stdout.write(`codex-mem daemon running at http://${daemon.metadata.host}:${daemon.metadata.port}\n`);
    }
    await new Promise<void>(() => {
      // Hold the daemon process open until signaled.
    });
    return;
  }

  if (command === "ensure-daemon") {
    print({ daemon: await ensureDaemon(paths) }, parsed.flags.json);
    return;
  }

  if (command === "daemon-status") {
    print({ daemon: await readDaemonHealth(paths) }, true);
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

  if (command === "doctor" || command === "status") {
    print({ health: await getStatusReport(paths), daemon: await readDaemonHealth(paths) }, parsed.flags.json);
    return;
  }

  if (command === "snapshot-now") {
    const snapshot = await createSnapshot(paths, "cli-snapshot");
    print({ status: "snapshotted", snapshot }, parsed.flags.json);
    return;
  }

  if (command === "repair-db") {
    const mode = (parseStringFlag(parsed.flags.mode) ?? "db") as "db" | "service-path" | "auto";
    const report =
      mode === "service-path"
        ? await rebuildQueryLayer(paths)
        : mode === "auto"
          ? (await recoverDatabase(paths, "auto")).report
          : repairDatabase(paths);
    print({ report }, parsed.flags.json);
    if (report.status !== "repaired") {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "rebuild-query-layer") {
    const report = await rebuildQueryLayer(paths);
    print({ report }, parsed.flags.json);
    if (report.status !== "repaired") {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "recover") {
    const mode = (parseStringFlag(parsed.flags.mode) ?? "auto") as "db" | "service-path" | "auto";
    const recovery = await recoverDatabase(paths, mode);
    print({ recovery }, parsed.flags.json);
    if (recovery.report.status !== "repaired") {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "service-probe") {
    const probe = parseStringFlag(parsed.flags.probe) as ServiceProbeName | null;
    const surface = (parseStringFlag(parsed.flags.surface) ?? "cli") as RuntimeSurface;
    if (!probe) {
      throw new Error("service-probe requires --probe");
    }
    const probeResult = await runServiceProbeCommand(paths, probe, surface);
    print({ probe: probeResult }, true);
    if (probeResult.status !== "ok") {
      process.exitCode = 2;
    }
    return;
  }

  if (useDaemon) {
    const result = await runDaemonCommand(command, parsed, paths);
    emitDaemonCommandResult(command, result, parsed.flags.json);
    return;
  }

  const runtime = await bootstrapRuntime(paths, "cli", {
    skipServicePathPreflight: Boolean(process.env.CODEX_MEM_SKIP_SERVICE_PATH_PREFLIGHT),
  });
  if (!runtime.service) {
    throw new Error("CLI cannot run without a healthy database");
  }
  const service = runtime.service;

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
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          type: parseStringFlag(parsed.flags.type),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
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
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
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
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
        });
        const id = await service.saveMemory(input);

        print({ status: "saved", id }, parsed.flags.json);
        return;
      }

      case "save-preference": {
        const input = savePreferenceInputSchema.parse({
          schema_version: "pref-note.v1",
          key: parseStringFlag(parsed.flags.key),
          scope: parseStringFlag(parsed.flags.scope),
          trigger: parseStringFlag(parsed.flags.trigger),
          preferred: parseStringFlag(parsed.flags.preferred),
          avoid: parseStringFlag(parsed.flags.avoid),
          example_good: parseStringFlag(parsed.flags["example-good"]),
          example_bad: parseStringFlag(parsed.flags["example-bad"]),
          confidence: parseFloatFlag(parsed.flags.confidence),
          source: parseStringFlag(parsed.flags.source),
          supersedes: parseCsvFlag(parsed.flags.supersedes) ?? [],
          created_at: parseStringFlag(parsed.flags["created-at"]),
          cwd: parseStringFlag(parsed.flags.cwd),
          title: parseStringFlag(parsed.flags.title),
        });
        const id = await service.savePreference(input);
        print({ status: "saved", id }, parsed.flags.json);
        return;
      }

      case "list-preferences": {
        const input = listPreferencesInputSchema.parse({
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          key: parseStringFlag(parsed.flags.key),
          scope: parseStringFlag(parsed.flags.scope),
          limit: parseIntFlag(parsed.flags.limit),
          include_superseded: parseBooleanFlag(parsed.flags["include-superseded"]),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
        });
        const preferences = await service.listPreferences({
          cwd: input.cwd,
          key: input.key,
          scope: input.scope,
          limit: input.limit,
          includeSuperseded: input.include_superseded,
          scopeMode: input.scopeMode,
        });
        print({ preferences }, parsed.flags.json);
        return;
      }

      case "resolve-preferences": {
        const input = resolvePreferencesInputSchema.parse({
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          keys: parseCsvFlag(parsed.flags.keys),
          limit: parseIntFlag(parsed.flags.limit),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
        });
        const resolved = await service.resolvePreferences({
          cwd: input.cwd,
          keys: input.keys,
          limit: input.limit,
          scopeMode: input.scopeMode,
        });
        print({ resolved }, parsed.flags.json);
        return;
      }

      case "context": {
        const input = contextInputSchema.parse({
          query: parseStringFlag(parsed.flags.query),
          limit: parseIntFlag(parsed.flags.limit),
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          type: parseStringFlag(parsed.flags.type),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
        });
        const context = await service.context(input);
        process.stdout.write(`${context}\n`);
        return;
      }

      case "stats": {
        const input = statsParamsSchema.parse({
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
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
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          limit: parseIntFlag(parsed.flags.limit),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]),
        });
        const sessions = await service.sessions(input);
        print({ sessions }, parsed.flags.json);
        return;
      }

      case "build-context": {
        const input = buildContextInputSchema.parse({
          query: parseStringFlag(parsed.flags.query),
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          limit: parseIntFlag(parsed.flags.limit),
          sessionLimit: parseIntFlag(parsed.flags["session-limit"]),
          preferenceKeys: parseCsvFlag(parsed.flags["preference-keys"]),
          preferenceLimit: parseIntFlag(parsed.flags["preference-limit"]),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]),
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

function shouldUseDaemonForCommand(command: string, paths: { dataDir: string }): boolean {
  if (!isSharedDefaultDataDir(paths.dataDir)) return false;
  return [
    "sync",
    "search",
    "timeline",
    "get",
    "save",
    "save-preference",
    "list-preferences",
    "resolve-preferences",
    "context",
    "stats",
    "projects",
    "sessions",
    "build-context",
  ].includes(command);
}

async function runDaemonCommand(
  command: string,
  parsed: ParsedArgs,
  paths: ReturnType<typeof resolvePaths>,
): Promise<unknown> {
  switch (command) {
    case "sync":
      return invokeDaemonMethod(paths, "sync", {});
    case "search":
      return invokeDaemonMethod(
        paths,
        "search",
        searchInputSchema.parse({
          query: parsePositionalText(parsed.positionals),
          limit: parseIntFlag(parsed.flags.limit),
          offset: parseIntFlag(parsed.flags.offset),
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          type: parseStringFlag(parsed.flags.type),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
        }),
      );
    case "timeline":
      return invokeDaemonMethod(
        paths,
        "timeline",
        timelineInputSchema.parse({
          anchor: parseIntFlag(parsed.positionals[0]),
          before: parseIntFlag(parsed.flags.before),
          after: parseIntFlag(parsed.flags.after),
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
        }),
      );
    case "get":
      return invokeDaemonMethod(
        paths,
        "get_observations",
        getObservationsInputSchema.parse({
          ids: parsed.positionals.map((value) => parseInt(value, 10)),
        }),
      );
    case "save":
      return invokeDaemonMethod(
        paths,
        "save_memory",
        saveMemoryInputSchema.parse({
          text: parsePositionalText(parsed.positionals),
          title: parseStringFlag(parsed.flags.title),
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
        }),
      );
    case "save-preference":
      return invokeDaemonMethod(
        paths,
        "save_preference",
        savePreferenceInputSchema.parse({
          schema_version: "pref-note.v1",
          key: parseStringFlag(parsed.flags.key),
          scope: parseStringFlag(parsed.flags.scope),
          trigger: parseStringFlag(parsed.flags.trigger),
          preferred: parseStringFlag(parsed.flags.preferred),
          avoid: parseStringFlag(parsed.flags.avoid),
          example_good: parseStringFlag(parsed.flags["example-good"]),
          example_bad: parseStringFlag(parsed.flags["example-bad"]),
          confidence: parseFloatFlag(parsed.flags.confidence),
          source: parseStringFlag(parsed.flags.source),
          supersedes: parseCsvFlag(parsed.flags.supersedes) ?? [],
          created_at: parseStringFlag(parsed.flags["created-at"]),
          cwd: parseStringFlag(parsed.flags.cwd),
          title: parseStringFlag(parsed.flags.title),
        }),
      );
    case "list-preferences":
      return invokeDaemonMethod(
        paths,
        "list_preferences",
        listPreferencesInputSchema.parse({
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          key: parseStringFlag(parsed.flags.key),
          scope: parseStringFlag(parsed.flags.scope),
          limit: parseIntFlag(parsed.flags.limit),
          include_superseded: parseBooleanFlag(parsed.flags["include-superseded"]),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
        }),
      );
    case "resolve-preferences":
      return invokeDaemonMethod(
        paths,
        "resolve_preferences",
        resolvePreferencesInputSchema.parse({
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          keys: parseCsvFlag(parsed.flags.keys),
          limit: parseIntFlag(parsed.flags.limit),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
        }),
      );
    case "context":
      return invokeDaemonMethod(
        paths,
        "context",
        contextInputSchema.parse({
          query: parseStringFlag(parsed.flags.query),
          limit: parseIntFlag(parsed.flags.limit),
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          type: parseStringFlag(parsed.flags.type),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
        }),
      );
    case "stats":
      return invokeDaemonMethod(
        paths,
        "stats",
        statsParamsSchema.parse({
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]) ?? "exact_workspace",
        }),
      );
    case "projects":
      return invokeDaemonMethod(
        paths,
        "projects",
        projectListParamsSchema.parse({
          limit: parseIntFlag(parsed.flags.limit),
        }),
      );
    case "sessions":
      return invokeDaemonMethod(
        paths,
        "sessions",
        sessionListParamsSchema.parse({
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          limit: parseIntFlag(parsed.flags.limit),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]),
        }),
      );
    case "build-context":
      return invokeDaemonMethod(
        paths,
        "build_context",
        buildContextInputSchema.parse({
          query: parseStringFlag(parsed.flags.query),
          cwd: parseStringFlag(parsed.flags.cwd) ?? process.cwd(),
          limit: parseIntFlag(parsed.flags.limit),
          sessionLimit: parseIntFlag(parsed.flags["session-limit"]),
          preferenceKeys: parseCsvFlag(parsed.flags["preference-keys"]),
          preferenceLimit: parseIntFlag(parsed.flags["preference-limit"]),
          scopeMode: parseStringFlag(parsed.flags["scope-mode"]),
        }),
      );
    default:
      throw new Error(`Unknown daemon-routed command: ${command}`);
  }
}

function emitDaemonCommandResult(
  command: string,
  result: any,
  asJson: string | boolean | undefined,
): void {
  if (command === "context" && !asJson) {
    process.stdout.write(`${result.context}\n`);
    return;
  }
  if (command === "build-context" && !asJson) {
    process.stdout.write(`${result.contextPack.markdown}\n`);
    return;
  }
  print(result, asJson);
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

function parseFloatFlag(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseStringFlag(value: string | boolean | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}

function parseBooleanFlag(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return undefined;
}

function parseCsvFlag(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const list = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
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
    if (error instanceof DaemonClientError) {
      process.stderr.write(
        `${JSON.stringify(
          {
            error: {
              code: error.code,
              message: error.message,
              status: error.status,
              details: error.payload,
            },
          },
          null,
          2,
        )}\n`,
      );
      process.exit(error.status >= 500 ? 2 : 1);
      return;
    }
    if (error instanceof DatabaseHealthError) {
      process.stderr.write(
        `${JSON.stringify({ error: { code: "DB_HEALTH_ERROR", message: error.message }, health: error.report }, null, 2)}\n`,
      );
      process.exit(2);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ error: { code: "CLI_ERROR", message } }, null, 2)}\n`);
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
