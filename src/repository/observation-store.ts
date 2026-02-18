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

export class ObservationStore {
  constructor(private readonly db: Database.Database) {}

  getLatestSessionContext(source: string): { sessionId: string; cwd: string } | null {
    const row = this.db
      .prepare(
        `
        SELECT session_id, cwd
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
        const result = stmt.run(row);
        inserted += result.changes;
      }
      return inserted;
    });

    return tx(observations);
  }

  saveManualNote(input: {
    text: string;
    title?: string | undefined;
    cwd?: string | undefined;
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
        'user',
        'manual_note',
        ?,
        ?,
        '{}',
        ?,
        ?
      )
      RETURNING id
    `,
      )
      .get(
        input.cwd ?? "",
        input.title ?? "",
        input.text,
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
            SELECT o.*
            FROM observations o
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
          SELECT *
          FROM observations
          WHERE (? = '' OR cwd = ?)
            AND (? = '' OR type = ?)
            AND (? = 1 OR type NOT IN ('tool_call', 'tool_output'))
          ORDER BY created_at_epoch DESC
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
      SELECT *
      FROM observations
      WHERE id IN (${placeholders})
      ORDER BY created_at_epoch DESC
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
        SELECT *
        FROM observations
        WHERE created_at_epoch < ?
          AND (? = '' OR cwd = ?)
        ORDER BY created_at_epoch DESC
        LIMIT ?
      `,
      )
      .all(anchor.created_at_epoch, cwd, cwd, before) as ObservationRow[];

    const anchorAndAfterRows = this.db
      .prepare(
        `
        SELECT *
        FROM observations
        WHERE created_at_epoch >= ?
          AND (? = '' OR cwd = ?)
        ORDER BY created_at_epoch ASC
        LIMIT ?
      `,
      )
      .all(anchor.created_at_epoch, cwd, cwd, after + 1) as ObservationRow[];

    const ordered = [...beforeRows.reverse(), ...anchorAndAfterRows];
    return mapObservationRows(ordered);
  }
}
