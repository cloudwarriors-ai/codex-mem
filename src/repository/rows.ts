import type { ObservationType } from "../types.js";

export interface ObservationRow {
  id: number;
  source: string;
  session_id: string;
  cwd: string;
  role: string;
  type: ObservationType;
  title: string;
  text: string;
  metadata_json: string;
  created_at: string;
  created_at_epoch: number;
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
  observation_count: number;
  last_activity_epoch: number;
}

export interface SessionRow {
  session_id: string;
  cwd: string;
  first_epoch: number;
  last_epoch: number;
  observation_count: number;
  last_title: string;
}
