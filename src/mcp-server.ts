import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  buildContextInputSchema,
  getObservationsInputSchema,
  projectListParamsSchema,
  saveMemoryInputSchema,
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
      },
    },
    async ({ query, cwd, limit, sessionLimit }) => {
      try {
        const input = buildContextInputSchema.parse({
          query,
          cwd,
          limit,
          sessionLimit,
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

  process.on("SIGINT", () => {
    void server.close().finally(() => {
      service.close();
      process.exit(0);
    });
  });

  process.on("SIGTERM", () => {
    void server.close().finally(() => {
      service.close();
      process.exit(0);
    });
  });

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
