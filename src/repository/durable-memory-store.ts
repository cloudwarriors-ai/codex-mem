import type Database from "better-sqlite3";
import { mapDurableMemoryRows } from "./mappers.js";
import type {
  DurableMemoryRecord,
  DurableMemoryScope,
  DurableMemorySourceKind,
  MemoryClass,
} from "../types.js";
import type { DurableMemoryRow, ObservationRow } from "./rows.js";

interface UpsertDurableMemoryInput {
  observationId: number;
  memoryClass: MemoryClass;
  title: string;
  body: string;
  cwd?: string | undefined;
  workspaceRoot: string;
  workspaceId: string;
  visibility: DurableMemoryRecord["visibility"];
  sensitivity: DurableMemoryRecord["sensitivity"];
  scopePolicy: DurableMemoryRecord["scopePolicy"];
  trustLevel: number;
  scope: DurableMemoryScope;
  sourceKind: DurableMemorySourceKind;
  supersedes?: string[] | undefined;
  relatedPaths?: string[] | undefined;
  relatedTopics?: string[] | undefined;
  status: DurableMemoryRecord["status"];
  createdAt: string;
  updatedAt: string;
}

export class DurableMemoryStore {
  constructor(private readonly db: Database.Database) {}

  backfillFromObservations(inputs: UpsertDurableMemoryInput[]): number {
    if (inputs.length === 0) return 0;

    const stmt = this.db.prepare(`
      INSERT INTO durable_memories (
        observation_id,
        memory_class,
        title,
        body,
        cwd,
        workspace_root,
        workspace_id,
        visibility,
        sensitivity,
        scope_policy,
        trust_level,
        scope,
        source_kind,
        supersedes_json,
        related_paths_json,
        related_topics_json,
        status,
        created_at,
        updated_at
      ) VALUES (
        @observationId,
        @memoryClass,
        @title,
        @body,
        @cwd,
        @workspaceRoot,
        @workspaceId,
        @visibility,
        @sensitivity,
        @scopePolicy,
        @trustLevel,
        @scope,
        @sourceKind,
        @supersedesJson,
        @relatedPathsJson,
        @relatedTopicsJson,
        @status,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(observation_id, memory_class) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        cwd = excluded.cwd,
        workspace_root = excluded.workspace_root,
        workspace_id = excluded.workspace_id,
        visibility = excluded.visibility,
        sensitivity = excluded.sensitivity,
        scope_policy = excluded.scope_policy,
        trust_level = excluded.trust_level,
        scope = excluded.scope,
        source_kind = excluded.source_kind,
        supersedes_json = excluded.supersedes_json,
        related_paths_json = excluded.related_paths_json,
        related_topics_json = excluded.related_topics_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    const tx = this.db.transaction((rows: UpsertDurableMemoryInput[]) => {
      let changed = 0;
      for (const row of rows) {
        changed += stmt.run(toDbRow(row)).changes;
      }
      return changed;
    });

    return tx(inputs);
  }

  listForObservationIds(
    ids: number[],
    statuses: DurableMemoryRecord["status"][] = ["active"],
  ): DurableMemoryRecord[] {
    if (ids.length === 0 || statuses.length === 0) return [];
    const idPlaceholders = ids.map(() => "?").join(",");
    const statusPlaceholders = statuses.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM durable_memories
        WHERE observation_id IN (${idPlaceholders})
          AND status IN (${statusPlaceholders})
      `,
      )
      .all(...ids, ...statuses) as DurableMemoryRow[];

    return mapDurableMemoryRows(rows);
  }

  listCandidates(limit = 100): DurableMemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM durable_memories
        WHERE status = 'candidate'
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `,
      )
      .all(limit) as DurableMemoryRow[];

    return mapDurableMemoryRows(rows);
  }

  loadBackfillObservations(): ObservationRow[] {
    return this.db
      .prepare(
        `
        SELECT o.*
        FROM observations o
        LEFT JOIN durable_memories dm
          ON dm.observation_id = o.id
        WHERE o.type = 'manual_note'
          AND dm.id IS NULL
        ORDER BY o.created_at_epoch ASC, o.id ASC
      `,
      )
      .all() as ObservationRow[];
  }

  loadMissingIsolationRows(): DurableMemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM durable_memories
        WHERE workspace_id = 'unknown'
           OR workspace_root = ''
      `,
      )
      .all() as DurableMemoryRow[];

    return mapDurableMemoryRows(rows);
  }

  updateIsolation(
    inputs: Array<{
      id: number;
      workspaceRoot: string;
      workspaceId: string;
      visibility: DurableMemoryRecord["visibility"];
      sensitivity: DurableMemoryRecord["sensitivity"];
      scopePolicy: DurableMemoryRecord["scopePolicy"];
    }>,
  ): number {
    if (inputs.length === 0) return 0;

    const stmt = this.db.prepare(`
      UPDATE durable_memories
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

function toDbRow(input: UpsertDurableMemoryInput) {
  return {
    ...input,
    cwd: input.cwd ?? "",
    supersedesJson: JSON.stringify(input.supersedes ?? []),
    relatedPathsJson: JSON.stringify(input.relatedPaths ?? []),
    relatedTopicsJson: JSON.stringify(input.relatedTopics ?? []),
  };
}
