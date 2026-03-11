import type Database from "better-sqlite3";
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from "../config.js";
import type {
  ObservationInsert,
  ObservationRecord,
  SearchOptions,
  TimelineOptions,
} from "../types.js";
import { mapObservationRows } from "./mappers.js";
import { clampInt } from "./query-utils.js";
import type { AnchorRow, ObservationRow, SessionContextRow } from "./rows.js";

const EFFECTIVE_MEMORY_COLUMNS = `
  COALESCE(dm.workspace_root, o.workspace_root) AS workspace_root,
  COALESCE(dm.workspace_id, o.workspace_id) AS workspace_id,
  COALESCE(dm.visibility, o.visibility) AS visibility,
  COALESCE(dm.sensitivity, o.sensitivity) AS sensitivity,
  COALESCE(dm.scope_policy, o.scope_policy) AS scope_policy
`;

export class ObservationStore {
  constructor(private readonly db: Database.Database) {}

  mapRows(rows: ObservationRow[]): ObservationRecord[] {
    return mapObservationRows(rows);
  }

  getLatestSessionContext(source: string): { sessionId: string; cwd: string } | null {
    const row = this.db
      .prepare(
        `
        SELECT session_id, cwd, workspace_root, workspace_id
        FROM observations
        WHERE source = ?
        ORDER BY created_at_epoch DESC, id DESC
        LIMIT 1
      `,
      )
      .get(source) as SessionContextRow | undefined;

    if (!row) return null;

    return {
      sessionId: row.session_id,
      cwd: row.cwd,
    };
  }

  insertObservations(observations: ObservationInsert[]): number {
    if (observations.length === 0) return 0;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO observations (
        source,
        session_id,
        cwd,
        workspace_root,
        workspace_id,
        visibility,
        sensitivity,
        scope_policy,
        role,
        type,
        title,
        text,
        metadata_json,
        created_at,
        created_at_epoch
      ) VALUES (
        @source,
        @sessionId,
        @cwd,
        @workspaceRoot,
        @workspaceId,
        @visibility,
        @sensitivity,
        @scopePolicy,
        @role,
        @type,
        @title,
        @text,
        @metadataJson,
        @createdAt,
        @createdAtEpoch
      )
    `);

    const tx = this.db.transaction((rows: ObservationInsert[]) => {
      let inserted = 0;
      for (const row of rows) {
        inserted += stmt.run(row).changes;
      }
      return inserted;
    });

    return tx(observations);
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
    const row = this.db
      .prepare(
        `
      INSERT INTO observations (
        source,
        session_id,
        cwd,
        workspace_root,
        workspace_id,
        visibility,
        sensitivity,
        scope_policy,
        role,
        type,
        title,
        text,
        metadata_json,
        created_at,
        created_at_epoch
      ) VALUES (
        'manual',
        '',
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        'user',
        'manual_note',
        ?,
        ?,
        ?,
        ?,
        ?
      )
      RETURNING id
    `,
      )
      .get(
        input.cwd ?? "",
        input.workspaceRoot ?? "",
        input.workspaceId ?? "unknown",
        input.visibility ?? "workspace_only",
        input.sensitivity ?? "restricted",
        input.scopePolicy ?? "exact_workspace",
        input.title ?? "",
        input.text,
        input.metadataJson ?? "{}",
        input.createdAt,
        input.createdAtEpoch,
      ) as { id: number };

    return row.id;
  }

  search(options: SearchOptions): ObservationRecord[] {
    const limit = clampInt(options.limit, 1, MAX_SEARCH_LIMIT, DEFAULT_SEARCH_LIMIT);
    const offset = clampInt(options.offset, 0, 100_000, 0);
    const cwd = options.cwd ?? "";
    const type = options.type ?? "";
    const includeToolNoise = type !== "";

    if (options.query && options.query.trim().length > 0) {
      return mapObservationRows(
        this.db
          .prepare(
            `
            SELECT
              o.*,
              ${EFFECTIVE_MEMORY_COLUMNS},
              dm.memory_class,
              dm.status AS memory_status,
              dm.trust_level,
              dm.scope AS memory_scope,
              dm.source_kind,
              dm.related_paths_json,
              dm.related_topics_json
            FROM observations o
            LEFT JOIN durable_memories dm
              ON dm.observation_id = o.id
             AND dm.status = 'active'
            JOIN observations_fts fts ON o.id = fts.rowid
            WHERE observations_fts MATCH ?
              AND (? = '' OR o.cwd = ?)
              AND (? = '' OR o.type = ?)
              AND (? = 1 OR o.type NOT IN ('tool_call', 'tool_output'))
            ORDER BY o.created_at_epoch DESC
            LIMIT ? OFFSET ?
          `,
          )
          .all(
            options.query,
            cwd,
            cwd,
            type,
            type,
            includeToolNoise ? 1 : 0,
            limit,
            offset,
          ) as ObservationRow[],
      );
    }

    return mapObservationRows(
      this.db
        .prepare(
          `
          SELECT
            o.*,
            ${EFFECTIVE_MEMORY_COLUMNS},
            dm.memory_class,
            dm.status AS memory_status,
            dm.trust_level,
            dm.scope AS memory_scope,
            dm.source_kind,
            dm.related_paths_json,
            dm.related_topics_json
          FROM observations o
          LEFT JOIN durable_memories dm
            ON dm.observation_id = o.id
           AND dm.status = 'active'
          WHERE (? = '' OR o.cwd = ?)
            AND (? = '' OR o.type = ?)
            AND (? = 1 OR o.type NOT IN ('tool_call', 'tool_output'))
          ORDER BY o.created_at_epoch DESC
          LIMIT ? OFFSET ?
        `,
        )
        .all(
          cwd,
          cwd,
          type,
          type,
          includeToolNoise ? 1 : 0,
          limit,
          offset,
        ) as ObservationRow[],
    );
  }

  getByIds(ids: number[]): ObservationRecord[] {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(",");
    const query = `
      SELECT
        o.*,
        ${EFFECTIVE_MEMORY_COLUMNS},
        dm.memory_class,
        dm.status AS memory_status,
        dm.trust_level,
        dm.scope AS memory_scope,
        dm.source_kind,
        dm.related_paths_json,
        dm.related_topics_json
      FROM observations o
      LEFT JOIN durable_memories dm
        ON dm.observation_id = o.id
       AND dm.status = 'active'
      WHERE o.id IN (${placeholders})
      ORDER BY o.created_at_epoch DESC
    `;

    return mapObservationRows(this.db.prepare(query).all(...ids) as ObservationRow[]);
  }

  getTimeline(anchorId: number, options: TimelineOptions): ObservationRecord[] {
    const anchor = this.db
      .prepare(
        `
        SELECT id, created_at_epoch
        FROM observations
        WHERE id = ?
      `,
      )
      .get(anchorId) as AnchorRow | undefined;

    if (!anchor) return [];

    const before = clampInt(options.before, 1, 200, 8);
    const after = clampInt(options.after, 1, 200, 8);
    const cwd = options.cwd ?? "";

    const beforeRows = this.db
      .prepare(
        `
        SELECT
          o.*,
          ${EFFECTIVE_MEMORY_COLUMNS},
          dm.memory_class,
          dm.status AS memory_status,
          dm.trust_level,
          dm.scope AS memory_scope,
          dm.source_kind,
          dm.related_paths_json,
          dm.related_topics_json
        FROM observations o
        LEFT JOIN durable_memories dm
          ON dm.observation_id = o.id
         AND dm.status = 'active'
        WHERE o.created_at_epoch < ?
          AND (? = '' OR o.cwd = ?)
        ORDER BY o.created_at_epoch DESC
        LIMIT ?
      `,
      )
      .all(anchor.created_at_epoch, cwd, cwd, before) as ObservationRow[];

    const anchorAndAfterRows = this.db
      .prepare(
        `
        SELECT
          o.*,
          ${EFFECTIVE_MEMORY_COLUMNS},
          dm.memory_class,
          dm.status AS memory_status,
          dm.trust_level,
          dm.scope AS memory_scope,
          dm.source_kind,
          dm.related_paths_json,
          dm.related_topics_json
        FROM observations o
        LEFT JOIN durable_memories dm
          ON dm.observation_id = o.id
         AND dm.status = 'active'
        WHERE o.created_at_epoch >= ?
          AND (? = '' OR o.cwd = ?)
        ORDER BY o.created_at_epoch ASC
        LIMIT ?
      `,
      )
      .all(anchor.created_at_epoch, cwd, cwd, after + 1) as ObservationRow[];

    return mapObservationRows([...beforeRows.reverse(), ...anchorAndAfterRows]);
  }

  loadMissingIsolationRows(): ObservationRow[] {
    return this.db
      .prepare(
        `
        SELECT *
        FROM observations
        WHERE workspace_id = 'unknown'
           OR workspace_root = ''
      `,
      )
      .all() as ObservationRow[];
  }

  updateIsolation(
    inputs: Array<{
      id: number;
      workspaceRoot: string;
      workspaceId: string;
      visibility: ObservationRecord["visibility"];
      sensitivity: ObservationRecord["sensitivity"];
      scopePolicy: ObservationRecord["scopePolicy"];
    }>,
  ): number {
    if (inputs.length === 0) return 0;

    const stmt = this.db.prepare(`
      UPDATE observations
      SET workspace_root = @workspaceRoot,
          workspace_id = @workspaceId,
          visibility = @visibility,
          sensitivity = @sensitivity,
          scope_policy = @scopePolicy
      WHERE id = @id
    `);

    const tx = this.db.transaction((rows: typeof inputs) => {
      let changed = 0;
      for (const row of rows) {
        changed += stmt.run(row).changes;
      }
      return changed;
    });

    return tx(inputs);
  }
}
