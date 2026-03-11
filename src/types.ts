import type { ObservationType, PreferenceScope, PreferenceSource } from "./contracts.js";

export type { ObservationType, PreferenceScope, PreferenceSource } from "./contracts.js";

export interface ObservationRecord {
  id: number;
  source: string;
  sessionId: string;
  cwd: string;
  workspaceRoot?: string | undefined;
  workspaceId?: string | undefined;
  visibility?: MemoryVisibility | undefined;
  sensitivity?: MemorySensitivity | undefined;
  scopePolicy?: MemoryScopePolicy | undefined;
  role: string;
  type: ObservationType;
  title: string;
  text: string;
  metadataJson: string;
  createdAt: string;
  createdAtEpoch: number;
  memoryClass?: MemoryClass | undefined;
  memoryStatus?: DurableMemoryStatus | undefined;
  trustLevel?: number | undefined;
  memoryScope?: DurableMemoryScope | undefined;
  sourceKind?: DurableMemorySourceKind | undefined;
  retrievalSource?: RetrievalSource | undefined;
  selectionReason?: string | undefined;
  trustBasis?: string | undefined;
  retrievalScore?: number | undefined;
  confidenceBand?: RetrievalConfidenceBand | undefined;
  relatedPaths?: string[] | undefined;
  relatedTopics?: string[] | undefined;
  workspaceMatch?: boolean | undefined;
  scopeDecision?: string | undefined;
  visibilityDecision?: string | undefined;
}

export interface ObservationInsert {
  source: string;
  sessionId: string;
  cwd: string;
  workspaceRoot: string;
  workspaceId: string;
  visibility: MemoryVisibility;
  sensitivity: MemorySensitivity;
  scopePolicy: MemoryScopePolicy;
  role: string;
  type: ObservationType;
  title: string;
  text: string;
  metadataJson: string;
  createdAt: string;
  createdAtEpoch: number;
}

export interface SourceOffsetRecord {
  sourcePath: string;
  lastOffset: number;
  lastMtimeMs: number;
}

export interface SearchOptions {
  query?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  cwd?: string | undefined;
  workspaceId?: string | undefined;
  type?: ObservationType | undefined;
  scopeMode?: ScopeMode | undefined;
}

export interface TimelineOptions {
  before?: number | undefined;
  after?: number | undefined;
  cwd?: string | undefined;
  workspaceId?: string | undefined;
  scopeMode?: ScopeMode | undefined;
}

export interface StatsOptions {
  cwd?: string | undefined;
  workspaceId?: string | undefined;
  scopeMode?: ScopeMode | undefined;
}

export interface SessionListOptions {
  cwd?: string | undefined;
  workspaceId?: string | undefined;
  limit?: number | undefined;
  scopeMode?: ScopeMode | undefined;
}

export interface ProjectListOptions {
  limit?: number | undefined;
}

export interface BuildContextOptions {
  cwd?: string | undefined;
  query?: string | undefined;
  limit?: number | undefined;
  sessionLimit?: number | undefined;
  preferenceKeys?: string[] | undefined;
  preferenceLimit?: number | undefined;
  scopeMode?: ScopeMode | undefined;
}

export type MemoryClass =
  | "decision_note"
  | "fix_note"
  | "constraint_note"
  | "preference_note"
  | "summary_note";

export type DurableMemoryStatus = "active" | "superseded" | "candidate";
export type DurableMemoryScope = "user" | "project" | "workspace" | "global";
export type ScopeMode = "exact_workspace" | "cross_workspace" | "global";
export type MemoryVisibility = "workspace_only" | "cross_workspace_opt_in" | "global_preference";
export type MemorySensitivity = "normal" | "restricted";
export type MemoryScopePolicy = "exact_workspace" | "workspace_family" | "global_allowed";
export type DurableMemorySourceKind =
  | "preference_import"
  | "manual_backfill"
  | "manual_save"
  | "promotion";
export type RetrievalSource = "durable" | "preference" | "episodic" | "session";
export type RetrievalConfidenceBand = "high" | "medium" | "low";

export interface DurableMemoryRecord {
  id: number;
  observationId: number;
  memoryClass: MemoryClass;
  title: string;
  body: string;
  cwd: string;
  workspaceRoot: string;
  workspaceId: string;
  visibility: MemoryVisibility;
  sensitivity: MemorySensitivity;
  scopePolicy: MemoryScopePolicy;
  trustLevel: number;
  scope: DurableMemoryScope;
  sourceKind: DurableMemorySourceKind;
  supersedes: string[];
  relatedPaths: string[];
  relatedTopics: string[];
  status: DurableMemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceNote {
  schema_version: "pref-note.v1";
  key: string;
  scope: PreferenceScope;
  trigger: string;
  preferred: string;
  avoid: string;
  example_good: string;
  example_bad: string;
  confidence: number;
  source: PreferenceSource;
  supersedes: string[];
  created_at: string;
}

export interface PreferenceRecord extends PreferenceNote {
  id: number;
  cwd: string;
  title: string;
  observationCreatedAt: string;
  observationCreatedAtEpoch: number;
}

export interface ListPreferencesOptions {
  cwd?: string | undefined;
  key?: string | undefined;
  scope?: PreferenceScope | undefined;
  limit?: number | undefined;
  includeSuperseded?: boolean | undefined;
  scopeMode?: ScopeMode | undefined;
}

export interface ResolvePreferencesOptions {
  cwd?: string | undefined;
  keys?: string[] | undefined;
  limit?: number | undefined;
  scopeMode?: ScopeMode | undefined;
}

export interface ResolvedPreference {
  key: string;
  selected: PreferenceRecord;
  ignored: PreferenceRecord[];
}

export interface MemoryStats {
  total: number;
  userMessages: number;
  assistantMessages: number;
  manualNotes: number;
  toolEvents: number;
  uniqueProjects: number;
  uniqueSessions: number;
}

export interface ProjectSummary {
  cwd: string;
  observationCount: number;
  lastActivityAt: string;
}

export interface SessionSummary {
  sessionId: string;
  cwd: string;
  firstAt: string;
  lastAt: string;
  observationCount: number;
  lastTitle: string;
}

export interface ContextPack {
  generatedAt: string;
  cwd?: string | undefined;
  query?: string | undefined;
  scopeMode?: ScopeMode | undefined;
  highlights: ObservationRecord[];
  durableMemories: ObservationRecord[];
  recentRelevantObservations: ObservationRecord[];
  sessions: SessionSummary[];
  notes: ObservationRecord[];
  resolvedPreferences: ResolvedPreference[];
  retrievalSummary: RetrievalSummary;
  markdown: string;
}

export interface SyncResult {
  status: "ok";
  filesScanned: number;
  observationsInserted: number;
}

export interface MemoryPaths {
  codexHome: string;
  dataDir: string;
  dbPath: string;
}

export interface RetrievalSummary {
  confidenceBand: RetrievalConfidenceBand;
  confidenceReason: string;
  suppressedAsSuperseded: number;
  suppressedAsCrossProject: number;
  suppressedAsRestricted: number;
  durableCount: number;
  episodicCount: number;
  scopeModeApplied: ScopeMode;
  workspaceRootUsed?: string | undefined;
  workspaceIdUsed?: string | undefined;
  blockedReason?: string | undefined;
  weakSpots: string[];
}

export interface RetrievalBenchmarkCase {
  id: string;
  description: string;
  cwd?: string | undefined;
  query?: string | undefined;
  preferenceKeys?: string[] | undefined;
  expectedMemoryClasses?: MemoryClass[] | undefined;
  expectedPreferenceKeys?: string[] | undefined;
  forbiddenTexts?: string[] | undefined;
  minimumConfidenceBand?: RetrievalConfidenceBand | undefined;
}

export interface RetrievalBenchmarkResult {
  id: string;
  passed: boolean;
  failures: string[];
}
