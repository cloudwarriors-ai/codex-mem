import type { ObservationType, PreferenceScope, PreferenceSource } from "./contracts.js";

export type { ObservationType, PreferenceScope, PreferenceSource } from "./contracts.js";

export interface ObservationRecord {
  id: number;
  source: string;
  sessionId: string;
  cwd: string;
  role: string;
  type: ObservationType;
  title: string;
  text: string;
  metadataJson: string;
  createdAt: string;
  createdAtEpoch: number;
}

export interface ObservationInsert {
  source: string;
  sessionId: string;
  cwd: string;
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
  type?: ObservationType | undefined;
}

export interface TimelineOptions {
  before?: number | undefined;
  after?: number | undefined;
  cwd?: string | undefined;
}

export interface StatsOptions {
  cwd?: string | undefined;
}

export interface SessionListOptions {
  cwd?: string | undefined;
  limit?: number | undefined;
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
}

export interface ResolvePreferencesOptions {
  cwd?: string | undefined;
  keys?: string[] | undefined;
  limit?: number | undefined;
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
  highlights: ObservationRecord[];
  sessions: SessionSummary[];
  notes: ObservationRecord[];
  resolvedPreferences: ResolvedPreference[];
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
