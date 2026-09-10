import fs from "node:fs";
import path from "node:path";
import { workspacePath } from "../engineering/native-tools";
import {
  assessProtectedPaths,
  compileProtectedSurface,
  normalizeRepoPath,
  parseCodeownersPatterns,
  type CompiledProtectedSurface,
  type ProtectedPathHit
} from "../../src/shared/root-authority/protected-surface";
import type { RootDecisionReason } from "../../src/shared/root-authority/contracts";

/**
 * Host-side Protected Surface Guard (Update-Plan/Isolation-Finalization.md §5,
 * §7.2). This is where "host decides, worker never self-reports" is implemented.
 *
 * It is built *on top of* the existing engineering containment
 * (`electron/engineering/native-tools.ts#workspacePath`), not beside it: every
 * path is resolved through that function so path traversal and symlink/junction
 * escape are rejected by the same code the rest of the engineering chain
 * already trusts. Only after containment succeeds is the real (link-resolved)
 * relative path classified against the protected surface.
 *
 * Properties the acceptance tests exercise as real behaviour:
 *   - `../stable/...` ⇒ escape ⇒ DENY (RT-01)
 *   - a junction/symlink pointing outside the root ⇒ escape ⇒ DENY (RT-02)
 *   - a new file inside a protected directory ⇒ REQUIRE_OWNER (RT-03/RT-09)
 *   - a rename is classified on BOTH source and destination (RT-03)
 *   - a delete is classified exactly like a write (RT-13)
 *   - case differences cannot slip past on a case-insensitive host (RT-09)
 */

export type SurfaceChangeKind = "read" | "write" | "create" | "delete" | "rename";

export interface SurfaceChange {
  /** Destination / target path, absolute or relative to the workspace root. */
  path: string;
  kind: SurfaceChangeKind;
  /** Rename/move source. Assessed in addition to `path`, never instead of it. */
  from?: string;
}

export interface ResolvedSurfacePath {
  /** POSIX-normalized path relative to the workspace root. */
  relative: string;
  /** Absolute on-disk path after symlink/junction resolution of its ancestors. */
  absolute: string;
}

export interface SurfaceAssessment {
  decision: "ALLOW" | "REQUIRE_OWNER" | "DENY";
  protected: ProtectedPathHit[];
  /** Paths that left the workspace root, lexically or through a link. */
  escapes: string[];
  reasons: RootDecisionReason[];
}

export interface ProtectedSurfaceGuardOptions {
  /** Workspace root. For evolution runs this is the Candidate root, never Stable. */
  root: string;
  /** Override the CODEOWNERS location (tests use a fixture file). */
  codeownersFile?: string;
  /** Defaults to true — see ProtectedSurfaceOptions.caseInsensitive. */
  caseInsensitive?: boolean;
}

export class ProtectedSurfaceGuard {
  readonly root: string;
  private readonly caseInsensitive: boolean;
  private readonly codeownersFile: string;
  private readonly surface: CompiledProtectedSurface;
  private readonly codeownersPatterns: readonly string[];
  /** True when no CODEOWNERS file was found; the compiled manifest still applies. */
  readonly codeownersMissing: boolean;

  constructor(options: ProtectedSurfaceGuardOptions) {
    this.root = fs.realpathSync(options.root);
    this.caseInsensitive = options.caseInsensitive ?? true;
    this.codeownersFile = options.codeownersFile ?? path.join(this.root, ".github", "CODEOWNERS");
    let content = "";
    if (fs.existsSync(this.codeownersFile)) {
      try {
        content = fs.readFileSync(this.codeownersFile, "utf8");
      } catch {
        content = "";
      }
    }
    this.codeownersMissing = content === "";
    this.codeownersPatterns = parseCodeownersPatterns(content);
    this.surface = compileProtectedSurface({ caseInsensitive: this.caseInsensitive, extraPatterns: this.codeownersPatterns });
  }

  /** Every pattern currently in force (compiled manifest first, then CODEOWNERS). */
  patterns(): { pattern: string; source: ProtectedPathHit["source"] }[] {
    return this.surface.rules.map((rule) => ({ pattern: rule.pattern, source: rule.source }));
  }

  /**
   * Resolves a caller-supplied path to a contained workspace-relative path.
   * Returns `undefined` when the path escapes the root — lexically (`..`) or
   * through a symlink/junction — because those are DENY, not REQUIRE_OWNER.
   */
  resolve(requested: string): ResolvedSurfacePath | undefined {
    if (typeof requested !== "string" || !requested.trim()) return undefined;
    let target: string;
    try {
      // The existing containment: realpath root, traversal containment and
      // symlink escape containment, including for not-yet-existing leaf files.
      target = workspacePath(this.root, requested);
    } catch {
      return undefined;
    }
    const relative = path.relative(this.root, target).split(path.sep).join("/");
    const normalized = normalizeRepoPath(relative);
    if (!normalized) return undefined;
    return { relative: normalized, absolute: target };
  }

  /** Classifies a set of already-resolved-or-not paths (no rename semantics). */
  assessPaths(paths: readonly unknown[], also: readonly unknown[] = []): SurfaceAssessment {
    const escapes: string[] = [];
    const relatives: string[] = [];
    for (const raw of [...paths, ...also]) {
      if (typeof raw !== "string") {
        escapes.push(String(raw));
        continue;
      }
      const resolved = this.resolve(raw);
      if (!resolved) escapes.push(raw);
      else relatives.push(resolved.relative);
    }
    const assessment = assessProtectedPaths(relatives, [], { caseInsensitive: this.caseInsensitive, extraPatterns: this.codeownersPatterns });
    return this.compose(assessment.hits, escapes);
  }

  /**
   * Classifies structural changes. A rename contributes both its `from` and its
   * `path`, and a delete contributes its target, so neither direction of a move
   * and no removal can avoid the boundary.
   */
  assessChanges(changes: readonly SurfaceChange[]): SurfaceAssessment {
    const escapes: string[] = [];
    const relatives: string[] = [];
    for (const change of changes) {
      const targets = change.kind === "rename" ? [change.from, change.path] : [change.path];
      for (const raw of targets) {
        if (typeof raw !== "string") {
          escapes.push(String(raw));
          continue;
        }
        const resolved = this.resolve(raw);
        if (!resolved) escapes.push(raw);
        else relatives.push(resolved.relative);
      }
    }
    const assessment = assessProtectedPaths(relatives, [], { caseInsensitive: this.caseInsensitive, extraPatterns: this.codeownersPatterns });
    return this.compose(assessment.hits, escapes);
  }

  /**
   * The change-set check used by the Promotion Gate: does this Candidate touch
   * any Root Surface? Paths come from `git diff --name-only`, i.e. they are
   * already repo-relative, but they are still resolved so a path that escapes
   * the Candidate root is treated as DENY rather than REQUIRE_OWNER.
   */
  assessChangeSet(changedFiles: readonly string[], additionalProtectedPaths: readonly string[] = []): SurfaceAssessment {
    const escapes: string[] = [];
    const relatives: string[] = [];
    for (const raw of changedFiles) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const resolved = this.resolve(raw);
      if (!resolved) escapes.push(raw);
      else relatives.push(resolved.relative);
    }
    const assessment = assessProtectedPaths(
      relatives,
      [],
      { caseInsensitive: this.caseInsensitive, extraPatterns: [...this.codeownersPatterns, ...additionalProtectedPaths] }
    );
    return this.compose(assessment.hits, escapes);
  }

  private compose(hits: ProtectedPathHit[], escapes: string[]): SurfaceAssessment {
    const reasons: RootDecisionReason[] = [];
    if (escapes.length) {
      reasons.push({ code: "path:escape", detail: `path escaped the candidate workspace: ${escapes.slice(0, 5).join(", ")}` });
    }
    if (hits.length) {
      for (const hit of hits.slice(0, 10)) {
        reasons.push({ code: `path:protected:${hit.source}`, detail: `${hit.path} matches ${hit.rule}` });
      }
    }
    // An escape is a containment violation (DENY). A protected hit alone is a
    // review boundary (REQUIRE_OWNER, §7.2 / §11.4).
    const decision = escapes.length ? "DENY" : hits.length ? "REQUIRE_OWNER" : "ALLOW";
    return { decision, protected: hits, escapes, reasons };
  }
}

/** Convenience for one-shot checks without holding a guard instance. */
export function assessWorkspaceChanges(root: string, changes: readonly SurfaceChange[], options: { codeownersFile?: string; caseInsensitive?: boolean } = {}): SurfaceAssessment {
  return new ProtectedSurfaceGuard({ root, ...options }).assessChanges(changes);
}
