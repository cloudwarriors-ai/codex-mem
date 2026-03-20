import type { ObservationType } from "../types.js";

export interface ObservationRow {
  id: number;
  source: string;
  session_id: string;
  cwd: string;
  workspace_root: string;
  workspace_id: string;
  visibility: string;
  sensitivity: string;
  scope_policy: string;
  role: string;
  type: ObservationType;
  title: string;
  text: string;
  metadata_json: string;
  created_at: string;
  created_at_epoch: number;
  memory_class?: string | null;
  memory_status?: string | null;
  trust_level?: number | null;
  memory_scope?: string | null;
  source_kind?: string | null;
  related_paths_json?: string | null;
  related_topics_json?: string | null;
}

export interface OffsetRow {
  source_path: string;
  last_offset: number;
  last_mtime_ms: number;
}

export interface AnchorRow {
  id: number;
  created_at_epoch: number;
}

export interface SessionContextRow {
  session_id: string;
  cwd: string;
  workspace_root: string;
  workspace_id: string;
}

export interface StatsRow {
  total: number;
  user_messages: number;
  assistant_messages: number;
  manual_notes: number;
  tool_events: number;
  unique_projects: number;
  unique_sessions: number;
}

export interface ProjectRow {
  cwd: string;
  workspace_root: string;
  workspace_id: string;
  observation_count: number;
  last_activity_epoch: number;
}

export interface SessionRow {
  session_id: string;
  cwd: string;
  workspace_root: string;
  workspace_id: string;
  first_epoch: number;
  last_epoch: number;
  observation_count: number;
  last_title: string;
}

export interface DurableMemoryRow {
  id: number;
  observation_id: number;
  memory_class: string;
  title: string;
  body: string;
  cwd: string;
  workspace_root: string;
  workspace_id: string;
  visibility: string;
  sensitivity: string;
  scope_policy: string;
  trust_level: number;
  scope: string;
  source_kind: string;
  supersedes_json: string;
  related_paths_json: string;
  related_topics_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}
