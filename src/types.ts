import type { ObservationType } from "./contracts.js";

export type { ObservationType } from "./contracts.js";

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
