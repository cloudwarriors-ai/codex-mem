import { createReadStream } from "node:fs";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { ObservationInsert, SyncResult } from "./types.js";
import { MemoryRepository } from "./db.js";
import { createTitle, isHistoryFile, normalizeWhitespace, safeJsonParse, truncateText } from "./utils.js";
import {
  defaultScopePolicyForVisibility,
  defaultSensitivityForIdentity,
  defaultVisibilityForMemory,
  resolveWorkspaceIdentity,
} from "./workspace-identity.js";

interface SessionState {
  sessionId: string;
  cwd: string;
}

interface SessionLine {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

interface HistoryLine {
  session_id?: string;
  ts?: number;
  text?: string;
}

interface ObservationContext {
  source: string;
  sessionId: string;
  cwd: string;
  createdAt: string;
  createdAtEpoch: number;
}

export class CodexImporter {
  constructor(
    private readonly repo: MemoryRepository,
    private readonly codexHome: string,
  ) {}

  async syncAll(): Promise<SyncResult> {
    const files = collectSourceFiles(this.codexHome);

    let observationsInserted = 0;
    for (const filePath of files) {
      observationsInserted += await this.syncFile(filePath);
    }

    return {
      status: "ok",
      filesScanned: files.length,
      observationsInserted,
    };
  }

  async syncFile(filePath: string): Promise<number> {
    if (!existsSync(filePath)) return 0;

    const stat = statSync(filePath);
    const currentOffset = this.repo.getOffset(filePath);
    const startOffset = normalizeOffset(stat.size, stat.mtimeMs, currentOffset);

    if (startOffset >= stat.size) {
      this.repo.upsertOffset(filePath, stat.size, stat.mtimeMs);
      return 0;
    }

    const sessionState: SessionState = {
      sessionId: deriveSessionIdFromPath(filePath),
      cwd: "",
    };

    if (!isHistoryFile(filePath) && startOffset > 0) {
      const source = `session:${basename(filePath)}`;
      const previousContext = this.repo.getLatestSessionContext(source);
      if (previousContext) {
        sessionState.sessionId = previousContext.sessionId || sessionState.sessionId;
        sessionState.cwd = previousContext.cwd || sessionState.cwd;
      }
    }

    const rows: ObservationInsert[] = [];

    for await (const line of readLines(filePath, startOffset)) {
      const parsed = safeJsonParse<SessionLine | HistoryLine>(line);
      if (!parsed) continue;

      if (isHistoryFile(filePath)) {
        const row = this.fromHistory(filePath, parsed as HistoryLine);
        if (row) rows.push(row);
      } else {
        const row = this.fromSessionLog(filePath, parsed as SessionLine, sessionState);
        if (row) rows.push(row);
      }
    }

    const inserted = this.repo.insertObservations(rows);
    this.repo.upsertOffset(filePath, stat.size, stat.mtimeMs);
    return inserted;
  }

  private fromHistory(filePath: string, line: HistoryLine): ObservationInsert | null {
    const text = normalizeWhitespace(line.text ?? "");
    if (!text) return null;

    const createdAtEpoch = toEpochMs(line.ts);
    const createdAt = new Date(createdAtEpoch).toISOString();

    return {
      source: `history:${basename(filePath)}`,
      sessionId: line.session_id ?? "",
      cwd: "",
      workspaceRoot: "",
      workspaceId: "unknown",
      visibility: "workspace_only",
      sensitivity: "restricted",
      scopePolicy: "exact_workspace",
      role: "user",
      type: "user_message",
      title: createTitle(text),
      text: truncateText(text),
      metadataJson: "{}",
      createdAt,
      createdAtEpoch,
    };
  }

  private fromSessionLog(
    filePath: string,
    line: SessionLine,
    state: SessionState,
  ): ObservationInsert | null {
    if (this.applySessionStateUpdate(line, state)) {
      return null;
    }

    const context = this.createObservationContext(filePath, line.timestamp, state);

    if (line.type === "event_msg") {
      return this.fromEventMessage(line.payload ?? {}, context);
    }

    if (line.type === "response_item") {
      return this.fromResponseItem(line.payload ?? {}, context);
    }

    return null;
  }

  private applySessionStateUpdate(line: SessionLine, state: SessionState): boolean {
    if (line.type === "session_meta") {
      const payload = line.payload ?? {};
      state.sessionId = stringValue(payload.id) || state.sessionId;
      state.cwd = stringValue(payload.cwd) || state.cwd;
      return true;
    }

    if (line.type === "turn_context") {
      const payload = line.payload ?? {};
      state.cwd = stringValue(payload.cwd) || state.cwd;
      return true;
    }

    return false;
  }

  private createObservationContext(
    filePath: string,
    timestamp: unknown,
    state: SessionState,
  ): ObservationContext {
    const createdAt = normalizeIso(timestamp);
    return {
      source: `session:${basename(filePath)}`,
      sessionId: state.sessionId,
      cwd: state.cwd,
      createdAt,
      createdAtEpoch: new Date(createdAt).getTime(),
    };
  }

  private fromEventMessage(
    payload: Record<string, unknown>,
    context: ObservationContext,
  ): ObservationInsert | null {
    const subtype = stringValue(payload.type);
    const text = normalizeWhitespace(stringValue(payload.message));
    if (!text) return null;

    if (subtype === "user_message") {
      return this.buildObservation(context, {
        role: "user",
        type: "user_message",
        title: createTitle(text),
        text,
      });
    }

    if (subtype === "agent_message") {
      return this.buildObservation(context, {
        role: "assistant",
        type: "assistant_message",
        title: createTitle(text),
        text,
      });
    }

    return null;
  }

  private fromResponseItem(
    payload: Record<string, unknown>,
    context: ObservationContext,
  ): ObservationInsert | null {
    const payloadType = stringValue(payload.type);

    if (payloadType === "function_call") {
      const toolName = stringValue(payload.name);
      const args = stringValue(payload.arguments);
      const text = normalizeWhitespace(`${toolName} ${args}`.trim());
      if (!text) return null;

      return this.buildObservation(context, {
        role: "assistant",
        type: "tool_call",
        title: createTitle(toolName || "tool_call"),
        text,
        metadata: {
          name: toolName,
          call_id: stringValue(payload.call_id),
        },
      });
    }

    if (payloadType !== "function_call_output") return null;

    const output = normalizeWhitespace(stringValue(payload.output));
    if (!output) return null;

    return this.buildObservation(context, {
      role: "tool",
      type: "tool_output",
      title: "tool_output",
      text: output,
      metadata: {
        call_id: stringValue(payload.call_id),
      },
    });
  }

  private buildObservation(
    context: ObservationContext,
    input: {
      role: string;
      type: ObservationInsert["type"];
      title: string;
      text: string;
      metadata?: Record<string, string>;
    },
  ): ObservationInsert {
    const identity = resolveWorkspaceIdentity(context.cwd);
    const visibility = defaultVisibilityForMemory();
    return {
      source: context.source,
      sessionId: context.sessionId,
      cwd: context.cwd,
      workspaceRoot: identity.workspaceRoot,
      workspaceId: identity.workspaceId,
      visibility,
      sensitivity: defaultSensitivityForIdentity(identity),
      scopePolicy: defaultScopePolicyForVisibility(visibility),
      role: input.role,
      type: input.type,
      title: input.title,
      text: truncateText(input.text),
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : "{}",
      createdAt: context.createdAt,
      createdAtEpoch: context.createdAtEpoch,
    };
  }
}

function collectSourceFiles(codexHome: string): string[] {
  const results: string[] = [];

  const sessionsDir = join(codexHome, "sessions");
  const archivedDir = join(codexHome, "archived_sessions");
  const historyPath = join(codexHome, "history.jsonl");

  if (existsSync(sessionsDir)) {
    walkJsonlFiles(sessionsDir, results);
  }

  if (existsSync(archivedDir)) {
    walkJsonlFiles(archivedDir, results);
  }

  if (existsSync(historyPath)) {
    results.push(historyPath);
  }

  results.sort();
  return results;
}

function walkJsonlFiles(root: string, out: string[]): void {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      walkJsonlFiles(fullPath, out);
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".jsonl")) {
      out.push(fullPath);
    }
  }
}

async function* readLines(filePath: string, startOffset: number): AsyncGenerator<string> {
  const stream = createReadStream(filePath, {
    encoding: "utf8",
    start: startOffset,
  });

  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim().length > 0) yield line;
  }
}

function normalizeOffset(
  size: number,
  mtimeMs: number,
  current: { lastOffset: number; lastMtimeMs: number } | null,
): number {
  if (!current) return 0;

  if (!Number.isFinite(current.lastOffset) || current.lastOffset < 0) return 0;
  if (current.lastOffset > size) return 0;

  // File was modified in-place with no size growth; safest fallback is full re-read.
  if (mtimeMs > current.lastMtimeMs && size === current.lastOffset) return 0;

  return current.lastOffset;
}

function deriveSessionIdFromPath(filePath: string): string {
  const match = basename(filePath).match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return match?.[1] ?? "";
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function normalizeIso(value: unknown): string {
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function toEpochMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return Date.now();
  }

  // history.jsonl uses Unix seconds.
  if (value < 10_000_000_000) return value * 1000;
  return value;
}
