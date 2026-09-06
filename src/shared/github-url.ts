/**
 * GitHub URL parsing (plan 9-7 §11). Pure and shareable: recognize a GitHub
 * repo URL and split owner/repo/ref/subpath so Boss can clone deterministically.
 */

export interface GithubTarget {
  url: string;
  owner: string;
  repo: string;
  ref?: string;
  /** Path inside the repo (tree/blob/… subpath), when present. */
  subpath?: string;
  /** True when the URL names a specific branch/tag/commit ref. */
  hasRef: boolean;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com", "github.com/"]);
const SAFE_SEGMENT = /^[A-Za-z0-9_.\-]{1,200}$/;

/** Is this URL worth treating as a GitHub repo input? */
export function looksLikeGithubUrl(text: string): boolean {
  const value = (text ?? "").trim();
  return /^https?:\/\/github\.com\//i.test(value) || /^git@github\.com:/i.test(value);
}

/** Extracts the first GitHub repo URL found inside free text (e.g. a prompt). */
export function extractGithubUrlFromMessage(message: string): string | undefined {
  if (typeof message !== "string" || !message) return undefined;
  const candidate = message.match(/https?:\/\/github\.com\/[^\s"'<>，。；、,]+/i)?.[0] ?? message.match(/git@github\.com:[^\s"'<>，。；、,]+/)?.[0];
  if (!candidate) return undefined;
  const target = parseGithubUrl(candidate);
  return target ? candidate.replace(/[).,，。;；]+$/, "") : undefined;
}

/**
 * Parses:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch-x
 *   https://github.com/owner/repo/tree/branch-x/sub/path
 *   https://github.com/owner/repo/blob/main/src/file.ts
 *   https://github.com/owner/repo/commit/<hash>
 *   git@github.com:owner/repo.git
 * Returns undefined for anything else (never throws).
 */
export function parseGithubUrl(input: string): GithubTarget | undefined {
  if (typeof input !== "string") return undefined;
  let value = input.trim();
  if (!value) return undefined;

  if (value.startsWith("git@github.com:")) {
    const rest = value.slice("git@github.com:".length);
    const [owner, repoPart] = rest.split("/");
    const repo = repoPart?.replace(/\.git$/, "");
    if (!owner || !repo || !SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo)) return undefined;
    return { url: value, owner, repo, hasRef: false };
  }

  let url: URL;
  try { url = new URL(value); }
  catch { return undefined; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (!/^github\.com$/i.test(url.hostname) && !/^www\.github\.com$/i.test(url.hostname)) return undefined;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return undefined;
  const [owner, repo] = segments;
  if (!SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo.replace(/\.git$/, ""))) return undefined;
  const cleanRepo = repo.replace(/\.git$/, "");
  const result: GithubTarget = { url: value, owner, repo: cleanRepo, hasRef: false };

  const kind = segments[2];
  if (kind === "tree" || kind === "blob") {
    // tree/branch/deep/path — ref is the segment after kind, then the subpath.
    const parts = segments.slice(3);
    if (parts.length >= 1) {
      result.ref = decodeURIComponent(parts[0]);
      result.hasRef = true;
      const subpath = parts.slice(1).join("/");
      if (subpath) result.subpath = subpath;
    }
  } else if (kind === "commit" && segments[3]) {
    result.ref = segments[3];
    result.hasRef = true;
  } else if (kind && SAFE_SEGMENT.test(decodeURIComponent(kind))) {
    // https://github.com/owner/repo/<branch> — treat as a ref.
    result.ref = decodeURIComponent(kind);
    result.hasRef = true;
  }
  return result;
}

/** Stable, filesystem-safe cache key for a repo (+ref when named). */
export function githubCacheKey(target: GithubTarget): string {
  const base = `${target.owner.toLowerCase()}__${target.repo.toLowerCase()}`;
  if (!target.ref) return base;
  const safe = target.ref.replace(/[^A-Za-z0-9_.\-]/g, "-").slice(0, 60);
  return `${base}__${safe}`;
}

/** GitHub URLs are treated as repository inputs (kind REPOSITORY, source GITHUB). */
export function isGithubInput(text: string): boolean {
  return extractGithubUrlFromMessage(text) !== undefined;
}
