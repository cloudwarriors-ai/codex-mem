import {
  buildContextInputSchema,
  dashboardBatchBodySchema,
  dashboardContextParamsSchema,
  dashboardSaveMemoryBodySchema,
  dashboardSearchParamsSchema,
  dashboardTimelineParamsSchema,
  projectListParamsSchema,
  sessionListParamsSchema,
  statsParamsSchema,
  type BuildContextInput,
  type DashboardBatchBody,
  type DashboardContextParams,
  type DashboardSaveMemoryBody,
  type DashboardSearchParams,
  type DashboardTimelineParams,
  type ProjectListParams,
  type SessionListParams,
  type StatsParams,
} from "../contracts.js";

export function parseSearchParams(url: URL): DashboardSearchParams {
  return dashboardSearchParamsSchema.parse({
    query: getOptionalString(url, "query"),
    cwd: getOptionalString(url, "cwd"),
    type: getOptionalString(url, "type"),
    limit: getOptionalInt(url, "limit"),
    offset: getOptionalInt(url, "offset"),
    scopeMode: getOptionalString(url, "scopeMode"),
  });
}

export function parseTimelineParams(url: URL): DashboardTimelineParams {
  return dashboardTimelineParamsSchema.parse({
    anchor: getRequiredInt(url, "anchor"),
    before: getOptionalInt(url, "before"),
    after: getOptionalInt(url, "after"),
    cwd: getOptionalString(url, "cwd"),
    scopeMode: getOptionalString(url, "scopeMode"),
  });
}

export function parseContextParams(url: URL): DashboardContextParams {
  return dashboardContextParamsSchema.parse({
    query: getOptionalString(url, "query"),
    cwd: getOptionalString(url, "cwd"),
    type: getOptionalString(url, "type"),
    limit: getOptionalInt(url, "limit"),
    scopeMode: getOptionalString(url, "scopeMode"),
  });
}

export function parseSaveMemoryBody(body: Record<string, unknown>): DashboardSaveMemoryBody {
  return dashboardSaveMemoryBodySchema.parse({
    text: body.text,
    title: body.title,
    cwd: body.cwd,
  });
}

export function parseBatchBody(body: Record<string, unknown>): DashboardBatchBody {
  return dashboardBatchBodySchema.parse({
    ids: body.ids,
  });
}

export function parseStatsParams(url: URL): StatsParams {
  return statsParamsSchema.parse({
    cwd: getOptionalString(url, "cwd"),
    scopeMode: getOptionalString(url, "scopeMode"),
  });
}

export function parseProjectListParams(url: URL): ProjectListParams {
  return projectListParamsSchema.parse({
    limit: getOptionalInt(url, "limit"),
  });
}

export function parseSessionListParams(url: URL): SessionListParams {
  return sessionListParamsSchema.parse({
    cwd: getOptionalString(url, "cwd"),
    limit: getOptionalInt(url, "limit"),
    scopeMode: getOptionalString(url, "scopeMode"),
  });
}

export function parseBuildContextParams(url: URL): BuildContextInput {
  return buildContextInputSchema.parse({
    query: getOptionalString(url, "query"),
    cwd: getOptionalString(url, "cwd"),
    limit: getOptionalInt(url, "limit"),
    sessionLimit: getOptionalInt(url, "sessionLimit"),
    scopeMode: getOptionalString(url, "scopeMode"),
  });
}

function getOptionalString(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getOptionalInt(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : Number.NaN;
}

function getRequiredInt(url: URL, key: string): number {
  const value = getOptionalInt(url, key);
  if (value === undefined) return Number.NaN;
  return value;
}
