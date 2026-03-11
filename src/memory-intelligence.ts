import type {
  DurableMemoryRecord,
  DurableMemoryScope,
  ObservationRecord,
  RetrievalBenchmarkCase,
  RetrievalBenchmarkResult,
  RetrievalConfidenceBand,
  RetrievalSummary,
  ScopeMode,
} from "./types.js";
import { normalizeWhitespace } from "./utils.js";

const DECISION_PATTERNS = [/\bdecid(?:e|ed|ing)\b/i, /\bwe will\b/i, /\bchosen?\b/i];
const FIX_PATTERNS = [/\bfix(?:ed)?\b/i, /\broot cause\b/i, /\bresolved\b/i, /\bworkaround\b/i];
const CONSTRAINT_PATTERNS = [/\bmust\b/i, /\brequire(?:d|ment)?\b/i, /\bdo not\b/i, /\bconstraint\b/i];

const DURABLE_PRIORITY: Record<NonNullable<ObservationRecord["memoryClass"]>, number> = {
  preference_note: 5,
  decision_note: 4,
  fix_note: 3,
  constraint_note: 2,
  summary_note: 1,
};

export interface DurablePromotionCandidate {
  memoryClass: DurableMemoryRecord["memoryClass"];
  trustLevel: number;
  scope: DurableMemoryScope;
  sourceKind: DurableMemoryRecord["sourceKind"];
  status: DurableMemoryRecord["status"];
  relatedTopics: string[];
}

export interface RankContext {
  cwd?: string | undefined;
  query?: string | undefined;
}

export function classifyManualNoteForPromotion(
  row: ObservationRecord,
  opts?: { sourceKind?: DurableMemoryRecord["sourceKind"]; forceActive?: boolean },
): DurablePromotionCandidate | null {
  if (row.type !== "manual_note") return null;

  const metadata = safeParseJson(row.metadataJson);
  if (isPreferenceMetadata(metadata)) {
    return {
      memoryClass: "preference_note",
      trustLevel: 1,
      scope: metadata.scope,
      sourceKind: "preference_import",
      status: "active",
      relatedTopics: [metadata.key],
    };
  }

  const text = normalizeWhitespace(`${row.title}\n${row.text}`);
  if (!text) return null;

  const memoryClass = classifyText(text);
  if (!memoryClass) return null;

  return {
    memoryClass,
    trustLevel: opts?.forceActive ? 0.82 : 0.58,
    scope: row.cwd ? "project" : "workspace",
    sourceKind: opts?.sourceKind ?? "manual_backfill",
    status: opts?.forceActive ? "active" : "candidate",
    relatedTopics: inferRelatedTopics(text),
  };
}

export function rankObservations(rows: ObservationRecord[], context: RankContext): ObservationRecord[] {
  return [...rows]
    .map((row) => enrichRank(row, context))
    .sort(compareRank)
    .map((row) => row);
}

export function buildRetrievalSummary(
  rows: ObservationRecord[],
  context: RankContext,
  suppressed: { superseded: number; crossProject: number; restricted: number },
  policy: {
    scopeMode: ScopeMode;
    workspaceRoot?: string | undefined;
    workspaceId?: string | undefined;
    blockedReason?: string | undefined;
  },
): RetrievalSummary {
  const durableCount = rows.filter((row) => row.retrievalSource === "durable" || row.retrievalSource === "preference").length;
  const episodicCount = rows.filter((row) => row.retrievalSource === "episodic" || row.retrievalSource === "session").length;
  const topScore = rows[0]?.retrievalScore ?? 0;

  let confidenceBand: RetrievalConfidenceBand = "low";
  let confidenceReason = "No strong in-scope durable memory was found.";
  const weakSpots: string[] = [];

  if (topScore >= 15) {
    confidenceBand = "high";
    confidenceReason = "Top results include in-scope durable memory with strong trust.";
  } else if (topScore >= 9) {
    confidenceBand = "medium";
    confidenceReason = "Results are useful, but rely partly on episodic or lower-trust memory.";
  } else if (rows.length === 0) {
    weakSpots.push("No relevant memory matched the requested scope.");
  } else {
    weakSpots.push("Results are present, but ranking confidence is weak.");
  }

  if (!context.cwd) {
    weakSpots.push("No cwd scope was provided.");
  }
  if (durableCount === 0 && rows.length > 0) {
    weakSpots.push("No active durable memory matched; relying on episodic observations.");
  }
  if (policy.blockedReason === "scope_required") {
    weakSpots.push("Scope is required for exact-workspace retrieval.");
  }
  if (policy.blockedReason === "no_in_scope_results") {
    weakSpots.push("No in-scope results survived isolation policy.");
  }

  return {
    confidenceBand,
    confidenceReason,
    suppressedAsSuperseded: suppressed.superseded,
    suppressedAsCrossProject: suppressed.crossProject,
    suppressedAsRestricted: suppressed.restricted,
    durableCount,
    episodicCount,
    scopeModeApplied: policy.scopeMode,
    workspaceRootUsed: policy.workspaceRoot,
    workspaceIdUsed: policy.workspaceId,
    blockedReason: policy.blockedReason,
    weakSpots,
  };
}

export function evaluateBenchmarkCase(
  testCase: RetrievalBenchmarkCase,
  pack: {
    highlights: ObservationRecord[];
    durableMemories: ObservationRecord[];
    resolvedPreferenceKeys: string[];
    retrievalSummary: RetrievalSummary;
  },
): RetrievalBenchmarkResult {
  const failures: string[] = [];
  const classes = new Set(pack.durableMemories.map((row) => row.memoryClass).filter(Boolean));
  const texts = pack.highlights.map((row) => `${row.title}\n${row.text}`.toLowerCase());

  for (const expectedClass of testCase.expectedMemoryClasses ?? []) {
    if (!classes.has(expectedClass)) {
      failures.push(`missing_expected_class:${expectedClass}`);
    }
  }

  for (const expectedKey of testCase.expectedPreferenceKeys ?? []) {
    if (!pack.resolvedPreferenceKeys.includes(expectedKey)) {
      failures.push(`missing_expected_preference:${expectedKey}`);
    }
  }

  for (const forbiddenText of testCase.forbiddenTexts ?? []) {
    if (texts.some((text) => text.includes(forbiddenText.toLowerCase()))) {
      failures.push(`forbidden_text_present:${forbiddenText}`);
    }
  }

  if (
    testCase.minimumConfidenceBand &&
    compareConfidence(pack.retrievalSummary.confidenceBand, testCase.minimumConfidenceBand) < 0
  ) {
    failures.push(
      `confidence_too_low:${pack.retrievalSummary.confidenceBand}<${testCase.minimumConfidenceBand}`,
    );
  }

  return {
    id: testCase.id,
    passed: failures.length === 0,
    failures,
  };
}

function classifyText(text: string): DurableMemoryRecord["memoryClass"] | null {
  if (DECISION_PATTERNS.some((pattern) => pattern.test(text))) return "decision_note";
  if (FIX_PATTERNS.some((pattern) => pattern.test(text))) return "fix_note";
  if (CONSTRAINT_PATTERNS.some((pattern) => pattern.test(text))) return "constraint_note";
  if (text.length >= 30) return "summary_note";
  return null;
}

function inferRelatedTopics(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 5)
    .slice(0, 5);
}

function enrichRank(row: ObservationRecord, context: RankContext): ObservationRecord {
  const exactScope = Boolean(context.cwd && row.cwd && context.cwd === row.cwd);
  const crossProject = Boolean(context.cwd && row.cwd && context.cwd !== row.cwd);
  const durablePriority = row.memoryClass ? DURABLE_PRIORITY[row.memoryClass] ?? 0 : 0;
  const trustLevel = row.trustLevel ?? 0;
  const relevance = computeRelevance(row, context.query);
  const recency = row.createdAtEpoch / 1_000_000_000_000;
  const noisePenalty = row.type === "tool_call" || row.type === "tool_output" ? 5 : 0;
  const score =
    (exactScope ? 8 : 0) +
    durablePriority * 3 +
    trustLevel * 5 +
    relevance * 2 -
    (crossProject ? 6 : 0) -
    noisePenalty +
    recency;

  const retrievalSource =
    row.memoryClass === "preference_note"
      ? "preference"
      : row.memoryClass
        ? "durable"
        : row.sessionId
          ? "session"
          : "episodic";

  const confidenceBand: RetrievalConfidenceBand =
    score >= 15 ? "high" : score >= 9 ? "medium" : "low";

  const selectionReason = [
    exactScope ? "exact_scope_match" : crossProject ? "cross_project_penalty" : "scope_neutral",
    row.memoryClass ? `durable:${row.memoryClass}` : `observation:${row.type}`,
    relevance > 0 ? "text_match" : "weak_text_match",
  ].join(", ");

  const trustBasis = row.memoryClass
    ? `${row.memoryStatus ?? "active"} durable memory from ${row.sourceKind ?? "promotion"}`
    : row.type === "manual_note"
      ? "explicit manual note without active durable promotion"
      : "episodic session observation";

  return {
    ...row,
    retrievalSource,
    retrievalScore: Number(score.toFixed(4)),
    confidenceBand,
    selectionReason,
    trustBasis,
  };
}

function computeRelevance(row: ObservationRecord, query?: string | undefined): number {
  if (!query) return 0;
  const haystack = `${row.title}\n${row.text}`.toLowerCase();
  const tokens = normalizeWhitespace(query)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return 0;
  return tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
}

function compareRank(a: ObservationRecord, b: ObservationRecord): number {
  const scoreDelta = (b.retrievalScore ?? 0) - (a.retrievalScore ?? 0);
  if (scoreDelta !== 0) return scoreDelta;
  return b.createdAtEpoch - a.createdAtEpoch;
}

function isPreferenceMetadata(value: unknown): value is { key: string; scope: DurableMemoryScope } {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schema_version?: unknown }).schema_version === "pref-note.v1" &&
      typeof (value as { key?: unknown }).key === "string" &&
      typeof (value as { scope?: unknown }).scope === "string",
  );
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function compareConfidence(a: RetrievalConfidenceBand, b: RetrievalConfidenceBand): number {
  const rank: Record<RetrievalConfidenceBand, number> = { low: 1, medium: 2, high: 3 };
  return rank[a] - rank[b];
}
