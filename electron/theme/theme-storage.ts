/**
 * Update-Plan/checkpoint-1.md §8/§11 — theme storage.
 *
 * Every theme is one directory under the theme root (§11):
 *
 *   themes/<theme-id>/
 *     theme.json      manifest
 *     tokens.json     §10 semantic tokens
 *     overrides.css   optional free-form stylesheet (never executed)
 *     metadata.json   provenance of the package
 *     preview.json    optional preview note (CP5 fills this in)
 *
 * `overrides.json` carries the §9.1 surface overrides, kept as data so the
 * validator — not the renderer — decides whether they are allowed.
 *
 * Two guarantees matter here: writing is atomic per file (the shared durable
 * writer), and reading never escapes the theme root (§20 filesystem escapes).
 */
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../commander/durable-json";
import {
  THEME_SCHEMA_VERSION,
  themePackageHash,
  type ThemePackage,
  type ThemeRecord,
  type ThemeSurfaceOverride
} from "../../src/shared/theme";

export interface ThemeStorageLimits {
  maxTokensBytes: number;
  maxCssBytes: number;
  maxOverrides: number;
}

export const DEFAULT_THEME_STORAGE_LIMITS: ThemeStorageLimits = {
  maxTokensBytes: 64 * 1024,
  maxCssBytes: 256 * 1024,
  maxOverrides: 400
};

export class ThemeStorage {
  constructor(
    private readonly root: string,
    private readonly limits: ThemeStorageLimits = DEFAULT_THEME_STORAGE_LIMITS
  ) {}

  /** Absolute directory for a theme id, refusing anything that escapes the root. */
  directoryFor(themeId: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(themeId)) throw new Error(`invalid theme id: ${themeId}`);
    const directory = path.resolve(this.root, themeId);
    const root = path.resolve(this.root);
    if (directory !== root && !directory.startsWith(root + path.sep)) throw new Error(`theme path escapes the theme root: ${themeId}`);
    return directory;
  }

  list(): string[] {
    try {
      return fs.readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9._-]{1,63}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  /** Writes a package to disk and returns the record facts derived from it. */
  write(pkg: ThemePackage, facts: { state: ThemeRecord["state"]; createdAt: string }): ThemeRecord {
    const directory = this.directoryFor(pkg.manifest.id);
    fs.mkdirSync(directory, { recursive: true });
    writeJson(path.join(directory, "theme.json"), pkg.manifest);
    writeJson(path.join(directory, "tokens.json"), { schemaVersion: THEME_SCHEMA_VERSION, tokens: pkg.tokens });
    writeJson(path.join(directory, "overrides.json"), { schemaVersion: THEME_SCHEMA_VERSION, overrides: pkg.overrides });
    writeJson(path.join(directory, "metadata.json"), pkg.metadata);
    if (typeof pkg.css === "string" && pkg.css.length) fs.writeFileSync(path.join(directory, "overrides.css"), pkg.css.slice(0, this.limits.maxCssBytes), "utf8");
    else fs.rmSync(path.join(directory, "overrides.css"), { force: true });
    return {
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      type: pkg.manifest.type,
      version: pkg.manifest.version,
      builtIn: pkg.manifest.builtIn,
      deletable: pkg.manifest.deletable,
      path: path.relative(this.root, directory).split(path.sep).join("/"),
      hash: themePackageHash(pkg),
      createdAt: facts.createdAt,
      updatedAt: new Date().toISOString(),
      state: facts.state,
      preview: false
    };
  }

  /** Reads a package back. A malformed package returns undefined (never throws). */
  read(themeId: string): ThemePackage | undefined {
    let directory: string;
    try { directory = this.directoryFor(themeId); } catch { return undefined; }
    const manifest = readJson<ThemePackage["manifest"]>(path.join(directory, "theme.json"));
    if (!manifest) return undefined;
    const tokensFile = readJson<{ schemaVersion: number; tokens: Record<string, string> }>(path.join(directory, "tokens.json"));
    const overridesFile = readJson<{ schemaVersion: number; overrides: ThemeSurfaceOverride[] }>(path.join(directory, "overrides.json"));
    const metadata = readJson<ThemePackage["metadata"]>(path.join(directory, "metadata.json"));
    let css: string | undefined;
    try {
      const cssPath = path.join(directory, "overrides.css");
      if (fs.existsSync(cssPath)) {
        const stat = fs.statSync(cssPath);
        if (stat.size > this.limits.maxCssBytes) throw new Error(`overrides.css exceeds ${this.limits.maxCssBytes} bytes`);
        css = fs.readFileSync(cssPath, "utf8");
      }
    } catch {
      // An unreadable or over-sized stylesheet is a validation failure, not a crash.
      css = "";
    }
    const overrides = Array.isArray(overridesFile?.overrides) ? overridesFile!.overrides.slice(0, this.limits.maxOverrides) : [];
    const pkg: ThemePackage = {
      manifest,
      tokens: tokensFile?.tokens && typeof tokensFile.tokens === "object" ? tokensFile.tokens : {},
      overrides,
      metadata: metadata ?? { schemaVersion: THEME_SCHEMA_VERSION, createdBy: "IMPORTED", notes: [] }
    };
    if (css !== undefined) pkg.css = css;
    return pkg;
  }

  remove(themeId: string): void {
    const directory = this.directoryFor(themeId);
    fs.rmSync(directory, { recursive: true, force: true });
  }

  exists(themeId: string): boolean {
    try { return fs.existsSync(path.join(this.directoryFor(themeId), "theme.json")); } catch { return false; }
  }
}
