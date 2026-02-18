import type {
  MemoryStats,
  ObservationRecord,
  ProjectSummary,
  SessionSummary,
  SourceOffsetRecord,
} from "../types.js";
import type { ObservationRow, OffsetRow, ProjectRow, SessionRow, StatsRow } from "./rows.js";

export function mapObservationRows(rows: ObservationRow[]): ObservationRecord[] {
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    sessionId: row.session_id,
    cwd: row.cwd,
    role: row.role,
    type: row.type,
    title: row.title,
    text: row.text,
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
    createdAtEpoch: row.created_at_epoch,
  }));
}

export function mapOffsetRow(row: OffsetRow): SourceOffsetRecord {
  return {
    sourcePath: row.source_path,
    lastOffset: row.last_offset,
    lastMtimeMs: row.last_mtime_ms,
  };
}

export function mapStatsRow(row: StatsRow | undefined): MemoryStats {
  return {
    total: row?.total ?? 0,
    userMessages: row?.user_messages ?? 0,
    assistantMessages: row?.assistant_messages ?? 0,
    manualNotes: row?.manual_notes ?? 0,
    toolEvents: row?.tool_events ?? 0,
    uniqueProjects: row?.unique_projects ?? 0,
    uniqueSessions: row?.unique_sessions ?? 0,
  };
}

export function mapProjectRows(rows: ProjectRow[]): ProjectSummary[] {
  return rows.map((row) => ({
    cwd: row.cwd,
    observationCount: row.observation_count,
    lastActivityAt: new Date(row.last_activity_epoch).toISOString(),
  }));
}

export function mapSessionRows(rows: SessionRow[]): SessionSummary[] {
  return rows.map((row) => ({
    sessionId: row.session_id,
    cwd: row.cwd ?? "",
    firstAt: new Date(row.first_epoch).toISOString(),
    lastAt: new Date(row.last_epoch).toISOString(),
    observationCount: row.observation_count,
    lastTitle: row.last_title ?? "",
  }));
}
