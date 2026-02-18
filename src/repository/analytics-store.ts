import type Database from "better-sqlite3";
import type {
  MemoryStats,
  ProjectListOptions,
  ProjectSummary,
  SessionListOptions,
  SessionSummary,
  StatsOptions,
} from "../types.js";
import { mapProjectRows, mapSessionRows, mapStatsRow } from "./mappers.js";
import { clampInt } from "./query-utils.js";
import type { ProjectRow, SessionRow, StatsRow } from "./rows.js";

export class AnalyticsStore {
  constructor(private readonly db: Database.Database) {}

  getStats(options?: StatsOptions): MemoryStats {
    const cwd = options?.cwd ?? "";
    const row = this.db
      .prepare(
        `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN type = 'user_message' THEN 1 ELSE 0 END) AS user_messages,
          SUM(CASE WHEN type = 'assistant_message' THEN 1 ELSE 0 END) AS assistant_messages,
          SUM(CASE WHEN type = 'manual_note' THEN 1 ELSE 0 END) AS manual_notes,
          SUM(CASE WHEN type IN ('tool_call', 'tool_output') THEN 1 ELSE 0 END) AS tool_events,
          COUNT(DISTINCT CASE WHEN cwd <> '' THEN cwd END) AS unique_projects,
          COUNT(DISTINCT CASE WHEN session_id <> '' THEN session_id END) AS unique_sessions
        FROM observations
        WHERE (? = '' OR cwd = ?)
      `,
      )
      .get(cwd, cwd) as StatsRow | undefined;

    return mapStatsRow(row);
  }

  listProjects(options?: ProjectListOptions): ProjectSummary[] {
    const limit = clampInt(options?.limit, 1, 200, 20);
    const rows = this.db
      .prepare(
        `
        SELECT
          cwd,
          COUNT(*) AS observation_count,
          MAX(created_at_epoch) AS last_activity_epoch
        FROM observations
        WHERE cwd <> ''
        GROUP BY cwd
        ORDER BY observation_count DESC, last_activity_epoch DESC
        LIMIT ?
      `,
      )
      .all(limit) as ProjectRow[];

    return mapProjectRows(rows);
  }

  listSessions(options?: SessionListOptions): SessionSummary[] {
    const cwd = options?.cwd ?? "";
    const limit = clampInt(options?.limit, 1, 200, 20);

    const rows = this.db
      .prepare(
        `
        SELECT
          o.session_id,
          (
            SELECT o2.cwd
            FROM observations o2
            WHERE o2.session_id = o.session_id
            ORDER BY o2.created_at_epoch DESC, o2.id DESC
            LIMIT 1
          ) AS cwd,
          MIN(o.created_at_epoch) AS first_epoch,
          MAX(o.created_at_epoch) AS last_epoch,
          COUNT(*) AS observation_count,
          (
            SELECT o2.title
            FROM observations o2
            WHERE o2.session_id = o.session_id
            ORDER BY o2.created_at_epoch DESC, o2.id DESC
            LIMIT 1
          ) AS last_title
        FROM observations o
        WHERE o.session_id <> ''
          AND (? = '' OR o.cwd = ?)
        GROUP BY o.session_id
        ORDER BY last_epoch DESC
        LIMIT ?
      `,
      )
      .all(cwd, cwd, limit) as SessionRow[];

    return mapSessionRows(rows);
  }
}
