import { describe, expect, it } from "vitest";
import {
  OBSERVATION_TYPES,
  buildContextInputSchema,
  contextInputSchema,
  dashboardBatchBodySchema,
  dashboardSaveMemoryBodySchema,
  dashboardSearchParamsSchema,
  getObservationsInputSchema,
  listPreferencesInputSchema,
  observationTypeSchema,
  preferenceNoteV1Schema,
  resolvePreferencesInputSchema,
  saveMemoryInputSchema,
  savePreferenceInputSchema,
  searchInputSchema,
  timelineInputSchema,
} from "../src/contracts.js";

describe("contracts", () => {
  it("defines observation types in one canonical list", () => {
    expect(OBSERVATION_TYPES).toEqual([
      "user_message",
      "assistant_message",
      "tool_call",
      "tool_output",
      "manual_note",
    ]);
    expect(observationTypeSchema.parse("manual_note")).toBe("manual_note");
  });

  it("validates dashboard search params contract", () => {
    const parsed = dashboardSearchParamsSchema.parse({
      query: "schema migration",
      limit: 20,
      type: "assistant_message",
    });
    expect(parsed.type).toBe("assistant_message");

    expect(() =>
      dashboardSearchParamsSchema.parse({
        type: "invalid_type",
      }),
    ).toThrow();
  });

  it("validates save and batch request contracts", () => {
    const save = dashboardSaveMemoryBodySchema.parse({
      text: "  remember this  ",
      title: "  note ",
    });
    expect(save.text).toBe("remember this");
    expect(save.title).toBe("note");

    expect(() => dashboardBatchBodySchema.parse({ ids: [] })).toThrow();
    const batch = dashboardBatchBodySchema.parse({ ids: ["1", 2] });
    expect(batch.ids).toEqual([1, 2]);
  });

  it("reuses API-first contracts across search/timeline/context/saves", () => {
    const search = searchInputSchema.parse({
      query: "memory stream",
      type: "assistant_message",
      limit: 10,
      offset: 0,
    });
    expect(search.query).toBe("memory stream");

    const timeline = timelineInputSchema.parse({
      anchor: 42,
      before: 4,
      after: 4,
    });
    expect(timeline.anchor).toBe(42);

    const save = saveMemoryInputSchema.parse({
      text: "  keep this note  ",
      cwd: " /tmp/project ",
    });
    expect(save.text).toBe("keep this note");
    expect(save.cwd).toBe("/tmp/project");

    const context = contextInputSchema.parse({
      query: "schema migration",
      type: "manual_note",
      limit: 8,
    });
    expect(context.type).toBe("manual_note");

    const byIds = getObservationsInputSchema.parse({ ids: ["3", 9] });
    expect(byIds.ids).toEqual([3, 9]);

    const buildContext = buildContextInputSchema.parse({
      sessionLimit: 6,
      limit: 12,
      preferenceKeys: ["pref:frontend.iteration_size"],
      preferenceLimit: 3,
    });
    expect(buildContext.sessionLimit).toBe(6);
    expect(buildContext.preferenceKeys?.[0]).toBe("pref:frontend.iteration_size");

    expect(() => timelineInputSchema.parse({ anchor: 0 })).toThrow();
    expect(() => contextInputSchema.parse({ type: "nope" })).toThrow();
  });

  it("validates pref-note.v1 contracts and preference endpoints", () => {
    const savePreference = savePreferenceInputSchema.parse({
      schema_version: "pref-note.v1",
      key: "pref:frontend.iteration_size",
      scope: "project",
      trigger: "When implementing UI changes",
      preferred: "Change one region per iteration",
      avoid: "Multi-region rewrites",
      example_good: "Refactor the menu card only",
      example_bad: "Rewrite all pages in one pass",
      confidence: 0.9,
      source: "user",
      supersedes: ["14"],
    });
    expect(savePreference.scope).toBe("project");
    expect(savePreference.key).toBe("pref:frontend.iteration_size");

    const note = preferenceNoteV1Schema.parse({
      ...savePreference,
      created_at: "2026-03-01T00:00:00.000Z",
    });
    expect(note.schema_version).toBe("pref-note.v1");

    const list = listPreferencesInputSchema.parse({
      key: "pref:frontend.iteration_size",
      include_superseded: false,
    });
    expect(list.key).toBe("pref:frontend.iteration_size");

    const resolve = resolvePreferencesInputSchema.parse({
      keys: ["pref:frontend.iteration_size"],
      limit: 5,
    });
    expect(resolve.keys?.length).toBe(1);

    expect(() =>
      savePreferenceInputSchema.parse({
        schema_version: "pref-note.v1",
        key: "frontend.iteration_size",
        scope: "project",
        trigger: "bad key",
        preferred: "foo",
        avoid: "bar",
        example_good: "good",
        example_bad: "bad",
        confidence: 0.5,
        source: "user",
        supersedes: [],
      }),
    ).toThrow();
  });
});
