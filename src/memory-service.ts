import { MemoryRepository } from "./db.js";
import { CodexImporter } from "./importer.js";
import { preferenceNoteV1Schema } from "./contracts.js";
import { buildFtsQuery, createTitle, nowIso, safeJsonParse } from "./utils.js";
import type {
  BuildContextOptions,
  ContextPack,
  ListPreferencesOptions,
  MemoryPaths,
  MemoryStats,
  ObservationRecord,
  ObservationType,
  PreferenceNote,
  PreferenceRecord,
  ProjectListOptions,
  ProjectSummary,
  ResolvePreferencesOptions,
  ResolvedPreference,
  SearchOptions,
  SessionListOptions,
  SessionSummary,
  StatsOptions,
  SyncResult,
  TimelineOptions,
} from "./types.js";

const SCOPE_RANK: Record<PreferenceNote["scope"], number> = {
  user: 4,
  project: 3,
  workspace: 2,
  global: 1,
};

const SECRET_PATTERNS = [
  /api[_-]?key\s*[=:]\s*[A-Za-z0-9._-]{8,}/i,
  /token\s*[=:]\s*[A-Za-z0-9._-]{8,}/i,
  /secret\s*[=:]\s*[A-Za-z0-9._-]{8,}/i,
  /password\s*[=:]\s*\S+/i,
  /authorization\s*:\s*bearer\s+\S+/i,
  /sk-[A-Za-z0-9]{20,}/,
];

interface SaveMemoryInput {
  text: string;
  title?: string | undefined;
  cwd?: string | undefined;
  metadataJson?: string | undefined;
}

type SavePreferenceInput = Omit<PreferenceNote, "created_at"> & {
  created_at?: string | undefined;
  cwd?: string | undefined;
  title?: string | undefined;
};

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

  async saveMemory(input: SaveMemoryInput): Promise<number> {
    const text = input.text.trim();
    if (!text) {
      throw new Error("Text cannot be empty");
    }

    const timestamp = nowIso();
    const id = this.repo.saveManualNote({
      text,
      title: input.title ?? createTitle(text),
      cwd: input.cwd,
      metadataJson: input.metadataJson,
      createdAt: timestamp,
      createdAtEpoch: new Date(timestamp).getTime(),
    });

    return id;
  }

  async savePreference(input: SavePreferenceInput): Promise<number> {
    const createdAt = input.created_at ?? nowIso();
    const payload: PreferenceNote = {
      schema_version: "pref-note.v1",
      key: input.key,
      scope: input.scope,
      trigger: input.trigger,
      preferred: input.preferred,
      avoid: input.avoid,
      example_good: input.example_good,
      example_bad: input.example_bad,
      confidence: input.confidence,
      source: input.source,
      supersedes: [...input.supersedes],
      created_at: createdAt,
    };

    this.assertNoSecretLikeData(payload);

    const text = [
      `Preference: ${payload.key}`,
      `Scope: ${payload.scope}`,
      `Trigger: ${payload.trigger}`,
      `Preferred: ${payload.preferred}`,
      `Avoid: ${payload.avoid}`,
    ].join("\n");

    const metadataJson = JSON.stringify(payload);

    return this.saveMemory({
      text,
      title: input.title ?? `${payload.key} (${payload.scope})`,
      cwd: input.cwd,
      metadataJson,
    });
  }

  async listPreferences(options?: ListPreferencesOptions): Promise<PreferenceRecord[]> {
    await this.ensureFreshSync(false);

    const limit = options?.limit ?? 100;
    const rows = this.repo.search({
      cwd: options?.cwd,
      type: "manual_note",
      limit,
    });

    const all = rows
      .map((row) => toPreferenceRecord(row))
      .filter((row): row is PreferenceRecord => row !== null);

    const filtered = all.filter((row) => {
      if (options?.key && row.key !== options.key) return false;
      if (options?.scope && row.scope !== options.scope) return false;
      return true;
    });

    const supersededBy = buildSupersededMap(filtered);
    const includeSuperseded = options?.includeSuperseded ?? false;
    const activeOnly = includeSuperseded
      ? filtered
      : filtered.filter((row) => !supersededBy.has(row.id));

    return activeOnly
      .sort((a, b) => b.observationCreatedAtEpoch - a.observationCreatedAtEpoch)
      .slice(0, limit);
  }

  async resolvePreferences(options?: ResolvePreferencesOptions): Promise<ResolvedPreference[]> {
    const outputLimit = options?.limit ?? 100;
    const fetchLimit = Math.max(100, outputLimit);
    const candidates = await this.listPreferences({
      cwd: options?.cwd,
      limit: fetchLimit,
      includeSuperseded: true,
    });

    const supersededBy = buildSupersededMap(candidates);
    const active = candidates.filter((row) => !supersededBy.has(row.id));

    const keyFilter = new Set((options?.keys ?? []).map((key) => key.trim()).filter(Boolean));
    const scoped =
      keyFilter.size === 0 ? active : active.filter((row) => keyFilter.has(row.key));

    const groups = new Map<string, PreferenceRecord[]>();
    for (const pref of scoped) {
      const list = groups.get(pref.key) ?? [];
      list.push(pref);
      groups.set(pref.key, list);
    }

    const resolved: ResolvedPreference[] = [];
    for (const [key, entries] of groups.entries()) {
      const ranked = [...entries].sort(comparePreferenceRank);
      const selected = ranked[0];
      if (!selected) continue;

      resolved.push({
        key,
        selected,
        ignored: ranked.slice(1),
      });
    }

    return resolved
      .sort((a, b) => comparePreferenceRank(a.selected, b.selected))
      .slice(0, outputLimit);
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

    const resolvedPreferences = await this.resolvePreferences({
      cwd,
      keys: options?.preferenceKeys,
      limit: options?.preferenceLimit ?? 5,
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
      resolvedPreferences,
    });

    return {
      generatedAt,
      cwd,
      query,
      highlights,
      sessions,
      notes,
      resolvedPreferences,
      markdown,
    };
  }

  private assertNoSecretLikeData(preference: PreferenceNote): void {
    const values = [
      preference.trigger,
      preference.preferred,
      preference.avoid,
      preference.example_good,
      preference.example_bad,
    ];

    for (const value of values) {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(value)) {
          throw new Error("Preference payload appears to include secret-like content");
        }
      }
    }
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

function comparePreferenceRank(a: PreferenceRecord, b: PreferenceRecord): number {
  const scopeDelta = (SCOPE_RANK[b.scope] ?? 0) - (SCOPE_RANK[a.scope] ?? 0);
  if (scopeDelta !== 0) return scopeDelta;

  const confidenceDelta = b.confidence - a.confidence;
  if (confidenceDelta !== 0) return confidenceDelta;

  const createdA = parsePreferenceTime(a.created_at, a.observationCreatedAtEpoch);
  const createdB = parsePreferenceTime(b.created_at, b.observationCreatedAtEpoch);
  if (createdA !== createdB) return createdB - createdA;

  return b.id - a.id;
}

function parsePreferenceTime(raw: string, fallbackEpoch: number): number {
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : fallbackEpoch;
}

function buildSupersededMap(preferences: PreferenceRecord[]): Map<number, string[]> {
  const byId = new Map<number, PreferenceRecord>();
  const byKey = new Map<string, PreferenceRecord[]>();
  for (const pref of preferences) {
    byId.set(pref.id, pref);
    const list = byKey.get(pref.key) ?? [];
    list.push(pref);
    byKey.set(pref.key, list);
  }

  const supersededBy = new Map<number, string[]>();

  for (const pref of preferences) {
    for (const tokenRaw of pref.supersedes) {
      const token = tokenRaw.trim();
      if (!token) continue;

      const id = Number.parseInt(token, 10);
      if (Number.isInteger(id) && byId.has(id)) {
        const current = supersededBy.get(id) ?? [];
        current.push(`${pref.key}#${pref.id}`);
        supersededBy.set(id, current);
        continue;
      }

      const byKeyMatches = byKey.get(token);
      if (byKeyMatches && byKeyMatches.length > 0) {
        for (const match of byKeyMatches) {
          const current = supersededBy.get(match.id) ?? [];
          current.push(`${pref.key}#${pref.id}`);
          supersededBy.set(match.id, current);
        }
      }
    }
  }

  return supersededBy;
}

function toPreferenceRecord(row: ObservationRecord): PreferenceRecord | null {
  if (row.type !== "manual_note") return null;
  const metadata = safeJsonParse<unknown>(row.metadataJson);
  if (!metadata) return null;

  const parsed = preferenceNoteV1Schema.safeParse(metadata);
  if (!parsed.success) return null;

  const payload = parsed.data;
  return {
    ...payload,
    id: row.id,
    cwd: row.cwd,
    title: row.title,
    observationCreatedAt: row.createdAt,
    observationCreatedAtEpoch: row.createdAtEpoch,
  };
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

  if (pack.resolvedPreferences.length > 0) {
    lines.push("");
    lines.push("## Resolved Preferences");
    for (const pref of pack.resolvedPreferences) {
      lines.push(`- ${pref.key}`);
      lines.push(
        `  - selected: ${pref.selected.scope} @ confidence=${pref.selected.confidence.toFixed(2)} (${pref.selected.created_at})`,
      );
      lines.push(`  - preferred: ${shrink(pref.selected.preferred, 140)}`);
      lines.push(`  - avoid: ${shrink(pref.selected.avoid, 140)}`);
      if (pref.ignored.length > 0) {
        lines.push(`  - ignored: ${pref.ignored.length}`);
      }
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
      lines.push(`- ${session.sessionId} (${session.observationCount} obs) ${session.lastAt}`);
      if (session.cwd) lines.push(`  - cwd: ${session.cwd}`);
      if (session.lastTitle) lines.push(`  - last: ${shrink(session.lastTitle, 140)}`);
    }
  }

  return lines.join("\n");
}
