/**
 * Protected Surface classification (Update-Plan/Isolation-Finalization.md §5,
 * §7.2, §14 RT-03/RT-09..RT-13). Pure and shareable: no fs, no electron.
 *
 * The host—never a worker, never a prompt, never the model—decides whether a
 * path is a Root Surface. This module is the decision itself; the host wrapper
 * (electron/root-authority/protected-surface-guard.ts) resolves real paths
 * (symlinks, junctions, case) before calling in here.
 *
 * Two sources are unioned:
 *
 *   1. `ROOT_PROTECTED_MANIFEST` — compiled into the guard. It cannot be edited
 *      away by a Candidate, so deleting or emptying `.github/CODEOWNERS`
 *      (RT-13) fails closed instead of opening the surface.
 *   2. `.github/CODEOWNERS` — parsed at host boot with GitHub's matching rules
 *      so an Owner-extended boundary is honoured automatically.
 *
 * Paths are normalized *before* matching, and a rename is classified on both
 * its source and its destination, so neither half of a move can smuggle a Root
 * file past the guard.
 */

/**
 * Compiled-in Root Surface. Deliberately mirrors `.github/CODEOWNERS`.
 * Pattern syntax is the CODEOWNERS subset implemented below.
 */
export const ROOT_PROTECTED_MANIFEST: readonly string[] = [
  // The review boundary itself, so it cannot be deleted to escape review (RT-13).
  "/.github/CODEOWNERS",
  "/.github/workflows/",

  // CI command indirection / dependency execution surface.
  "/package.json",
  "/pnpm-lock.yaml",
  "/pnpm-workspace.yaml",
  "/.npmrc",

  // Build / typecheck / test-runner configuration.
  "/tsconfig.json",
  "/tsconfig.electron.json",
  "/tsconfig.*.json",
  "/vite.config.*",
  "/vitest.config.*",

  // Critical promotion / acceptance gates used by CI.
  "/scripts/benchmark.cjs",
  "/scripts/package-portable.cjs",
  "/scripts/smoke-portable.ps1",
  "/scripts/acceptance-restart.cjs",
  "/scripts/acceptance-*.cjs",
  "/scripts/acceptance-*.ps1",
  "/scripts/*soak*.cjs",
  "/scripts/*soak*.ps1",
  "/scripts/r901-soak.cjs",

  // Root Authority policy surface. Policy metadata only — never a secret.
  "/.codex-boss/root/",
  "/.codex-boss/config/root-*.json",
  "/.codex-boss/config/root-*.schema.json",

  // Root authority implementation.
  "/electron/root-authority/",
  "/src/root-authority/",
  "/src/**/root-authority/",

  // Owner identity / authority verification.
  "/electron/owner-authority/",
  "/src/owner-authority/",
  "/src/**/owner-authority/",

  // Explicit self-elevation guards.
  "/electron/self-elevation/",
  "/src/self-elevation/",
  "/src/**/self-elevation/",

  // Credential boundary.
  "/electron/credential-boundary/",
  "/electron/security/credential-boundary/",
  "/src/credential-boundary/",
  "/src/**/credential-boundary/",
  "/electron/root-credential*/",
  "/src/**/root-credential*/",

  // Promotion / Stable-Candidate authority boundary.
  "/electron/promotion-gate/",
  "/electron/engineering/promotion-gate/",
  "/src/promotion-gate/",
  "/src/**/promotion-gate/",
  "/electron/stable-candidate/",
  "/src/stable-candidate/",
  "/src/**/stable-candidate/",

  // Emergency stop / recovery authority.
  "/electron/emergency-control/",
  "/src/emergency-control/",
  "/src/**/emergency-control/",
  "/electron/root-recovery/",
  "/src/root-recovery/",
  "/src/**/root-recovery/",

  // Root-invariant tests.
  "/tests/**/root-authority*.test.*",
  "/tests/**/owner-authority*.test.*",
  "/tests/**/self-elevation*.test.*",
  "/tests/**/credential-boundary*.test.*",
  "/tests/**/promotion-gate*.test.*",
  "/tests/**/stable-candidate*.test.*",
  "/tests/**/emergency-control*.test.*",
  "/tests/**/root-recovery*.test.*"
];

export interface ProtectedSurfaceOptions {
  /**
   * Match case-insensitively. Defaults to true: on Windows/macOS the filesystem
   * is case-insensitive anyway, and on a case-sensitive host the only cost of
   * over-matching is an extra Owner approval — which is the fail-closed side.
   */
  caseInsensitive?: boolean;
  /** Extra patterns to union in (normally the parsed `.github/CODEOWNERS`). */
  extraPatterns?: readonly string[];
}

export interface ProtectedPathHit {
  /** The normalized repo-relative path that matched. */
  path: string;
  /** The pattern that matched it. */
  rule: string;
  /** Which boundary produced the rule. */
  source: "immutable-manifest" | "codeowners";
}

export interface ProtectedSurfaceAssessment {
  protected: boolean;
  hits: ProtectedPathHit[];
  /**
   * Paths that lexically escape the repository root (`../../etc/passwd`).
   * A caller must translate a non-empty list into DENY, not REQUIRE_OWNER.
   */
  escapes: string[];
}

/** Splits a CODEOWNERS line into its pattern and owner list. */
function parseCodeownersLine(line: string): { pattern: string; owners: string[] } | undefined {
  // GitHub strips `#` comments; an escaped `\#` is literal and is not supported
  // by CODEOWNERS in practice, so a plain split is faithful here.
  const withoutComment = line.split("#")[0].trim();
  if (!withoutComment) return undefined;
  const parts = withoutComment.split(/\s+/);
  const pattern = parts[0];
  if (!pattern) return undefined;
  return { pattern, owners: parts.slice(1) };
}

/**
 * Parses `.github/CODEOWNERS` into the pattern list that actually carries an
 * owner. Lines whose owner list is empty are ignored (they grant nothing).
 * The parse is total: malformed lines are skipped, never thrown, so a broken
 * CODEOWNERS file cannot crash the guard — the compiled-in manifest still
 * protects every Root path.
 */
export function parseCodeownersPatterns(content: string): string[] {
  const patterns: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseCodeownersLine(line);
    if (!parsed) continue;
    if (!parsed.owners.length) continue;
    patterns.push(parsed.pattern);
  }
  return patterns;
}

/**
 * Translates one CODEOWNERS pattern into an anchored regular expression.
 *
 * Supported semantics (the subset GitHub documents):
 *   - `#` comments and blank lines are handled by the caller;
 *   - a leading `/` anchors the pattern at the repository root;
 *   - a pattern containing an internal `/` is root-anchored;
 *   - a pattern with no `/` matches the basename at any depth;
 *   - a trailing `/` matches the directory and everything beneath it;
 *   - `*` matches within a path segment, `**` matches across segments;
 *   - `?` matches a single character within a segment.
 */
export function codeownersPatternToRegExp(pattern: string, caseInsensitive = true): RegExp {
  let body = pattern.trim();
  if (!body) return /$^/; // never matches
  let directoryOnly = false;
  if (body.endsWith("/")) {
    directoryOnly = true;
    body = body.slice(0, -1);
  }
  const anchored = body.startsWith("/");
  if (anchored) body = body.slice(1);
  // After removing a leading slash, an internal slash still means root-anchored.
  const rootAnchored = anchored || body.includes("/");

  let source = "";
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === "*") {
      if (body[index + 1] === "*") {
        // `**/` consumes zero or more whole segments; a bare `**` is `.*`.
        if (body[index + 2] === "/") {
          source += "(?:[^/]+/)*";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  const prefix = rootAnchored ? "^" : "^(?:.*/)?";
  // A directory pattern protects the directory entry itself and everything under
  // it, so deleting the directory (RT-13 style) also matches.
  const suffix = directoryOnly ? "(?:/.*)?$" : "$";
  return new RegExp(prefix + source + suffix, caseInsensitive ? "i" : "");
}

export interface CompiledProtectedSurface {
  rules: { pattern: string; source: ProtectedPathHit["source"]; regex: RegExp }[];
  caseInsensitive: boolean;
}

/** Compiles the manifest + extra patterns once; callers reuse the result. */
export function compileProtectedSurface(options: ProtectedSurfaceOptions = {}): CompiledProtectedSurface {
  const caseInsensitive = options.caseInsensitive ?? true;
  const rules: CompiledProtectedSurface["rules"] = [];
  for (const pattern of ROOT_PROTECTED_MANIFEST) {
    rules.push({ pattern, source: "immutable-manifest", regex: codeownersPatternToRegExp(pattern, caseInsensitive) });
  }
  for (const pattern of options.extraPatterns ?? []) {
    // Never let a duplicate (or a manifest pattern re-declared by CODEOWNERS)
    // shadow the compiled-in rule: the immutable source is matched first and
    // both produce the same REQUIRE_OWNER outcome.
    rules.push({ pattern, source: "codeowners", regex: codeownersPatternToRegExp(pattern, caseInsensitive) });
  }
  return { rules, caseInsensitive };
}

/**
 * Normalizes an arbitrary caller-supplied path into a repo-relative POSIX path.
 *
 * Returns `undefined` when the path cannot be expressed relative to the root
 * (absolute path outside the root, or `..` traversal past the root). Callers
 * must treat `undefined` as a containment failure (DENY), never as "unprotected".
 */
export function normalizeRepoPath(input: string): string | undefined {
  if (typeof input !== "string" || !input.trim()) return undefined;
  let value = input.trim().replace(/\\/g, "/");
  // Windows drive-letter and UNC prefixes are absolute by definition.
  if (/^[a-zA-Z]:\//.test(value) || value.startsWith("//")) return undefined;
  if (value.startsWith("/")) return undefined;
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (!segments.length) return undefined;
  return segments.join("/");
}

/**
 * Classifies a set of repo-relative paths against the protected surface.
 *
 * Rename/delete support is explicit rather than implicit: pass the *destination*
 * paths in `paths` and the *source* paths in `also`, and both are assessed. The
 * function is intentionally total — a non-string entry becomes an escape so a
 * malformed manifest from a worker fails closed instead of silently passing.
 */
export function assessProtectedPaths(
  paths: readonly unknown[],
  also: readonly unknown[] = [],
  options: ProtectedSurfaceOptions = {}
): ProtectedSurfaceAssessment {
  const surface = compileProtectedSurface(options);
  const hits: ProtectedPathHit[] = [];
  const escapes: string[] = [];
  const seen = new Set<string>();

  const consider = (raw: unknown): void => {
    if (typeof raw !== "string" || !raw.trim()) {
      escapes.push(String(raw));
      return;
    }
    // An absolute path is only meaningful when the caller already relativized
    // it; treat it as an escape so the host wrapper must do that work explicitly.
    const normalized = normalizeRepoPath(raw);
    if (!normalized) {
      escapes.push(raw);
      return;
    }
    const key = surface.caseInsensitive ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return;
    seen.add(key);
    for (const rule of surface.rules) {
      if (rule.regex.test(normalized)) {
        hits.push({ path: normalized, rule: rule.pattern, source: rule.source });
        return; // one rule per path is enough evidence
      }
    }
  };

  for (const path of paths) consider(path);
  for (const path of also) consider(path);

  return { protected: hits.length > 0, hits, escapes };
}

/** True when the path (repo-relative or normalizable) is a Root Surface. */
export function isProtectedPath(path: string, options: ProtectedSurfaceOptions = {}): boolean {
  return assessProtectedPaths([path], [], options).protected;
}
