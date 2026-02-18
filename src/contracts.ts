import { z } from "zod";

export const OBSERVATION_TYPES = [
  "user_message",
  "assistant_message",
  "tool_call",
  "tool_output",
  "manual_note",
] as const;

export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export const observationTypeSchema = z.enum(OBSERVATION_TYPES);

export const searchInputSchema = z.object({
  query: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  type: observationTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
});

export type SearchInput = z.infer<typeof searchInputSchema>;

export const timelineInputSchema = z.object({
  anchor: z.number().int().positive(),
  before: z.number().int().min(1).max(200).optional(),
  after: z.number().int().min(1).max(200).optional(),
  cwd: z.string().min(1).optional(),
});

export type TimelineInput = z.infer<typeof timelineInputSchema>;

export const getObservationsInputSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
});

export type GetObservationsInput = z.infer<typeof getObservationsInputSchema>;

export const saveMemoryInputSchema = z.object({
  text: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  cwd: z.string().trim().min(1).optional(),
});

export type SaveMemoryInput = z.infer<typeof saveMemoryInputSchema>;

export const contextInputSchema = z.object({
  query: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  type: observationTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type ContextInput = z.infer<typeof contextInputSchema>;

export const dashboardSearchParamsSchema = searchInputSchema;

export type DashboardSearchParams = z.infer<typeof dashboardSearchParamsSchema>;

export const dashboardTimelineParamsSchema = timelineInputSchema;

export type DashboardTimelineParams = z.infer<typeof dashboardTimelineParamsSchema>;

export const dashboardContextParamsSchema = contextInputSchema;

export type DashboardContextParams = z.infer<typeof dashboardContextParamsSchema>;

export const dashboardSaveMemoryBodySchema = saveMemoryInputSchema;

export type DashboardSaveMemoryBody = z.infer<typeof dashboardSaveMemoryBodySchema>;

export const dashboardBatchBodySchema = getObservationsInputSchema;

export type DashboardBatchBody = z.infer<typeof dashboardBatchBodySchema>;

export const statsParamsSchema = z.object({
  cwd: z.string().min(1).optional(),
});

export type StatsParams = z.infer<typeof statsParamsSchema>;

export const projectListParamsSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

export type ProjectListParams = z.infer<typeof projectListParamsSchema>;

export const sessionListParamsSchema = z.object({
  cwd: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export type SessionListParams = z.infer<typeof sessionListParamsSchema>;

export const buildContextInputSchema = z.object({
  query: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sessionLimit: z.number().int().min(1).max(50).optional(),
});

export type BuildContextInput = z.infer<typeof buildContextInputSchema>;
