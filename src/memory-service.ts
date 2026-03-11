import { MemoryRepository } from "./db.js";
import { CodexImporter } from "./importer.js";
import { preferenceNoteV1Schema } from "./contracts.js";
import {
  defaultScopePolicyForVisibility,
  defaultSensitivityForIdentity,
  defaultVisibilityForMemory,
  defaultVisibilityForPreference,
  inferProcessWorkspaceIdentity,
  ScopeIsolationError,
  type WorkspaceIdentity,
  allowsResultForScope,
  resolveWorkspaceIdentity,
} from "./workspace-identity.js";
import {
  buildRetrievalSummary,
  classifyManualNoteForPromotion,
  evaluateBenchmarkCase,
  rankObservations,
} from "./memory-intelligence.js";
import { buildFtsQuery, createTitle, nowIso, safeJsonParse } from "./utils.js";
import type {
  BuildContextOptions,
  ContextPack,
  DurableMemoryRecord,
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
  RetrievalBenchmarkCase,
  RetrievalBenchmarkResult,
  RetrievalSummary,
  ScopeMode,
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

interface ScopedSearchResult {
  observations: ObservationRecord[];
  retrievalSummary: RetrievalSummary;
  workspace: WorkspaceIdentity | null;
}

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
    const scoped = this.runScopedSearch(options);
    return scoped.observations;
  }

  async timeline(anchorId: number, options: TimelineOptions): Promise<ObservationRecord[]> {
    await this.ensureFreshSync(false);
    const scopeMode = options.scopeMode ?? "global";
    const scopedCwd =
      options.cwd ??
      (scopeMode === "exact_workspace" ? this.repo.getByIds([anchorId])[0]?.cwd ?? undefined : undefined);
    const workspace = this.resolveWorkspaceRequirement(scopedCwd, scopeMode);
    const rows = this.repo.getTimeline(anchorId, {
      ...options,
      cwd: workspace?.cwd,
      scopeMode,
    });
    return this.filterIsolationOnly(rows, {
      scopeMode,
      workspace,
    });
  }

  async getByIds(ids: number[]): Promise<ObservationRecord[]> {
    await this.ensureFreshSync(false);
    return this.repo.getByIds(ids);
  }

  async stats(options?: StatsOptions): Promise<MemoryStats> {
    await this.ensureFreshSync(false);
    const workspace = this.resolveWorkspaceRequirement(options?.cwd, options?.scopeMode ?? "global");
    return this.repo.getStats({
      ...options,
      cwd: workspace?.cwd,
      workspaceId: workspace?.workspaceId,
    });
  }

  async projects(options?: ProjectListOptions): Promise<ProjectSummary[]> {
    await this.ensureFreshSync(false);
    return this.repo.listProjects(options);
  }

  async sessions(options?: SessionListOptions): Promise<SessionSummary[]> {
    await this.ensureFreshSync(false);
    const workspace = this.resolveWorkspaceRequirement(options?.cwd, options?.scopeMode ?? "global");
    return this.repo.listSessions({
      ...options,
      cwd: workspace?.cwd,
      workspaceId: workspace?.workspaceId,
    });
  }

  async saveMemory(input: SaveMemoryInput): Promise<number> {
    const text = input.text.trim();
    if (!text) {
      throw new Error("Text cannot be empty");
    }
    const identity = this.resolveWriteIdentity(input.cwd);
    const visibility = defaultVisibilityForMemory();

    const timestamp = nowIso();
    const id = this.repo.saveManualNote({
      text,
      title: input.title ?? createTitle(text),
      cwd: identity.cwd,
      workspaceRoot: identity.workspaceRoot,
      workspaceId: identity.workspaceId,
      visibility,
      sensitivity: defaultSensitivityForIdentity(identity),
      scopePolicy: defaultScopePolicyForVisibility(visibility),
      metadataJson: input.metadataJson,
      createdAt: timestamp,
      createdAtEpoch: new Date(timestamp).getTime(),
    });

    await this.promoteObservationIds([id], {
      sourceKind: "manual_save",
      forceActive: true,
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
    const workspace = this.resolveWorkspaceRequirement(options?.cwd, options?.scopeMode ?? "global");
    const limit = options?.limit ?? 100;
    const scoped = this.runScopedSearch({
      cwd: workspace?.cwd,
      type: "manual_note",
      limit: Math.min(limit * 5, 500),
      scopeMode: options?.scopeMode ?? "exact_workspace",
    });
    const rows = scoped.observations;

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
    const scopeMode = options?.scopeMode ?? "global";
    const outputLimit = options?.limit ?? 100;
    const fetchLimit = Math.max(100, outputLimit);
    const candidates = await this.listPreferences({
      cwd: options?.cwd,
      limit: fetchLimit,
      includeSuperseded: true,
      scopeMode,
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
    scopeMode?: ScopeMode | undefined;
  }): Promise<string> {
    const pack = await this.buildContextPack({
      cwd: input.cwd,
      query: input.query,
      limit: input.limit,
      scopeMode: input.scopeMode,
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
    const scopeMode = options?.scopeMode ?? "exact_workspace";
    const workspace = this.resolveWorkspaceRequirement(options?.cwd, scopeMode);
    const cwd = workspace?.cwd;
    const query = options?.query;
    const limit = options?.limit ?? 8;
    const sessionLimit = options?.sessionLimit ?? 5;

    const scopedSearch = this.runScopedSearch({
      cwd,
      query,
      limit,
      scopeMode,
    });
    const highlights = scopedSearch.observations;

    const notes = await this.search({
      cwd,
      type: "manual_note",
      limit: 5,
      scopeMode,
    });

    const durableMemories = highlights
      .filter((row) => row.memoryClass && row.memoryStatus === "active")
      .slice(0, 5);
    const recentRelevantObservations = highlights
      .filter((row) => !row.memoryClass)
      .slice(0, 3);

    const resolvedPreferences = await this.resolvePreferences({
      cwd,
      keys: options?.preferenceKeys,
      limit: options?.preferenceLimit ?? 5,
      scopeMode,
    });

    const sessions = await this.sessions({
      cwd,
      limit: sessionLimit,
      scopeMode,
    });

    const retrievalSummary = scopedSearch.retrievalSummary;

    const generatedAt = nowIso();
    const markdown = toMarkdown({
      generatedAt,
      cwd,
      query,
      scopeMode,
      highlights,
      durableMemories,
      recentRelevantObservations,
      sessions,
      notes,
      resolvedPreferences,
      retrievalSummary,
    });

    return {
      generatedAt,
      cwd,
      query,
      highlights,
      durableMemories,
      recentRelevantObservations,
      sessions,
      notes,
      resolvedPreferences,
      retrievalSummary,
      markdown,
    };
  }

  async runRetrievalBenchmark(cases: RetrievalBenchmarkCase[]): Promise<RetrievalBenchmarkResult[]> {
    await this.ensureFreshSync(false);
    const results: RetrievalBenchmarkResult[] = [];

    for (const testCase of cases) {
      const pack = await this.buildContextPack({
        cwd: testCase.cwd,
        query: testCase.query,
        preferenceKeys: testCase.preferenceKeys,
        limit: 8,
        sessionLimit: 3,
      });

      results.push(
        evaluateBenchmarkCase(testCase, {
          highlights: pack.highlights,
          durableMemories: pack.durableMemories,
          resolvedPreferenceKeys: pack.resolvedPreferences.map((item) => item.key),
          retrievalSummary: pack.retrievalSummary,
        }),
      );
    }

    return results;
  }

  private runScopedSearch(options: SearchOptions): ScopedSearchResult {
    const scopeMode = options.scopeMode ?? "global";
    const workspace = this.resolveWorkspaceRequirement(options.cwd, scopeMode);
    const preparedQuery = options.query ? buildFtsQuery(options.query) : undefined;
    const raw = this.repo.search({
      ...options,
      cwd: undefined,
      query: preparedQuery,
      limit: Math.min((options.limit ?? 20) * 10, 200),
    });

    return this.applyIsolationPolicy(raw, {
      scopeMode,
      workspace,
      query: options.query,
      limit: options.limit ?? 20,
    });
  }

  private applyIsolationPolicy(
    rows: ObservationRecord[],
    options: {
      scopeMode: ScopeMode;
      workspace: WorkspaceIdentity | null;
      query?: string | undefined;
      limit: number;
    },
  ): ScopedSearchResult {
    let crossWorkspaceSuppressedCount = 0;
    let restrictedSuppressedCount = 0;

    const allowed = rows.filter((row) => {
      const decision = allowsResultForScope({
        requestedScopeMode: options.scopeMode,
        requestedWorkspaceId: options.workspace?.workspaceId,
        rowWorkspaceId: row.workspaceId,
        visibility: row.visibility,
        sensitivity: row.sensitivity,
      });
      row.workspaceMatch = decision.workspaceMatch;
      row.scopeDecision = decision.scopeDecision;
      row.visibilityDecision = decision.visibilityDecision;
      if (!decision.allowed) {
        if (decision.scopeDecision === "restricted_memory_present") restrictedSuppressedCount += 1;
        else crossWorkspaceSuppressedCount += 1;
      }
      return decision.allowed;
    });

    const ranked = rankObservations(allowed, {
      cwd: options.workspace?.cwd,
      query: options.query,
    }).slice(0, options.limit);

    const retrievalSummary = buildRetrievalSummary(
      ranked,
      { cwd: options.workspace?.cwd, query: options.query },
      {
        superseded: 0,
        crossProject: crossWorkspaceSuppressedCount,
        restricted: restrictedSuppressedCount,
      },
      {
        scopeMode: options.scopeMode,
        workspaceRoot: options.workspace?.workspaceRoot,
        workspaceId: options.workspace?.workspaceId,
        blockedReason:
          ranked.length === 0
            ? options.workspace
              ? "no_in_scope_results"
              : "scope_required"
            : undefined,
      },
    );

    return {
      observations: ranked,
      retrievalSummary,
      workspace: options.workspace,
    };
  }

  private filterIsolationOnly(
    rows: ObservationRecord[],
    options: {
      scopeMode: ScopeMode;
      workspace: WorkspaceIdentity | null;
    },
  ): ObservationRecord[] {
    return rows.filter((row) => {
      const decision = allowsResultForScope({
        requestedScopeMode: options.scopeMode,
        requestedWorkspaceId: options.workspace?.workspaceId,
        rowWorkspaceId: row.workspaceId,
        visibility: row.visibility,
        sensitivity: row.sensitivity,
      });
      row.workspaceMatch = decision.workspaceMatch;
      row.scopeDecision = decision.scopeDecision;
      row.visibilityDecision = decision.visibilityDecision;
      return decision.allowed;
    });
  }

  private resolveWorkspaceRequirement(
    cwd: string | undefined,
    scopeMode: ScopeMode,
  ): WorkspaceIdentity | null {
    if (scopeMode === "global") {
      return cwd ? resolveWorkspaceIdentity(cwd) : null;
    }

    const identity = cwd ? resolveWorkspaceIdentity(cwd) : inferProcessWorkspaceIdentity();
    if (!identity.resolved) {
      throw new ScopeIsolationError(cwd ? "workspace_unresolved" : "scope_required", cwd ? "workspace_unresolved" : "scope_required");
    }
    return identity;
  }

  private resolveWriteIdentity(cwd?: string | undefined): WorkspaceIdentity {
    const identity = cwd ? resolveWorkspaceIdentity(cwd) : inferProcessWorkspaceIdentity();
    if (!identity.resolved) {
      throw new ScopeIsolationError("workspace_unresolved", "workspace_unresolved");
    }
    return identity;
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
      await this.backfillIsolationMetadata();
      await this.backfillDurableMemoryCandidates();
      this.lastSyncAtEpoch = Date.now();
      return result;
    } finally {
      this.inFlightSync = null;
    }
  }

  private async backfillDurableMemoryCandidates(): Promise<void> {
    const missing = this.repo.loadObservationsMissingDurableMemory();
    if (missing.length === 0) return;

    const now = nowIso();
    const payloads = missing
      .map((row) => {
        const candidate = classifyManualNoteForPromotion(row, {
          sourceKind: "manual_backfill",
          forceActive: false,
        });
        if (!candidate) return null;

        return {
          observationId: row.id,
          memoryClass: candidate.memoryClass,
          title: row.title || createTitle(row.text),
          body: row.text,
          cwd: row.cwd,
          workspaceRoot: row.workspaceRoot ?? "",
          workspaceId: row.workspaceId ?? "unknown",
          visibility:
            candidate.memoryClass === "preference_note"
              ? defaultVisibilityForPreference(getPreferenceScope(row) ?? candidate.scope)
              : row.visibility ?? defaultVisibilityForMemory(),
          sensitivity: row.sensitivity ?? "restricted",
          scopePolicy:
            candidate.memoryClass === "preference_note"
              ? defaultScopePolicyForVisibility(
                  defaultVisibilityForPreference(getPreferenceScope(row) ?? candidate.scope),
                )
              : row.scopePolicy ?? "exact_workspace",
          trustLevel: candidate.trustLevel,
          scope: candidate.scope,
          sourceKind: candidate.sourceKind,
          relatedTopics: candidate.relatedTopics,
          status: candidate.status,
          createdAt: row.createdAt,
          updatedAt: now,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    this.repo.upsertDurableMemories(payloads);
  }

  private async promoteObservationIds(
    ids: number[],
    options: { sourceKind: DurableMemoryRecord["sourceKind"]; forceActive: boolean },
  ): Promise<void> {
    if (ids.length === 0) return;
    const rows = await this.getByIds(ids);
    const now = nowIso();
    const payloads = rows
      .map((row) => {
        const candidate = classifyManualNoteForPromotion(row, {
          sourceKind: options.sourceKind,
          forceActive: options.forceActive,
        });
        if (!candidate) return null;

        return {
          observationId: row.id,
          memoryClass: candidate.memoryClass,
          title: row.title || createTitle(row.text),
          body: row.text,
          cwd: row.cwd,
          workspaceRoot: row.workspaceRoot ?? "",
          workspaceId: row.workspaceId ?? "unknown",
          visibility:
            candidate.memoryClass === "preference_note"
              ? defaultVisibilityForPreference(getPreferenceScope(row) ?? candidate.scope)
              : row.visibility ?? defaultVisibilityForMemory(),
          sensitivity: row.sensitivity ?? "restricted",
          scopePolicy:
            candidate.memoryClass === "preference_note"
              ? defaultScopePolicyForVisibility(
                  defaultVisibilityForPreference(getPreferenceScope(row) ?? candidate.scope),
                )
              : row.scopePolicy ?? "exact_workspace",
          trustLevel: candidate.trustLevel,
          scope: candidate.scope,
          sourceKind: candidate.sourceKind,
          relatedTopics: candidate.relatedTopics,
          status: candidate.status,
          createdAt: row.createdAt,
          updatedAt: now,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    this.repo.upsertDurableMemories(payloads);
  }

  private async backfillIsolationMetadata(): Promise<void> {
    const observationRows = this.repo.loadObservationsMissingIsolation();
    if (observationRows.length > 0) {
      this.repo.updateObservationIsolation(
        observationRows.map((row) => {
          const identity = row.cwd ? resolveWorkspaceIdentity(row.cwd) : { cwd: "", workspaceRoot: "", workspaceId: "unknown", resolved: false };
          const visibility = row.type === "manual_note" && getPreferenceScope(row) === "global"
            ? defaultVisibilityForPreference("global")
            : defaultVisibilityForMemory();
          return {
            id: row.id,
            workspaceRoot: identity.workspaceRoot,
            workspaceId: identity.workspaceId,
            visibility,
            sensitivity: defaultSensitivityForIdentity(identity),
            scopePolicy: defaultScopePolicyForVisibility(visibility),
          };
        }),
      );
    }

    const durableRows = this.repo.loadDurableMemoriesMissingIsolation();
    if (durableRows.length > 0) {
      this.repo.updateDurableMemoryIsolation(
        durableRows.map((row) => {
          const identity = row.cwd ? resolveWorkspaceIdentity(row.cwd) : { cwd: "", workspaceRoot: "", workspaceId: "unknown", resolved: false };
          const visibility =
            row.memoryClass === "preference_note" && row.scope === "global"
              ? defaultVisibilityForPreference("global")
              : defaultVisibilityForMemory();
          return {
            id: row.id,
            workspaceRoot: identity.workspaceRoot,
            workspaceId: identity.workspaceId,
            visibility,
            sensitivity: defaultSensitivityForIdentity(identity),
            scopePolicy: defaultScopePolicyForVisibility(visibility),
          };
        }),
      );
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

function getPreferenceScope(row: ObservationRecord): PreferenceNote["scope"] | null {
  const metadata = safeJsonParse<unknown>(row.metadataJson);
  if (!metadata) return null;
  const parsed = preferenceNoteV1Schema.safeParse(metadata);
  return parsed.success ? parsed.data.scope : null;
}

function shrink(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function toMarkdown(pack: Omit<ContextPack, "markdown">): string {
  const lines: string[] = ["# codex-mem context", ""];

  if (pack.cwd) lines.push(`- scope.cwd: ${pack.cwd}`);
  if (pack.scopeMode) lines.push(`- scope.mode: ${pack.scopeMode}`);
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
      if (row.selectionReason) lines.push(`  - why: ${row.selectionReason}`);
      if (row.trustBasis) lines.push(`  - trust: ${row.trustBasis}`);
    }
  }

  if (pack.durableMemories.length > 0) {
    lines.push("");
    lines.push("## Durable Memories");
    for (const row of pack.durableMemories) {
      lines.push(`- [${row.id}] ${row.memoryClass}: ${shrink(row.text, 180)}`);
      if (row.selectionReason) lines.push(`  - why: ${row.selectionReason}`);
      if (row.trustBasis) lines.push(`  - trust: ${row.trustBasis}`);
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

  if (pack.recentRelevantObservations.length > 0) {
    lines.push("");
    lines.push("## Recent Relevant Observations");
    for (const row of pack.recentRelevantObservations) {
      lines.push(`- [${row.id}] ${shrink(row.text, 180)}`);
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

  lines.push("");
  lines.push("## Retrieval Summary");
  lines.push(`- confidence: ${pack.retrievalSummary.confidenceBand}`);
  lines.push(`- reason: ${pack.retrievalSummary.confidenceReason}`);
  lines.push(`- scope_mode: ${pack.retrievalSummary.scopeModeApplied}`);
  lines.push(`- durable: ${pack.retrievalSummary.durableCount}`);
  lines.push(`- episodic: ${pack.retrievalSummary.episodicCount}`);
  lines.push(`- suppressed_cross_workspace: ${pack.retrievalSummary.suppressedAsCrossProject}`);
  lines.push(`- suppressed_restricted: ${pack.retrievalSummary.suppressedAsRestricted}`);
  if (pack.retrievalSummary.blockedReason) {
    lines.push(`- blocked_reason: ${pack.retrievalSummary.blockedReason}`);
  }
  if (pack.retrievalSummary.weakSpots.length > 0) {
    lines.push(`- weak_spots: ${pack.retrievalSummary.weakSpots.join("; ")}`);
  }

  return lines.join("\n");
}
