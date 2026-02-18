import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";

const MAX_BODY_BYTES = 64 * 1024;

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export function writeJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

export function writeHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

export function writeCss(res: ServerResponse, css: string): void {
  res.writeHead(200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(css);
}

export function writeJavascript(res: ServerResponse, code: string): void {
  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(code);
}

export function writeError(res: ServerResponse, status: number, code: string, message: string): void {
  writeJson(res, status, {
    error: {
      code,
      message,
    },
  });
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > MAX_BODY_BYTES) {
      throw new InputError("Payload too large");
    }
    chunks.push(buf);
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new InputError("Malformed JSON body");
  }
}

export function requireJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputError("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function normalizeInputError(error: unknown): InputError | null {
  if (error instanceof InputError) return error;
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue?.path?.length ? issue.path.join(".") : "request";
    const reason = issue?.message ?? "Invalid input";
    return new InputError(`${where}: ${reason}`);
  }
  return null;
}
