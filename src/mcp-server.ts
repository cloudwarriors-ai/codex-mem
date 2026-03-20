import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  buildContextInputSchema,
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
import { DaemonClientError, invokeDaemonMethod } from "./daemon-client.js";
import type { MemoryPaths } from "./types.js";

export async function runMcpServer(paths: MemoryPaths): Promise<void> {
  const server = new McpServer({
    name: "codex-mem",
    version: "0.1.0",
  });

  server.registerTool(
    "search",
    {
      description:
        "Step 1: Search memory index. Returns compact rows with IDs. Params: query, limit, offset, cwd, type",
      inputSchema: {
        query: searchInputSchema.shape.query,
        limit: searchInputSchema.shape.limit,
        offset: searchInputSchema.shape.offset,
        cwd: searchInputSchema.shape.cwd,
        type: searchInputSchema.shape.type,
        scopeMode: searchInputSchema.shape.scopeMode,
      },
    },
    async ({ query, limit, offset, cwd, type, scopeMode }) => {
      try {
        const input = searchInputSchema.parse({
          query,
          limit,
          offset,
          cwd,
          type,
          scopeMode: scopeMode ?? "exact_workspace",
        });
        const result = await invokeDaemonMethod<{ observations: Array<Record<string, unknown>> }>(paths, "search", input);
        const compact = result.observations.map((row) => ({
          id: row.id,
          type: row.type,
          title: row.title,
          createdAt: row.createdAt,
          cwd: row.cwd,
        }));
        return ok({ observations: compact });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "timeline",
    {
      description:
        "Step 2: Get chronological context around one observation. Params: anchor, before, after, cwd",
      inputSchema: {
        anchor: timelineInputSchema.shape.anchor,
        before: timelineInputSchema.shape.before,
        after: timelineInputSchema.shape.after,
        cwd: timelineInputSchema.shape.cwd,
        scopeMode: timelineInputSchema.shape.scopeMode,
      },
    },
    async ({ anchor, before, after, cwd, scopeMode }) => {
      try {
        const input = timelineInputSchema.parse({
          anchor,
          before,
          after,
          cwd,
          scopeMode: scopeMode ?? "exact_workspace",
        });
        return ok(await invokeDaemonMethod(paths, "timeline", input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_observations",
    {
      description:
        "Step 3: Fetch full details for filtered IDs. Params: ids (array of observation IDs)",
      inputSchema: {
        ids: getObservationsInputSchema.shape.ids,
      },
    },
    async ({ ids }) => {
      try {
        const input = getObservationsInputSchema.parse({ ids });
        return ok(await invokeDaemonMethod(paths, "get_observations", input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "save_memory",
    {
      description: "Save an important memory note. Params: text, title, cwd",
      inputSchema: {
        text: saveMemoryInputSchema.shape.text,
        title: saveMemoryInputSchema.shape.title,
        cwd: saveMemoryInputSchema.shape.cwd,
      },
    },
    async ({ text, title, cwd }) => {
      try {
        const input = saveMemoryInputSchema.parse({ text, title, cwd });
        return ok(await invokeDaemonMethod(paths, "save_memory", input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "save_preference",
    {
      description:
        "Save a structured preference note (pref-note.v1). Params: key, scope, trigger, preferred, avoid, example_good, example_bad, confidence, source, supersedes, created_at, cwd, title",
      inputSchema: {
        schema_version: savePreferenceInputSchema.shape.schema_version,
        key: savePreferenceInputSchema.shape.key,
        scope: savePreferenceInputSchema.shape.scope,
        trigger: savePreferenceInputSchema.shape.trigger,
        preferred: savePreferenceInputSchema.shape.preferred,
        avoid: savePreferenceInputSchema.shape.avoid,
        example_good: savePreferenceInputSchema.shape.example_good,
        example_bad: savePreferenceInputSchema.shape.example_bad,
        confidence: savePreferenceInputSchema.shape.confidence,
        source: savePreferenceInputSchema.shape.source,
        supersedes: savePreferenceInputSchema.shape.supersedes,
        created_at: savePreferenceInputSchema.shape.created_at,
        cwd: savePreferenceInputSchema.shape.cwd,
        title: savePreferenceInputSchema.shape.title,
      },
    },
    async (input) => {
      try {
        return ok(await invokeDaemonMethod(paths, "save_preference", savePreferenceInputSchema.parse(input)));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_preferences",
    {
      description:
        "List stored pref-note.v1 entries. Params: cwd, key, scope, limit, include_superseded",
      inputSchema: {
        cwd: listPreferencesInputSchema.shape.cwd,
        key: listPreferencesInputSchema.shape.key,
        scope: listPreferencesInputSchema.shape.scope,
        limit: listPreferencesInputSchema.shape.limit,
        include_superseded: listPreferencesInputSchema.shape.include_superseded,
        scopeMode: listPreferencesInputSchema.shape.scopeMode,
      },
    },
    async ({ cwd, key, scope, limit, include_superseded, scopeMode }) => {
      try {
        const input = listPreferencesInputSchema.parse({
          cwd,
          key,
          scope,
          limit,
          include_superseded,
          scopeMode: scopeMode ?? "exact_workspace",
        });
        return ok(await invokeDaemonMethod(paths, "list_preferences", input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "resolve_preferences",
    {
      description:
        "Resolve active preferences by deterministic precedence. Params: cwd, keys, limit",
      inputSchema: {
        cwd: resolvePreferencesInputSchema.shape.cwd,
        keys: resolvePreferencesInputSchema.shape.keys,
        limit: resolvePreferencesInputSchema.shape.limit,
        scopeMode: resolvePreferencesInputSchema.shape.scopeMode,
      },
    },
    async ({ cwd, keys, limit, scopeMode }) => {
      try {
        const input = resolvePreferencesInputSchema.parse({
          cwd,
          keys,
          limit,
          scopeMode: scopeMode ?? "exact_workspace",
        });
        return ok(await invokeDaemonMethod(paths, "resolve_preferences", input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "stats",
    {
      description: "Get memory counts and coverage stats. Params: cwd",
      inputSchema: {
        cwd: statsParamsSchema.shape.cwd,
        scopeMode: statsParamsSchema.shape.scopeMode,
      },
    },
    async ({ cwd, scopeMode }) => {
      try {
        const input = statsParamsSchema.parse({ cwd, scopeMode: scopeMode ?? "exact_workspace" });
        return ok(await invokeDaemonMethod(paths, "stats", input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_projects",
    {
      description: "List active project directories with observation counts. Params: limit",
      inputSchema: {
        limit: projectListParamsSchema.shape.limit,
      },
    },
    async ({ limit }) => {
      try {
        const input = projectListParamsSchema.parse({ limit });
        return ok(await invokeDaemonMethod(paths, "projects", input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "recent_sessions",
    {
      description: "List recent sessions and scope metadata. Params: cwd, limit",
      inputSchema: {
        cwd: sessionListParamsSchema.shape.cwd,
        limit: sessionListParamsSchema.shape.limit,
        scopeMode: sessionListParamsSchema.shape.scopeMode,
      },
    },
    async ({ cwd, limit, scopeMode }) => {
      try {
        const input = sessionListParamsSchema.parse({
          cwd,
          limit,
          scopeMode: scopeMode ?? "exact_workspace",
        });
        return ok(await invokeDaemonMethod(paths, "sessions", input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "build_context",
    {
      description:
        "Build a context pack for prompt injection with highlights, durable notes, and recent sessions. Params: query, cwd, limit, sessionLimit",
      inputSchema: {
        query: buildContextInputSchema.shape.query,
        cwd: buildContextInputSchema.shape.cwd,
        limit: buildContextInputSchema.shape.limit,
        sessionLimit: buildContextInputSchema.shape.sessionLimit,
        preferenceKeys: buildContextInputSchema.shape.preferenceKeys,
        preferenceLimit: buildContextInputSchema.shape.preferenceLimit,
        scopeMode: buildContextInputSchema.shape.scopeMode,
      },
    },
    async ({ query, cwd, limit, sessionLimit, preferenceKeys, preferenceLimit, scopeMode }) => {
      try {
        const input = buildContextInputSchema.parse({
          query,
          cwd,
          limit,
          sessionLimit,
          preferenceKeys,
          preferenceLimit,
          scopeMode: scopeMode ?? "exact_workspace",
        });
        return ok(await invokeDaemonMethod(paths, "build_context", input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  const transport = new StdioServerTransport();
  transport.onclose = gracefulShutdown;
  transport.onerror = () => {
    gracefulShutdown();
  };

  let shuttingDown = false;
  let forcedExitTimer: NodeJS.Timeout | null = null;

  function gracefulShutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    forcedExitTimer = setTimeout(() => {
      process.exit(0);
    }, 250);
    forcedExitTimer.unref?.();

    void server
      .close()
      .catch(() => {
        // Fall through to forced exit.
      })
      .finally(() => {
        if (forcedExitTimer) {
          clearTimeout(forcedExitTimer);
          forcedExitTimer = null;
        }
        process.exit(0);
      });
  }

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
  process.stdin.resume();
  process.stdin.on("end", gracefulShutdown);
  process.stdin.on("close", gracefulShutdown);

  await server.connect(transport);
}

function ok(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function toolError(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  if (error instanceof DaemonClientError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
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
          ),
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code: "TOOL_ERROR", message } }) }],
  };
}
