import type Database from "better-sqlite3";

export function initializeRepositorySchema(db: Database.Database): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL DEFAULT '',
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_dedupe
        ON observations(source, session_id, type, created_at_epoch, text);

      CREATE TABLE IF NOT EXISTS source_offsets (
        source_path TEXT PRIMARY KEY,
        last_offset INTEGER NOT NULL DEFAULT 0,
        last_mtime_ms INTEGER NOT NULL DEFAULT 0
      );
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
