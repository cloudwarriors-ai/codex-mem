import type { RetrievalBenchmarkCase } from "../src/types.js";

export const retrievalBenchmarkCases: RetrievalBenchmarkCase[] = [
  {
    id: "pref-recall",
    description: "Retrieve active coding preference",
    cwd: "/Users/chadsimon/code/my-project",
    query: "validation order",
    expectedMemoryClasses: ["preference_note"],
    expectedPreferenceKeys: ["pref:tests.order"],
    minimumConfidenceBand: "medium",
  },
  {
    id: "fix-recall",
    description: "Retrieve known migration fix",
    cwd: "/Users/chadsimon/code/my-project",
    query: "migration lock root cause",
    expectedMemoryClasses: ["fix_note"],
    minimumConfidenceBand: "medium",
  },
  {
    id: "cross-project-suppression",
    description: "Avoid cross-project contamination when in-scope memory exists",
    cwd: "/Users/chadsimon/code/my-project",
    query: "schema lock issue",
    forbiddenTexts: ["other repo fix"],
    minimumConfidenceBand: "medium",
  },
];
