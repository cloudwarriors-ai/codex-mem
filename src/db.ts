import Database from "better-sqlite3";
import { AnalyticsStore } from "./repository/analytics-store.js";
import { DurableMemoryStore } from "./repository/durable-memory-store.js";
import { ObservationStore } from "./repository/observation-store.js";
import { SourceOffsetStore } from "./repository/offset-store.js";
import { initializeRepositorySchema } from "./repository/schema.js";
import type {
  DurableMemoryRecord,
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
import { CURRENT_SCHEMA_VERSION, configurePragmas } from "./db-pragmas.js";

export class MemoryRepository {
  private readonly db: Database.Database;
  private readonly offsets: SourceOffsetStore;
  private readonly observations: ObservationStore;
  private readonly analytics: AnalyticsStore;
  private readonly durableMemories: DurableMemoryStore;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    configurePragmas(this.db);

    initializeRepositorySchema(this.db);
    this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);

    this.offsets = new SourceOffsetStore(this.db);
    this.observations = new ObservationStore(this.db);
    this.analytics = new AnalyticsStore(this.db);
    this.durableMemories = new DurableMemoryStore(this.db);
  }

  close(): void {
    this.checkpoint("truncate");
    this.db.close();
  }

  checkpoint(mode: "passive" | "truncate" = "passive"): void {
    this.db.pragma(`wal_checkpoint(${mode.toUpperCase()})`);
  }

  async backupTo(destinationPath: string): Promise<void> {
    await this.db.backup(destinationPath);
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
    workspaceRoot?: string | undefined;
    workspaceId?: string | undefined;
    visibility?: ObservationRecord["visibility"];
    sensitivity?: ObservationRecord["sensitivity"];
    scopePolicy?: ObservationRecord["scopePolicy"];
    metadataJson?: string | undefined;
    createdAt: string;
    createdAtEpoch: number;
  }): number {
    return this.observations.saveManualNote(input);
  }

  search(options: SearchOptions): ObservationRecord[] {
    return this.observations.search(options);
  }

  loadObservationsMissingDurableMemory(): ObservationRecord[] {
    return this.observations.mapRows(this.durableMemories.loadBackfillObservations());
  }

  loadObservationsMissingIsolation(): ObservationRecord[] {
    return this.observations.mapRows(this.observations.loadMissingIsolationRows());
  }

  updateObservationIsolation(
    inputs: Array<{
      id: number;
      workspaceRoot: string;
      workspaceId: string;
      visibility: ObservationRecord["visibility"];
      sensitivity: ObservationRecord["sensitivity"];
      scopePolicy: ObservationRecord["scopePolicy"];
    }>,
  ): number {
    return this.observations.updateIsolation(inputs);
  }

  upsertDurableMemories(
    inputs: Array<{
      observationId: number;
      memoryClass: DurableMemoryRecord["memoryClass"];
      title: string;
      body: string;
      cwd?: string | undefined;
      workspaceRoot: string;
      workspaceId: string;
      visibility: DurableMemoryRecord["visibility"];
      sensitivity: DurableMemoryRecord["sensitivity"];
      scopePolicy: DurableMemoryRecord["scopePolicy"];
      trustLevel: number;
      scope: DurableMemoryRecord["scope"];
      sourceKind: DurableMemoryRecord["sourceKind"];
      supersedes?: string[] | undefined;
      relatedPaths?: string[] | undefined;
      relatedTopics?: string[] | undefined;
      status: DurableMemoryRecord["status"];
      createdAt: string;
      updatedAt: string;
    }>,
  ): number {
    return this.durableMemories.backfillFromObservations(inputs);
  }

  getDurableMemoriesForObservationIds(
    ids: number[],
    statuses: DurableMemoryRecord["status"][] = ["active"],
  ): DurableMemoryRecord[] {
    return this.durableMemories.listForObservationIds(ids, statuses);
  }

  listDurableMemoryCandidates(limit?: number): DurableMemoryRecord[] {
    return this.durableMemories.listCandidates(limit);
  }

  loadDurableMemoriesMissingIsolation(): DurableMemoryRecord[] {
    return this.durableMemories.loadMissingIsolationRows();
  }

  updateDurableMemoryIsolation(
    inputs: Array<{
      id: number;
      workspaceRoot: string;
      workspaceId: string;
      visibility: DurableMemoryRecord["visibility"];
      sensitivity: DurableMemoryRecord["sensitivity"];
      scopePolicy: DurableMemoryRecord["scopePolicy"];
    }>,
  ): number {
    return this.durableMemories.updateIsolation(inputs);
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
