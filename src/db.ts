import Database from "better-sqlite3";
import { AnalyticsStore } from "./repository/analytics-store.js";
import { ObservationStore } from "./repository/observation-store.js";
import { SourceOffsetStore } from "./repository/offset-store.js";
import { initializeRepositorySchema } from "./repository/schema.js";
import type {
  MemoryStats,
  ObservationInsert,
  ObservationRecord,
  ProjectListOptions,
  ProjectSummary,
  SearchOptions,
  SessionListOptions,
  SessionSummary,
  StatsOptions,
  SourceOffsetRecord,
  TimelineOptions,
} from "./types.js";

export class MemoryRepository {
  private readonly db: Database.Database;
  private readonly offsets: SourceOffsetStore;
  private readonly observations: ObservationStore;
  private readonly analytics: AnalyticsStore;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    initializeRepositorySchema(this.db);

    this.offsets = new SourceOffsetStore(this.db);
    this.observations = new ObservationStore(this.db);
    this.analytics = new AnalyticsStore(this.db);
  }

  close(): void {
    this.db.close();
  }

  getOffset(sourcePath: string): SourceOffsetRecord | null {
    return this.offsets.getOffset(sourcePath);
  }

  upsertOffset(sourcePath: string, lastOffset: number, lastMtimeMs: number): void {
    this.offsets.upsertOffset(sourcePath, lastOffset, lastMtimeMs);
  }

  getLatestSessionContext(source: string): { sessionId: string; cwd: string } | null {
    return this.observations.getLatestSessionContext(source);
  }

  insertObservations(observations: ObservationInsert[]): number {
    return this.observations.insertObservations(observations);
  }

  saveManualNote(input: {
    text: string;
    title?: string | undefined;
    cwd?: string | undefined;
    metadataJson?: string | undefined;
    createdAt: string;
    createdAtEpoch: number;
  }): number {
    return this.observations.saveManualNote(input);
  }

  search(options: SearchOptions): ObservationRecord[] {
    return this.observations.search(options);
  }

  getByIds(ids: number[]): ObservationRecord[] {
    return this.observations.getByIds(ids);
  }

  getTimeline(anchorId: number, options: TimelineOptions): ObservationRecord[] {
    return this.observations.getTimeline(anchorId, options);
  }

  getStats(options?: StatsOptions): MemoryStats {
    return this.analytics.getStats(options);
  }

  listProjects(options?: ProjectListOptions): ProjectSummary[] {
    return this.analytics.listProjects(options);
  }

  listSessions(options?: SessionListOptions): SessionSummary[] {
    return this.analytics.listSessions(options);
  }
}
