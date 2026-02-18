# codex-mem SPEC

## Goal

Build a persistent memory system for Codex sessions that mirrors claude-mem behavior:

- Automatically capture useful session history across runs
- Persist memory in local SQLite + FTS5
- Provide token-efficient retrieval flows (`search` -> `timeline` -> `get_observations`)
- Expose memory via MCP tools so Codex can query prior work in-session

## Scope

### In scope

- Local memory database in `~/.codex-mem/codex-mem.db` (override via env)
- Incremental ingest from Codex logs:
  - `~/.codex/sessions/**/*.jsonl`
  - `~/.codex/archived_sessions/*.jsonl`
  - `~/.codex/history.jsonl`
- CLI commands for sync and retrieval
- MCP stdio server with memory tools
- Manual memory save command/tool
- Local dashboard UI over HTTP for memory exploration

### Out of scope (v1)

- Direct mutation of Codex internals
- Cloud sync or multi-device replication

## Data Flow

1. **Input**
- JSONL events from Codex session/history files

2. **Transform**
- Parse event type
- Extract normalized observation fields:
  - `session_id`, `cwd`, `type`, `title`, `text`, `metadata_json`, `created_at`
- Truncate oversized payload text to bounded max length
- Skip empty/noise entries

3. **Storage**
- Insert observations into SQLite table
- Mirror searchable text into FTS5 virtual table
- Persist per-file ingest offsets in `source_offsets` to avoid duplicate imports

4. **Retrieval**
- `search`: compact index + metadata
- `timeline`: chronological context around anchor
- `get_observations`: full details by IDs
- `context`: Markdown summary for prompt injection/manual use

## Contracts

Contracts are centralized in `src/contracts.ts` and reused across CLI parsing, dashboard HTTP validation, and MCP tool schemas.

### CLI Commands

- `codex-mem sync`
  - Result JSON: `{ status, filesScanned, observationsInserted }`
- `codex-mem search <query> [--limit N] [--cwd PATH] [--type TYPE] [--json]`
  - Returns compact results with IDs
- `codex-mem timeline <anchorId> [--before N] [--after N] [--json]`
  - Returns ordered observations around anchor
- `codex-mem get <ids...> [--json]`
  - Returns full observations for IDs
- `codex-mem save <text> [--title TITLE] [--cwd PATH] [--json]`
  - Stores manual note as observation type `manual_note`
- `codex-mem context [--cwd PATH] [--limit N] [--query TEXT]`
  - Returns Markdown summary
- `codex-mem stats [--cwd PATH] [--json]`
  - Returns aggregate memory metrics
- `codex-mem projects [--limit N] [--json]`
  - Returns top project scopes by activity
- `codex-mem sessions [--cwd PATH] [--limit N] [--json]`
  - Returns recent sessions with summary metadata
- `codex-mem build-context [--query TEXT] [--cwd PATH] [--limit N] [--session-limit N] [--json]`
  - Returns structured context pack (highlights + notes + sessions + markdown)
- `codex-mem worker [--interval-seconds N] [--run-once] [--json]`
  - Runs periodic ingestion sync in daemon-like mode
- `codex-mem mcp-server`
  - Runs MCP stdio server exposing search tools
- `codex-mem init-mcp [--name NAME]`
  - Registers stdio server in Codex via `codex mcp add`
- `codex-mem dashboard [--host HOST] [--port PORT]`
  - Serves dashboard UI and API endpoints for memory browsing

### MCP Tools

- `search`
  - Input: `{ query, limit, cwd, type, offset }`
  - Output: compact index rows
- `timeline`
  - Input: `{ anchor, before, after, cwd }`
  - Output: chronological context rows
- `get_observations`
  - Input: `{ ids: number[] }`
  - Output: full observation objects
- `save_memory`
  - Input: `{ text, title?, cwd? }`
  - Output: save receipt with observation ID
- `stats`
  - Input: `{ cwd? }`
  - Output: aggregate counts + coverage metrics
- `list_projects`
  - Input: `{ limit? }`
  - Output: active project scopes with observation counts
- `recent_sessions`
  - Input: `{ cwd?, limit? }`
  - Output: recent sessions and metadata
- `build_context`
  - Input: `{ query?, cwd?, limit?, sessionLimit? }`
  - Output: structured context pack

### Dashboard HTTP API

- `GET /api/health`
  - Output: `{ status, version, sync, now }`
- `GET /api/search`
  - Query: `{ query?, cwd?, type?, limit?, offset? }`
  - Output: `{ observations }`
- `GET /api/timeline`
  - Query: `{ anchor, before?, after?, cwd? }`
  - Output: `{ observations }`
- `GET /api/context`
  - Query: `{ query?, cwd?, type?, limit? }`
  - Output: `{ context }`
- `GET /api/context_pack`
  - Query: `{ query?, cwd?, limit?, sessionLimit? }`
  - Output: `{ contextPack }`
- `GET /api/stats`
  - Query: `{ cwd? }`
  - Output: `{ stats }`
- `GET /api/projects`
  - Query: `{ limit? }`
  - Output: `{ projects }`
- `GET /api/sessions`
  - Query: `{ cwd?, limit? }`
  - Output: `{ sessions }`
- `GET /api/observation/:id`
  - Output: `{ observation }`
- `GET /api/events`
  - Output: `text/event-stream` sync/sync_error/heartbeat events
- `POST /api/save_memory`
  - Body: `{ text, title?, cwd? }`
  - Output: `{ status: "saved", id }`
- `POST /api/observations/batch`
  - Body: `{ ids: number[] }`
  - Output: `{ observations }`

## Error Format

All JSON errors use:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable message"
  }
}
```

## Security Constraints

- No execution of ingested text
- Parameterized SQL statements only
- Payload size caps for request bodies and stored text
- Local-only data paths by default

## Acceptance Criteria

1. `sync` ingests real Codex session data and persists observations.
2. Re-running `sync` without new data does not duplicate rows.
3. `search` returns relevant matches with observation IDs.
4. `timeline` returns deterministic chronological windows around anchors.
5. `get_observations` returns full details for IDs.
6. `mcp-server` exposes and executes search/timeline/get/save plus stats/projects/sessions/context tools.
7. Worker `run-once` and repeated sync flows ingest new appended session entries without duplication.
8. Dashboard serves modular frontend assets and contract-validated API endpoints (including stats/projects/sessions/context_pack/observation/events).
9. Tests cover importer, dedupe, search, timeline, manual save, worker sync cycles, and dashboard API surface.
