import type Database from "better-sqlite3";
import type { SourceOffsetRecord } from "../types.js";
import { mapOffsetRow } from "./mappers.js";
import type { OffsetRow } from "./rows.js";

export class SourceOffsetStore {
  constructor(private readonly db: Database.Database) {}

  getOffset(sourcePath: string): SourceOffsetRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT source_path, last_offset, last_mtime_ms
        FROM source_offsets
        WHERE source_path = ?
      `,
      )
      .get(sourcePath) as OffsetRow | undefined;

    return row ? mapOffsetRow(row) : null;
  }

  upsertOffset(sourcePath: string, lastOffset: number, lastMtimeMs: number): void {
    this.db
      .prepare(
        `
        INSERT INTO source_offsets (source_path, last_offset, last_mtime_ms)
        VALUES (?, ?, ?)
        ON CONFLICT(source_path)
        DO UPDATE SET
          last_offset = excluded.last_offset,
          last_mtime_ms = excluded.last_mtime_ms
      `,
      )
      .run(sourcePath, lastOffset, lastMtimeMs);
  }
}
