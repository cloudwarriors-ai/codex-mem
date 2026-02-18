import { describe, expect, it } from "vitest";
import { buildFtsQuery } from "../src/utils.js";

describe("buildFtsQuery", () => {
  it("sanitizes punctuation-heavy queries into safe tokenized FTS terms", () => {
    expect(buildFtsQuery("follow-up entry")).toBe('"follow" AND "up" AND "entry"');
    expect(buildFtsQuery('api:(migration)^rollback*')).toBe('"api" AND "migration" AND "rollback"');
  });

  it("returns empty query when no usable tokens exist", () => {
    expect(buildFtsQuery("   ")).toBe("");
    expect(buildFtsQuery("***")).toBe("");
  });
});
