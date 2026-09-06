/**
 * GitHub repository materialization (plan 9-7 §11). Clones/fetches a parsed
 * GitHub target into the repo cache, checks out the requested ref, and
 * returns the durable local path so Boss can scan real code (never forwards
 * the URL to a chat page).
 *
 * Cache layout: <root>/<repo-hash>/ (repo-hash = githubCacheKey). A marker
 * file records origin + ref so repeat resolves reuse the checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { GithubTarget } from "../../src/shared/github-url";
import { githubCacheKey } from "../../src/shared/github-url";

export interface GithubResolveResult {
  /** Materialized repo checkout directory (contains .git). */
  checkoutDir: string;
  target: GithubTarget;
  reusedCache: boolean;
}

interface MarkerFile {
  schemaVersion: 1;
  origin: string;
  ref?: string;
  resolvedAt: string;
}

export class GithubResolver {
  constructor(
    private readonly cacheRoot: string,
    private readonly gitExec = "git"
  ) {
    fs.mkdirSync(cacheRoot, { recursive: true });
  }

  private runGit(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.gitExec, args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 120000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${this.gitExec} ${args.join(" ")} failed: ${(stderr || "").trim().slice(0, 400) || String(error)}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  private originFor(target: GithubTarget, origin?: string): string {
    return origin ?? `https://github.com/${target.owner}/${target.repo}.git`;
  }

  /**
   * Returns a materialized checkout. Same-repo checkouts are reused without
   * network; pass forceFetch to refresh an existing checkout.
   */
  async resolve(target: GithubTarget, options: { forceFetch?: boolean; origin?: string } = {}): Promise<GithubResolveResult> {
    if (!target?.owner || !target?.repo) throw new Error("Invalid GitHub target");
    const key = githubCacheKey(target);
    const origin = this.originFor(target, options.origin);
    const checkoutDir = path.resolve(this.cacheRoot, key);
    const markerOk = this.markerMatches(checkoutDir, origin, target.ref);
    if (markerOk && !options.forceFetch) return { checkoutDir, target, reusedCache: true };
    if (markerOk) {
      await this.refresh(checkoutDir, origin, target.ref);
      return { checkoutDir, target, reusedCache: true };
    }

    const staging = path.join(this.cacheRoot, `.staging-${key}-${process.pid}-${Date.now()}`);
    fs.rmSync(staging, { recursive: true, force: true });
    if (fs.existsSync(checkoutDir)) fs.rmSync(checkoutDir, { recursive: true, force: true });
    try {
      // Shallow clone of the requested ref where possible; fall back to full
      // clone + local checkout when the ref is not a branch/tag name git knows.
      if (target.ref) {
        try { await this.runGit(["clone", "--quiet", "--depth", "1", "--branch", target.ref, origin, staging]); }
        catch {
          fs.rmSync(staging, { recursive: true, force: true });
          await this.runGit(["clone", "--quiet", origin, staging]);
          await this.checkoutRef(staging, origin, target.ref);
        }
      } else {
        await this.runGit(["clone", "--quiet", origin, staging]);
      }
      fs.renameSync(staging, checkoutDir);
      this.writeMarker(checkoutDir, origin, target.ref);
      return { checkoutDir, target, reusedCache: false };
    } finally {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  private async refresh(checkoutDir: string, origin: string, ref?: string): Promise<void> {
    await this.runGit(["fetch", "--quiet", "origin"], checkoutDir);
    if (ref) await this.checkoutRef(checkoutDir, origin, ref);
    else await this.runGit(["pull", "--quiet", "--ff-only"], checkoutDir);
    this.writeMarker(checkoutDir, origin, ref);
  }

  /** Checks out a ref (branch/tag/commit), fetching it from origin when needed. */
  private async checkoutRef(dir: string, origin: string, ref: string): Promise<void> {
    try {
      await this.runGit(["checkout", "--quiet", ref], dir);
    } catch {
      try {
        await this.runGit(["checkout", "--quiet", `origin/${ref}`], dir);
      } catch {
        await this.runGit(["fetch", "--quiet", "origin", ref], dir);
        await this.runGit(["checkout", "--quiet", "FETCH_HEAD"], dir);
      }
    }
  }

  private markerMatches(checkoutDir: string, origin: string, ref?: string): boolean {
    if (!fs.existsSync(path.join(checkoutDir, ".git"))) return false;
    const marker = this.readMarker(checkoutDir);
    if (!marker) return false;
    return marker.origin === origin && (marker.ref ?? undefined) === ref;
  }

  private readMarker(checkoutDir: string): MarkerFile | undefined {
    try {
      return JSON.parse(fs.readFileSync(path.join(checkoutDir, ".codex-boss-github.json"), "utf8")) as MarkerFile;
    } catch {
      return undefined;
    }
  }

  private writeMarker(checkoutDir: string, origin: string, ref?: string): void {
    const marker: MarkerFile = { schemaVersion: 1, origin, ref, resolvedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(checkoutDir, ".codex-boss-github.json"), JSON.stringify(marker, null, 2), "utf8");
  }
}
