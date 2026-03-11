import type {
  DurableMemoryRecord,
  MemoryStats,
  ObservationRecord,
  ProjectSummary,
  SessionSummary,
  SourceOffsetRecord,
} from "../types.js";
import type {
  DurableMemoryRow,
  ObservationRow,
  OffsetRow,
  ProjectRow,
  SessionRow,
  StatsRow,
} from "./rows.js";

function safeJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function mapObservationRows(rows: ObservationRow[]): ObservationRecord[] {
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    sessionId: row.session_id,
    cwd: row.cwd,
    workspaceRoot: row.workspace_root ?? "",
    workspaceId: row.workspace_id ?? "unknown",
    visibility: (row.visibility ?? undefined) as ObservationRecord["visibility"],
    sensitivity: (row.sensitivity ?? undefined) as ObservationRecord["sensitivity"],
    scopePolicy: (row.scope_policy ?? undefined) as ObservationRecord["scopePolicy"],
    role: row.role,
    type: row.type,
    title: row.title,
    text: row.text,
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
    createdAtEpoch: row.created_at_epoch,
    memoryClass: (row.memory_class ?? undefined) as ObservationRecord["memoryClass"],
    memoryStatus: (row.memory_status ?? undefined) as ObservationRecord["memoryStatus"],
    trustLevel: row.trust_level ?? undefined,
    memoryScope: (row.memory_scope ?? undefined) as ObservationRecord["memoryScope"],
    sourceKind: (row.source_kind ?? undefined) as ObservationRecord["sourceKind"],
    relatedPaths: safeJsonArray(row.related_paths_json),
    relatedTopics: safeJsonArray(row.related_topics_json),
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

export function mapDurableMemoryRows(rows: DurableMemoryRow[]): DurableMemoryRecord[] {
  return rows.map((row) => ({
    id: row.id,
    observationId: row.observation_id,
    memoryClass: row.memory_class as DurableMemoryRecord["memoryClass"],
    title: row.title,
    body: row.body,
    cwd: row.cwd,
    workspaceRoot: row.workspace_root ?? "",
    workspaceId: row.workspace_id ?? "unknown",
    visibility: row.visibility as DurableMemoryRecord["visibility"],
    sensitivity: row.sensitivity as DurableMemoryRecord["sensitivity"],
    scopePolicy: row.scope_policy as DurableMemoryRecord["scopePolicy"],
    trustLevel: row.trust_level,
    scope: row.scope as DurableMemoryRecord["scope"],
    sourceKind: row.source_kind as DurableMemoryRecord["sourceKind"],
    supersedes: safeJsonArray(row.supersedes_json),
    relatedPaths: safeJsonArray(row.related_paths_json),
    relatedTopics: safeJsonArray(row.related_topics_json),
    status: row.status as DurableMemoryRecord["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
