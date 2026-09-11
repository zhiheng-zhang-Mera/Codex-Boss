import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase S1 —Self Target Resolver (Update-Plan/Alien-Prestart.md §5).
 *
 * The question this module answers is factual, not linguistic: "is the
 * repository this task is about to mutate the same repository the running Boss
 * was installed from?" It must never be answered from a prompt, a directory
 * name, or a model's self-report.
 *
 * Signals, all of them host-observed:
 *
 *   1. **realpath normalization** —junctions, symlinks and `..` are resolved
 *      before anything is compared, so `C:\Boss`, a junction, a subst alias and
 *      a `..`-laden path all collapse onto the same canonical directory.
 *   2. **git toplevel identity** —`git rev-parse --show-toplevel` for both the
 *      target and the running installation. Two paths inside one repository
 *      (including a linked worktree) resolve to the same repository identity.
 *   3. **git remote identity** —the `origin` URL, normalized to `owner/name`.
 *   4. **product marker** —the repository's `package.json` name must be the
 *      Boss product, so a stranger's repo cannot claim to be Boss.
 *   5. **installation identity** —the canonical root the running app was
 *      installed into.
 *   6. **known owner/name** —the reviewed repository identity list.
 *
 * A path is the self target only when the evidence agrees; a directory that
 * merely shares a name never is.
 */

export interface GitIdentity {
  /** Canonical directory of the repository (or worktree) root. */
  root: string;
  /** `git rev-parse --git-common-dir` resolved —shared by every linked worktree. */
  commonDirectory?: string;
  /** Normalized `owner/name`, when the repository has an origin remote. */
  repository?: string;
  /** Raw origin URL, for evidence. */
  remoteUrl?: string;
  /** True when the canonical root is a linked worktree rather than the main checkout. */
  worktree: boolean;
}

export interface SelfTargetEvidence {
  requestedPath: string;
  canonicalPath: string;
  targetGit?: GitIdentity;
  stableGit?: GitIdentity;
  productMarker?: string;
  productNameMatches: boolean;
  repositoryMatches: boolean;
  canonicalRootMatches: boolean;
  commonDirectoryMatches: boolean;
  installationMatches: boolean;
  knownIdentityMatches: boolean;
  signals: string[];
}

export interface SelfTargetResolution {
  isSelf: boolean;
  reason: string;
  stableRoot?: string;
  stableHeadSha?: string;
  repositoryIdentity?: string;
  evidence: SelfTargetEvidence;
}

export interface SelfTargetResolverOptions {
  /** Root the running Boss was installed from (Stable). */
  stableRoot: string;
  /** Product repository identity, e.g. `zhiheng-zhang-Mera/Codex-Boss`. */
  productRepository: string;
  /** `package.json` name that marks the Boss product. */
  productName?: string;
  /** Additional accepted repository identities. */
  knownRepositories?: readonly string[];
  /** Injection seam for tests and for hosts without a git binary. */
  gitRunner?: (cwd: string, args: string[]) => string | undefined;
  /** Injection seam: reads a file, returning undefined when absent. */
  readFile?: (file: string) => string | undefined;
  /** Injection seam: canonicalizes a path (realpath). */
  canonicalize?: (value: string) => string;
  /** Injection seam: reads the Stable HEAD. */
  headOf?: (root: string) => string | undefined;
}

/** Lower-cased, separator-normalized comparison form. */
export function canonicalComparison(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Normalizes `git@host:owner/name.git` and `https://host/owner/name.git` to `owner/name`. */
export function normalizeRepositoryIdentity(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const scp = /^[^@/]+@[^:/]+:(.+)$/.exec(trimmed);
  const candidate = scp ? scp[1] : trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const withoutHost = scp ? candidate : candidate.replace(/^[^/]+\//, "");
  const cleaned = withoutHost.replace(/\.git$/i, "").replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`.toLowerCase();
}

function defaultGitRunner(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function defaultCanonicalize(value: string): string {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function defaultReadFile(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The nearest existing ancestor of a path. A task may legitimately name a path
 * that does not exist yet (a file about to be created, a directory about to be
 * isolated), and git can only be asked about a directory that is really there.
 */
function nearestExisting(value: string, canonicalize: (value: string) => string): string {
  let current = path.resolve(value);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return canonicalize(current);
    current = parent;
  }
  return canonicalize(current);
}

/** Resolves the git identity of a directory, walking up to its repository root. */
export function resolveGitIdentity(
  directory: string,
  gitRunner: (cwd: string, args: string[]) => string | undefined,
  canonicalize: (value: string) => string
): GitIdentity | undefined {
  const root = gitRunner(directory, ["rev-parse", "--show-toplevel"]);
  if (!root) return undefined;
  const resolvedRoot = canonicalize(root);
  const gitDirectory = gitRunner(directory, ["rev-parse", "--absolute-git-dir"]);
  const commonDirectory = gitRunner(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]) ?? gitRunner(directory, ["rev-parse", "--git-common-dir"]);
  const remoteUrl = gitRunner(directory, ["remote", "get-url", "origin"]);
  return {
    root: resolvedRoot,
    commonDirectory: commonDirectory ? canonicalize(commonDirectory) : undefined,
    repository: normalizeRepositoryIdentity(remoteUrl),
    remoteUrl: remoteUrl ?? undefined,
    worktree: Boolean(gitDirectory && commonDirectory && canonicalComparison(gitDirectory) !== canonicalComparison(commonDirectory))
  };
}

function productMarker(root: string, readFile: (file: string) => string | undefined): string | undefined {
  const content = readFile(path.join(root, "package.json"));
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

export class SelfTargetResolver {
  private readonly stableRoot: string;
  private readonly productRepository: string;
  private readonly productName: string;
  private readonly knownRepositories: string[];
  private readonly gitRunner: (cwd: string, args: string[]) => string | undefined;
  private readonly readFile: (file: string) => string | undefined;
  private readonly canonicalize: (value: string) => string;
  private readonly headOf: (root: string) => string | undefined;
  private cachedStable?: GitIdentity;

  constructor(options: SelfTargetResolverOptions) {
    this.stableRoot = canonicalizePath(options.stableRoot, options.canonicalize);
    this.productRepository = options.productRepository.toLowerCase();
    this.productName = options.productName ?? "codex-boss";
    this.knownRepositories = [this.productRepository, ...(options.knownRepositories ?? []).map((value) => value.toLowerCase())];
    this.gitRunner = options.gitRunner ?? defaultGitRunner;
    this.readFile = options.readFile ?? defaultReadFile;
    this.canonicalize = options.canonicalize ?? defaultCanonicalize;
    this.headOf = options.headOf ?? ((root: string) => this.gitRunner(root, ["rev-parse", "HEAD"]));
  }

  /** The Stable installation's git identity, resolved once. */
  stableIdentity(): GitIdentity | undefined {
    if (!this.cachedStable) this.cachedStable = resolveGitIdentity(this.stableRoot, this.gitRunner, this.canonicalize);
    return this.cachedStable;
  }

  resolve(targetPath: string): SelfTargetResolution {
    const requested = path.resolve(targetPath);
    const canonical = this.canonicalize(requested);
    // git can only be asked about a directory that exists; a path about to be
    // created is classified by the nearest existing ancestor it lives under.
    const probe = fs.existsSync(requested) ? canonical : nearestExisting(requested, this.canonicalize);
    const targetGit = resolveGitIdentity(probe, this.gitRunner, this.canonicalize);
    const stableGit = this.stableIdentity();
    const marker = productMarker(targetGit?.root ?? canonical, this.readFile);

    const targetRepository = targetGit?.repository?.toLowerCase();
    const productNameMatches = marker === this.productName;
    const repositoryMatches = Boolean(targetRepository) && this.knownRepositories.includes(targetRepository!);
    const canonicalRootMatches = Boolean(targetGit && stableGit && canonicalComparison(targetGit.root) === canonicalComparison(stableGit.root));
    const commonDirectoryMatches = Boolean(
      targetGit?.commonDirectory && stableGit?.commonDirectory && canonicalComparison(targetGit.commonDirectory) === canonicalComparison(stableGit.commonDirectory)
    );
    const installationMatches = !targetGit && canonicalComparison(canonical) === canonicalComparison(this.stableRoot);

    const signals: string[] = [];
    if (repositoryMatches) signals.push("git-remote-identity");
    if (productNameMatches) signals.push("product-marker");
    if (canonicalRootMatches) signals.push("canonical-git-root");
    if (commonDirectoryMatches) signals.push("shared-git-common-dir");
    if (installationMatches) signals.push("installation-root");

    const evidence: SelfTargetEvidence = {
      requestedPath: requested,
      canonicalPath: canonical,
      targetGit,
      stableGit,
      productMarker: marker,
      productNameMatches,
      repositoryMatches,
      canonicalRootMatches,
      commonDirectoryMatches,
      installationMatches,
      knownIdentityMatches: repositoryMatches && productNameMatches,
      signals
    };

    // The decisive signals are the ones that cannot be forged by naming:
    // the shared git common directory, the canonical repository root, and the
    // installation root itself. A matching remote alone is not enough unless
    // the product marker agrees, so a cloned-but-unrelated folder cannot
    // silently enter the self-evolution trust domain.
    const structural = canonicalRootMatches || commonDirectoryMatches || installationMatches;
    const identity = repositoryMatches && productNameMatches;
    const isSelf = structural || identity;

    if (!isSelf) {
      return {
        isSelf: false,
        reason: targetGit
          ? `target repository ${targetGit.repository ?? canonicalComparison(targetGit.root)} is not the Boss installation ${this.productRepository}`
          : `path ${canonicalComparison(canonical)} is not a Boss git repository and is not the installation root`,
        repositoryIdentity: targetGit?.repository,
        evidence
      };
    }

    const stableRoot = stableGit?.root ?? this.stableRoot;
    const stableHeadSha = this.headOf(stableRoot);
    return {
      isSelf: true,
      reason: `target resolves to the Boss repository via ${signals.join(", ")}`,
      stableRoot,
      ...(stableHeadSha ? { stableHeadSha } : {}),
      repositoryIdentity: targetGit?.repository ?? this.productRepository,
      evidence
    };
  }
}

function canonicalizePath(value: string, canonicalize?: (value: string) => string): string {
  const resolved = path.resolve(value);
  if (canonicalize) return canonicalize(resolved);
  return defaultCanonicalize(resolved);
}

/** Convenience wrapper for callers that resolve once per task. */
export function resolveSelfTarget(targetPath: string, options: SelfTargetResolverOptions): SelfTargetResolution {
  return new SelfTargetResolver(options).resolve(targetPath);
}
