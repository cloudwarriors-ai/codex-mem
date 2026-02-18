import { MemoryRepository } from "./db.js";
import { CodexImporter } from "./importer.js";
import { buildFtsQuery, createTitle, nowIso } from "./utils.js";
import type {
  BuildContextOptions,
  ContextPack,
  MemoryPaths,
  MemoryStats,
  ObservationRecord,
  ObservationType,
  ProjectListOptions,
  ProjectSummary,
  SearchOptions,
  SessionListOptions,
  SessionSummary,
  StatsOptions,
  SyncResult,
  TimelineOptions,
} from "./types.js";

export class MemoryService {
  private readonly repo: MemoryRepository;
  private readonly importer: CodexImporter;
  private lastSyncAtEpoch = 0;
  private inFlightSync: Promise<SyncResult> | null = null;
  private readonly syncCooldownMs = 2_000;

  constructor(private readonly paths: MemoryPaths) {
    this.repo = new MemoryRepository(paths.dbPath);
    this.importer = new CodexImporter(this.repo, paths.codexHome);
  }

  close(): void {
    this.repo.close();
  }

  async sync(): Promise<SyncResult> {
    return this.ensureFreshSync(true);
  }

  async search(options: SearchOptions): Promise<ObservationRecord[]> {
    await this.ensureFreshSync(false);

    const preparedQuery = options.query ? buildFtsQuery(options.query) : undefined;

    return this.repo.search({
      ...options,
      query: preparedQuery,
    });
  }

  async timeline(anchorId: number, options: TimelineOptions): Promise<ObservationRecord[]> {
    await this.ensureFreshSync(false);
    return this.repo.getTimeline(anchorId, options);
  }

  async getByIds(ids: number[]): Promise<ObservationRecord[]> {
    await this.ensureFreshSync(false);
    return this.repo.getByIds(ids);
  }

  async stats(options?: StatsOptions): Promise<MemoryStats> {
    await this.ensureFreshSync(false);
    return this.repo.getStats(options);
  }

  async projects(options?: ProjectListOptions): Promise<ProjectSummary[]> {
    await this.ensureFreshSync(false);
    return this.repo.listProjects(options);
  }

  async sessions(options?: SessionListOptions): Promise<SessionSummary[]> {
    await this.ensureFreshSync(false);
    return this.repo.listSessions(options);
  }

  async saveMemory(input: {
    text: string;
    title?: string | undefined;
    cwd?: string | undefined;
  }): Promise<number> {
    const text = input.text.trim();
    if (!text) {
      throw new Error("Text cannot be empty");
    }

    const timestamp = nowIso();
    const id = this.repo.saveManualNote({
      text,
      title: input.title ?? createTitle(text),
      cwd: input.cwd,
      createdAt: timestamp,
      createdAtEpoch: new Date(timestamp).getTime(),
    });

    return id;
  }

  async context(input: {
    cwd?: string | undefined;
    query?: string | undefined;
    limit?: number | undefined;
    type?: ObservationType | undefined;
  }): Promise<string> {
    const pack = await this.buildContextPack({
      cwd: input.cwd,
      query: input.query,
      limit: input.limit,
    });

    if (input.type) {
      const filtered = pack.highlights.filter((row) => row.type === input.type);
      if (filtered.length === 0) return "# codex-mem context\n\nNo relevant memory found.";
      return toMarkdown({
        ...pack,
        highlights: filtered,
      });
    }

    return pack.markdown;
  }

  async buildContextPack(options?: BuildContextOptions): Promise<ContextPack> {
    const cwd = options?.cwd;
    const query = options?.query;
    const limit = options?.limit ?? 8;
    const sessionLimit = options?.sessionLimit ?? 5;

    const highlights = await this.search({
      cwd,
      query,
      limit,
    });

    const notes = await this.search({
      cwd,
      type: "manual_note",
      limit: 5,
    });

    const sessions = await this.sessions({
      cwd,
      limit: sessionLimit,
    });

    const generatedAt = nowIso();
    const markdown = toMarkdown({
      generatedAt,
      cwd,
      query,
      highlights,
      sessions,
      notes,
    });

    return {
      generatedAt,
      cwd,
      query,
      highlights,
      sessions,
      notes,
      markdown,
    };
  }

  private async ensureFreshSync(force: boolean): Promise<SyncResult> {
    const now = Date.now();

    if (!force && now - this.lastSyncAtEpoch < this.syncCooldownMs) {
      return { status: "ok", filesScanned: 0, observationsInserted: 0 };
    }

    if (this.inFlightSync) {
      return this.inFlightSync;
    }

    this.inFlightSync = this.importer.syncAll();

    try {
      const result = await this.inFlightSync;
      this.lastSyncAtEpoch = Date.now();
      return result;
    } finally {
      this.inFlightSync = null;
    }
  }
}

function shrink(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function toMarkdown(pack: Omit<ContextPack, "markdown">): string {
  const lines: string[] = ["# codex-mem context", ""];

  if (pack.cwd) lines.push(`- scope.cwd: ${pack.cwd}`);
  if (pack.query) lines.push(`- scope.query: ${pack.query}`);
  lines.push(`- generated_at: ${pack.generatedAt}`);
  lines.push("");

  if (pack.highlights.length === 0) {
    lines.push("No relevant memory found.");
  } else {
    lines.push("## Highlights");
    for (const row of pack.highlights) {
      lines.push(`- [${row.id}] (${row.type}) ${shrink(row.text, 220)}`);
      lines.push(`  - time: ${row.createdAt}`);
      if (row.cwd) lines.push(`  - cwd: ${row.cwd}`);
    }
  }

  if (pack.notes.length > 0) {
    lines.push("");
    lines.push("## Durable Notes");
    for (const note of pack.notes) {
      lines.push(`- [${note.id}] ${shrink(note.text, 180)}`);
    }
  }

  if (pack.sessions.length > 0) {
    lines.push("");
    lines.push("## Recent Sessions");
    for (const session of pack.sessions) {
      lines.push(
        `- ${session.sessionId} (${session.observationCount} obs) ${session.lastAt}`,
      );
      if (session.cwd) lines.push(`  - cwd: ${session.cwd}`);
      if (session.lastTitle) lines.push(`  - last: ${shrink(session.lastTitle, 140)}`);
    }
  }

  return lines.join("\n");
}
