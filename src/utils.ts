import { basename } from "node:path";
import { MAX_STORED_TEXT_LENGTH } from "./config.js";

const FTS_TOKEN_SANITIZER = /[^\p{L}\p{N}_]+/gu;

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateText(value: string, maxLen = MAX_STORED_TEXT_LENGTH): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}\n...[truncated]`;
}

export function createTitle(value: string, maxLen = 120): string {
  if (!value) return "";
  const firstLine = normalizeWhitespace(value.split("\n", 1)[0] ?? "");
  return firstLine.slice(0, maxLen);
}

export function buildFtsQuery(raw: string): string {
  const tokens = normalizeWhitespace(raw)
    .replace(FTS_TOKEN_SANITIZER, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 10);

  if (tokens.length === 0) return "";
  return tokens.map((token) => `"${token}"`).join(" AND ");
}

export function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function isJsonlFile(path: string): boolean {
  return path.endsWith(".jsonl");
}

export function isHistoryFile(path: string): boolean {
  return basename(path) === "history.jsonl";
}

export function nowIso(): string {
  return new Date().toISOString();
}
