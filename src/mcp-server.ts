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
import { MemoryService } from "./memory-service.js";
import type { MemoryPaths } from "./types.js";

export async function runMcpServer(paths: MemoryPaths): Promise<void> {
  const service = new MemoryService(paths);

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
      },
    },
    async ({ query, limit, offset, cwd, type }) => {
      try {
        const input = searchInputSchema.parse({
          query,
          limit,
          offset,
          cwd,
          type,
        });
        const observations = await service.search(input);

        const compact = observations.map((row) => ({
          id: row.id,
          type: row.type,
          title: row.title,
          createdAt: row.createdAt,
          cwd: row.cwd,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ observations: compact }, null, 2),
            },
          ],
        };
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
      },
    },
    async ({ anchor, before, after, cwd }) => {
      try {
        const input = timelineInputSchema.parse({ anchor, before, after, cwd });
        const observations = await service.timeline(input.anchor, input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ observations }, null, 2),
            },
          ],
        };
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
        const observations = await service.getByIds(input.ids);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ observations }, null, 2),
            },
          ],
        };
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
        const id = await service.saveMemory(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "saved", id }, null, 2),
            },
          ],
        };
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
    async ({
      schema_version,
      key,
      scope,
      trigger,
      preferred,
      avoid,
      example_good,
      example_bad,
      confidence,
      source,
      supersedes,
      created_at,
      cwd,
      title,
    }) => {
      try {
        const input = savePreferenceInputSchema.parse({
          schema_version,
          key,
          scope,
          trigger,
          preferred,
          avoid,
          example_good,
          example_bad,
          confidence,
          source,
          supersedes,
          created_at,
          cwd,
          title,
        });
        const id = await service.savePreference(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "saved", id }, null, 2),
            },
          ],
        };
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
      },
    },
    async ({ cwd, key, scope, limit, include_superseded }) => {
      try {
        const input = listPreferencesInputSchema.parse({
          cwd,
          key,
          scope,
          limit,
          include_superseded,
        });
        const preferences = await service.listPreferences({
          cwd: input.cwd,
          key: input.key,
          scope: input.scope,
          limit: input.limit,
          includeSuperseded: input.include_superseded,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ preferences }, null, 2),
            },
          ],
        };
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
      },
    },
    async ({ cwd, keys, limit }) => {
      try {
        const input = resolvePreferencesInputSchema.parse({ cwd, keys, limit });
        const resolved = await service.resolvePreferences({
          cwd: input.cwd,
          keys: input.keys,
          limit: input.limit,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ resolved }, null, 2),
            },
          ],
        };
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
      },
    },
    async ({ cwd }) => {
      try {
        const input = statsParamsSchema.parse({ cwd });
        const stats = await service.stats(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ stats }, null, 2),
            },
          ],
        };
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
        const projects = await service.projects(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ projects }, null, 2),
            },
          ],
        };
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
      },
    },
    async ({ cwd, limit }) => {
      try {
        const input = sessionListParamsSchema.parse({ cwd, limit });
        const sessions = await service.sessions(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ sessions }, null, 2),
            },
          ],
        };
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
      },
    },
    async ({ query, cwd, limit, sessionLimit, preferenceKeys, preferenceLimit }) => {
      try {
        const input = buildContextInputSchema.parse({
          query,
          cwd,
          limit,
          sessionLimit,
          preferenceKeys,
          preferenceLimit,
        });
        const contextPack = await service.buildContextPack(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ contextPack }, null, 2),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  const transport = new StdioServerTransport();

  let shuttingDown = false;

  function gracefulShutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    void server.close().finally(() => {
      service.close();
      process.exit(0);
    });
  }

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  // StdioServerTransport does not listen for stdin 'end'. When the parent
  // process closes the pipe (session ends), the server would stay alive
  // forever. Treat stdin closure as a shutdown signal.
  process.stdin.on("end", gracefulShutdown);

  await server.connect(transport);
}

function toolError(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code: "TOOL_ERROR", message } }) }],
  };
}
