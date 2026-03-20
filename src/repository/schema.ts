import type Database from "better-sqlite3";

export function initializeRepositorySchema(db: Database.Database): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL DEFAULT '',
        workspace_root TEXT NOT NULL DEFAULT '',
        workspace_id TEXT NOT NULL DEFAULT 'unknown',
        visibility TEXT NOT NULL DEFAULT 'workspace_only',
        sensitivity TEXT NOT NULL DEFAULT 'restricted',
        scope_policy TEXT NOT NULL DEFAULT 'exact_workspace',
        role TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_observations_created
        ON observations(created_at_epoch DESC);
      CREATE INDEX IF NOT EXISTS idx_observations_type
        ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_session
        ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_cwd
        ON observations(cwd);
      CREATE INDEX IF NOT EXISTS idx_observations_workspace_id
        ON observations(workspace_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_dedupe
        ON observations(source, session_id, type, created_at_epoch, text);

      CREATE TABLE IF NOT EXISTS source_offsets (
        source_path TEXT PRIMARY KEY,
        last_offset INTEGER NOT NULL DEFAULT 0,
        last_mtime_ms INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS durable_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        observation_id INTEGER NOT NULL,
        memory_class TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        cwd TEXT NOT NULL DEFAULT '',
        workspace_root TEXT NOT NULL DEFAULT '',
        workspace_id TEXT NOT NULL DEFAULT 'unknown',
        visibility TEXT NOT NULL DEFAULT 'workspace_only',
        sensitivity TEXT NOT NULL DEFAULT 'restricted',
        scope_policy TEXT NOT NULL DEFAULT 'exact_workspace',
        trust_level REAL NOT NULL DEFAULT 0.5,
        scope TEXT NOT NULL DEFAULT 'project',
        source_kind TEXT NOT NULL,
        supersedes_json TEXT NOT NULL DEFAULT '[]',
        related_paths_json TEXT NOT NULL DEFAULT '[]',
        related_topics_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'candidate',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_memories_observation_class
        ON durable_memories(observation_id, memory_class);
      CREATE INDEX IF NOT EXISTS idx_durable_memories_status
        ON durable_memories(status);
      CREATE INDEX IF NOT EXISTS idx_durable_memories_cwd
        ON durable_memories(cwd);
      CREATE INDEX IF NOT EXISTS idx_durable_memories_workspace_id
        ON durable_memories(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_durable_memories_class
        ON durable_memories(memory_class);
    `);

  ensureColumn(db, "observations", "workspace_root", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "observations", "workspace_id", "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn(db, "observations", "visibility", "TEXT NOT NULL DEFAULT 'workspace_only'");
  ensureColumn(db, "observations", "sensitivity", "TEXT NOT NULL DEFAULT 'restricted'");
  ensureColumn(db, "observations", "scope_policy", "TEXT NOT NULL DEFAULT 'exact_workspace'");
  ensureColumn(db, "durable_memories", "workspace_root", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "durable_memories", "workspace_id", "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn(db, "durable_memories", "visibility", "TEXT NOT NULL DEFAULT 'workspace_only'");
  ensureColumn(db, "durable_memories", "sensitivity", "TEXT NOT NULL DEFAULT 'restricted'");
  ensureColumn(db, "durable_memories", "scope_policy", "TEXT NOT NULL DEFAULT 'exact_workspace'");
  db.exec(`
      CREATE INDEX IF NOT EXISTS idx_observations_workspace_id
        ON observations(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_durable_memories_workspace_id
        ON durable_memories(workspace_id);
    `);

  try {
    db.exec(`
        CREATE VIRTUAL TABLE observations_fts USING fts5(
          title,
          text,
          content='observations',
          content_rowid='id'
        );
      `);
  } catch {
    // Already exists.
  }

  db.exec(`
      CREATE TRIGGER IF NOT EXISTS observations_ai
      AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, text)
        VALUES (new.id, new.title, new.text);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_ad
      AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, text)
        VALUES ('delete', old.id, old.title, old.text);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_au
      AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, text)
        VALUES ('delete', old.id, old.title, old.text);
        INSERT INTO observations_fts(rowid, title, text)
        VALUES (new.id, new.title, new.text);
      END;
    `);
}

function ensureColumn(
  db: Database.Database,
  table: "observations" | "durable_memories",
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
