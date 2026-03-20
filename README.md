# codex-mem

Persistent memory for Codex sessions.

`codex-mem` ingests local Codex session/history logs into SQLite + FTS5, then exposes memory through CLI commands and MCP tools.

For the shared live Codex store, normal access is now daemon-backed:
- `codex-mem daemon` owns the SQLite DB
- `codex-mem mcp-server` is a stdio proxy to the daemon
- normal CLI retrieval/save commands proxy to the daemon when using `~/.codex-mem`
- maintenance commands keep direct ownership and require exclusive maintenance mode

## Features

- Incremental ingest from `~/.codex/sessions`, `~/.codex/archived_sessions`, and `~/.codex/history.jsonl`
- Persistent local store: `~/.codex-mem/codex-mem.db`
- Token-efficient retrieval flow:
  - `search` (index)
  - `timeline` (context)
  - `get_observations` (full details)
- MCP server for in-session retrieval by Codex
- Single daemon ownership for the shared live Codex store
- Manual `save_memory` support
- Background worker mode for automatic sync polling
- Browser dashboard with live SSE status, project/session lens, timeline drill-down, and context preview
- Shared API contracts/schemas across CLI, dashboard HTTP, and MCP tool inputs (API-first boundary validation)

## Install

```bash
cd /Users/chadsimon/code/codex-mem
npm install
npm run build
npm link
```

## Debian Docker Runtime

Run codex-mem in a Debian container with troubleshooting tools preinstalled (`sqlite3`, `lsof`, `strace`, `procps`, `dnsutils`, `jq`, `netcat`, and more).

### Build image

```bash
cd /Users/chadsimon/code/codex-mem
docker compose -f docker-compose.debian.yml build codex-mem-shell
```

### Start worker + dashboard

```bash
docker compose -f docker-compose.debian.yml up -d codex-mem-worker codex-mem-dashboard
```

Dashboard URL: `http://127.0.0.1:37811`

### Open a troubleshooting shell

```bash
docker compose -f docker-compose.debian.yml run --rm codex-mem-shell
```

### Follow logs

```bash
docker compose -f docker-compose.debian.yml logs -f codex-mem-worker codex-mem-dashboard
```

### Stop services

```bash
docker compose -f docker-compose.debian.yml down
```

## Register MCP Server With Codex

```bash
codex-mem init-mcp
```

Equivalent manual command:

```bash
codex mcp add codex-mem -- node /path/to/codex-mem/dist/cli.js mcp-server
```

Equivalent Docker-backed command (Debian container):

```bash
codex mcp add codex-mem-docker -- /Users/chadsimon/code/codex-mem/docker/mcp-server.sh
```

## CLI

```bash
codex-mem sync --json
codex-mem search "schema migration" --limit 10 --json
codex-mem timeline 42 --before 8 --after 8 --json
codex-mem get 40 41 42 --json
codex-mem save "Use migration lock before batch writes" --title "migration lock" --json
codex-mem context --cwd /Users/chadsimon/code --limit 8
codex-mem stats --cwd /Users/chadsimon/code --json
codex-mem projects --limit 20 --json
codex-mem sessions --cwd /Users/chadsimon/code --limit 20 --json
codex-mem build-context --query "schema migration" --session-limit 5 --json
codex-mem worker --interval-seconds 15
codex-mem daemon --json
codex-mem ensure-daemon --json
codex-mem daemon-status --json
codex-mem dashboard --host 127.0.0.1 --port 37811
codex-mem mcp-server
```

`search` excludes `tool_call`/`tool_output` noise by default; pass `--type tool_call` or `--type tool_output` when you want raw tool traces.
`dashboard` defaults to `http://127.0.0.1:37811`.
`status --json` now includes both DB/service-path health and daemon health.

For the shared live store:
- `dashboard` direct DB access is blocked until it is migrated to a daemon-backed path
- transient CLI/MCP startup does not create prestart snapshots
- incident bundles are written under `~/.codex-mem/incidents/`

## MCP Tools

- `search(query, limit, offset, cwd, type)`
- `timeline(anchor, before, after, cwd)`
- `get_observations(ids)`
- `save_memory(text, title, cwd)`
- `stats(cwd)`
- `list_projects(limit)`
- `recent_sessions(cwd, limit)`
- `build_context(query, cwd, limit, sessionLimit)`

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Architecture

1. Importer reads JSONL events incrementally using per-file offsets.
2. Repository stores normalized observations in SQLite.
3. FTS5 powers full-text retrieval.
4. Service layer orchestrates sync + retrieval.
5. Contracts layer defines canonical observation/API schemas.
6. The daemon owns the live DB, while CLI and MCP proxy normal operations to it for the shared Codex store.
7. Maintenance commands operate directly only under exclusive ownership.
8. Dashboard frontend is split into modules (`api`, `controller`, `dom`, `render`, `state`) and loaded via static module assets.

## Notes

- v1 focuses on local-first persistence and retrieval.
- No Codex internals are modified.
