import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  MemoryScopePolicy,
  MemorySensitivity,
  MemoryVisibility,
  ScopeMode,
} from "./types.js";

const ROOT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "nx.json",
  ".git",
] as const;

export interface WorkspaceIdentity {
  cwd: string;
  workspaceRoot: string;
  workspaceId: string;
  resolved: boolean;
}

export class ScopeIsolationError extends Error {
  constructor(
    readonly reason:
      | "scope_required"
      | "workspace_unresolved"
      | "cross_workspace_not_allowed",
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "ScopeIsolationError";
  }
}

export function resolveWorkspaceIdentity(cwd: string): WorkspaceIdentity {
  const normalized = normalizeExistingPath(cwd);
  if (!normalized) {
    return unknownWorkspace(cwd);
  }

  const workspaceRoot = findWorkspaceRoot(normalized);
  if (!workspaceRoot) {
    return unknownWorkspace(normalized);
  }

  return {
    cwd: normalized,
    workspaceRoot,
    workspaceId: hashWorkspaceRoot(normalized),
    resolved: true,
  };
}

export function inferProcessWorkspaceIdentity(): WorkspaceIdentity {
  return resolveWorkspaceIdentity(process.cwd());
}

export function defaultVisibilityForPreference(scope: string): MemoryVisibility {
  return scope === "global" ? "global_preference" : "workspace_only";
}

export function defaultVisibilityForMemory(): MemoryVisibility {
  return "workspace_only";
}

export function defaultSensitivityForIdentity(identity: WorkspaceIdentity): MemorySensitivity {
  return identity.resolved ? "normal" : "restricted";
}

export function defaultScopePolicyForVisibility(visibility: MemoryVisibility): MemoryScopePolicy {
  return visibility === "global_preference" ? "global_allowed" : "exact_workspace";
}

export function allowsResultForScope(args: {
  requestedScopeMode: ScopeMode;
  requestedWorkspaceId?: string | undefined;
  rowWorkspaceId?: string | undefined;
  visibility?: MemoryVisibility | undefined;
  sensitivity?: MemorySensitivity | undefined;
}): {
  allowed: boolean;
  workspaceMatch: boolean;
  scopeDecision: string;
  visibilityDecision: string;
} {
  const visibility = args.visibility ?? "workspace_only";
  const sensitivity = args.sensitivity ?? "restricted";
  const rowWorkspaceId = args.rowWorkspaceId ?? "unknown";
  const workspaceMatch =
    Boolean(args.requestedWorkspaceId) &&
    args.requestedWorkspaceId !== "unknown" &&
    rowWorkspaceId === args.requestedWorkspaceId;

  if (sensitivity === "restricted") {
    return {
      allowed: false,
      workspaceMatch,
      scopeDecision: "restricted_memory_present",
      visibilityDecision: "restricted",
    };
  }

  if (visibility === "global_preference") {
    return {
      allowed: true,
      workspaceMatch,
      scopeDecision: "global_allowed",
      visibilityDecision: "global_preference",
    };
  }

  if (args.requestedScopeMode === "exact_workspace") {
    return workspaceMatch
      ? {
          allowed: true,
          workspaceMatch,
          scopeDecision: "exact_workspace",
          visibilityDecision: "workspace_only",
        }
      : {
          allowed: false,
          workspaceMatch,
          scopeDecision: "cross_workspace_not_allowed",
          visibilityDecision: visibility,
        };
  }

  if (args.requestedScopeMode === "cross_workspace") {
    return visibility === "cross_workspace_opt_in" || workspaceMatch
      ? {
          allowed: true,
          workspaceMatch,
          scopeDecision: workspaceMatch ? "exact_workspace" : "cross_workspace_opt_in",
          visibilityDecision: visibility,
        }
      : {
          allowed: false,
          workspaceMatch,
          scopeDecision: "cross_workspace_not_allowed",
          visibilityDecision: visibility,
        };
  }

  return {
    allowed: true,
    workspaceMatch,
    scopeDecision: workspaceMatch ? "exact_workspace" : "global_allowed",
    visibilityDecision: visibility,
  };
}

function normalizeExistingPath(input: string): string | null {
  try {
    const resolved = resolve(input);
    if (!existsSync(resolved)) return resolved;
    const stat = lstatSync(resolved);
    const directory = stat.isDirectory() ? resolved : dirname(resolved);
    return realpathSync(directory);
  } catch {
    return null;
  }
}

function findWorkspaceRoot(start: string): string | null {
  let current = start;
  while (true) {
    if (ROOT_MARKERS.some((marker) => existsSync(resolve(current, marker)))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

function hashWorkspaceRoot(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

function unknownWorkspace(cwd: string): WorkspaceIdentity {
  return {
    cwd,
    workspaceRoot: "",
    workspaceId: "unknown",
    resolved: false,
  };
}
