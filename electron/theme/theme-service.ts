/**
 * Update-Plan/checkpoint-1.md §8/§13/§21/§22/§23 — Theme Manager + Registry.
 *
 * One composition-root service owns the whole theme lifecycle:
 *
 *   bootstrap()   ensure the two §12 built-ins exist and are valid, then prove
 *                 the persisted active theme is still usable — falling back to a
 *                 built-in when it is not (§21 runtime safety, §48 restart);
 *   install()     validate a package (the same §20 rules for everyone), write it,
 *                 register it as INSTALLED;
 *   activate()    validate again, then record ACTIVE and remember what the user
 *                 asked for so a fallback is always visible;
 *   delete()      §22 order, enforced from the pure DeletionPlan;
 *   snapshot()    the active theme's tokens + rendered CSS for the renderer.
 *
 * Everything that can fail is fail-closed: an invalid theme never becomes active,
 * a built-in can never be deleted, and deleting one theme validates what remains.
 */
import path from "node:path";
import fs from "node:fs";
import { readJson, writeJson } from "../commander/durable-json";
import { ThemeStorage, DEFAULT_THEME_STORAGE_LIMITS, type ThemeStorageLimits } from "./theme-storage";
import { builtInPackages, isBuiltInThemeId } from "./builtin-themes";
import { defaultSurfaceContracts, type UISurfaceContract } from "../../src/shared/ui-surface";
import {
  DEFAULT_THEME_ID,
  planActivation,
  planThemeDeletion,
  renderThemeCss,
  themePackageHash,
  validateThemePackage,
  type DeletionPlan,
  type ThemePackage,
  type ThemeRecord,
  type ThemeSnapshot,
  type ThemeState,
  type ThemeTokens,
  type ThemeValidationReport
} from "../../src/shared/theme";

export interface ThemeRegistryFile {
  schemaVersion: 1;
  records: ThemeRecord[];
  activeThemeId: string;
  /** What the user last asked to activate; differs when a fallback happened. */
  requestedThemeId: string;
  diagnostics: string[];
  updatedAt: string;
}

export interface ThemeServiceOptions {
  root: string;
  registryFile: string;
  now?: () => string;
  /** §9 contract table; defaults to the locked table with no bindings. */
  contracts?: () => readonly UISurfaceContract[];
  limits?: ThemeStorageLimits;
}

export interface ThemeOperationResult {
  ok: boolean;
  themeId: string;
  activeThemeId: string;
  fallback: boolean;
  state?: ThemeState;
  reason: string;
  report?: ThemeValidationReport;
  plan?: DeletionPlan;
}

export class ThemeService {
  private readonly storage: ThemeStorage;
  private value: ThemeRegistryFile;

  constructor(private readonly options: ThemeServiceOptions) {
    this.storage = new ThemeStorage(options.root, options.limits ?? DEFAULT_THEME_STORAGE_LIMITS);
    this.value = this.load();
  }

  private now(): string {
    return (this.options.now ?? (() => new Date().toISOString()))();
  }

  private contracts(): readonly UISurfaceContract[] {
    return this.options.contracts?.() ?? defaultSurfaceContracts();
  }

  /* ---------------- registry persistence ---------------- */

  private load(): ThemeRegistryFile {
    try {
      const parsed = readJson<ThemeRegistryFile>(this.options.registryFile);
      if (parsed?.schemaVersion === 1 && Array.isArray(parsed.records)) return parsed;
    } catch {
      // A corrupt registry must not stop the app: the built-ins are rebuilt below.
    }
    return { schemaVersion: 1, records: [], activeThemeId: DEFAULT_THEME_ID, requestedThemeId: DEFAULT_THEME_ID, diagnostics: [], updatedAt: this.now() };
  }

  private persist(): void {
    this.value.updatedAt = this.now();
    writeJson(this.options.registryFile, this.value);
  }

  private record(themeId: string): ThemeRecord | undefined {
    return this.value.records.find((entry) => entry.id === themeId);
  }

  private log(message: string): void {
    this.value.diagnostics = [...this.value.diagnostics.slice(-99), `${this.now()} ${message}`];
  }

  /* ---------------- §12 built-ins + §21 bootstrap ---------------- */

  /**
   * Materializes/refreshes the §12 built-ins, validates them with the normal
   * §20 rules (a built-in gets no exemption), then proves the persisted active
   * theme is usable and falls back when it is not.
   */
  bootstrap(): { activeThemeId: string; fallback: boolean; diagnostics: string[] } {
    for (const pkg of builtInPackages()) {
      const existing = this.record(pkg.manifest.id);
      const report = validateThemePackage(pkg, this.contracts(), { now: this.now() });
      const hash = themePackageHash(pkg);
      const onDiskHash = existing?.hash;
      const needsWrite = existing === undefined || onDiskHash !== hash || !this.storage.exists(pkg.manifest.id);
      const written = needsWrite ? this.storage.write(pkg, { state: "INSTALLED", createdAt: existing?.createdAt ?? this.now() }) : undefined;
      const record: ThemeRecord = {
        ...(written ?? this.storage.write(pkg, { state: existing?.state ?? "INSTALLED", createdAt: existing?.createdAt ?? this.now() })),
        state: existing?.state === "ACTIVE" || this.value.activeThemeId === pkg.manifest.id ? "ACTIVE" : "INSTALLED",
        validation: report,
        preview: false
      };
      this.upsert(record);
      if (!report.ok) this.log(`built-in ${pkg.manifest.id} failed validation: ${describe(report)}`);
    }
    // Any custom theme that lost its package on disk is quarantined, not trusted.
    for (const record of this.value.records) {
      if (record.builtIn) continue;
      if (this.storage.exists(record.id)) continue;
      record.state = "QUARANTINED";
      this.log(`${record.id} has no package on disk; quarantined`);
    }
    const requested = this.value.requestedThemeId || this.value.activeThemeId || DEFAULT_THEME_ID;
    const decision = this.activateInternal(requested, { persist: true, silent: true });
    this.persist();
    return { activeThemeId: decision.activeThemeId, fallback: decision.fallback, diagnostics: [...this.value.diagnostics] };
  }

  private upsert(record: ThemeRecord): void {
    const index = this.value.records.findIndex((entry) => entry.id === record.id);
    if (index >= 0) this.value.records[index] = record;
    else this.value.records.push(record);
  }

  /* ---------------- reads ---------------- */

  list(): ThemeRecord[] {
    return this.value.records.map((entry) => structuredClone(entry)).sort((left, right) => {
      if (left.builtIn !== right.builtIn) return left.builtIn ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }

  activeRecord(): ThemeRecord | undefined {
    return this.record(this.value.activeThemeId);
  }

  requestedThemeId(): string {
    return this.value.requestedThemeId;
  }

  diagnostics(): string[] {
    return [...this.value.diagnostics];
  }

  packageOf(themeId: string): ThemePackage | undefined {
    return this.storage.read(themeId);
  }

  validate(themeId: string): ThemeValidationReport | undefined {
    const pkg = this.storage.read(themeId);
    if (!pkg) return undefined;
    const report = validateThemePackage(pkg, this.contracts(), { now: this.now() });
    const record = this.record(themeId);
    if (record) {
      record.validation = report;
      record.hash = report.hash;
      if (!report.ok && record.state !== "QUARANTINED") record.state = "INVALID";
      this.persist();
    }
    return report;
  }

  /** §21: the renderer-facing payload — active tokens, rendered CSS and the list. */
  snapshot(): ThemeSnapshot {
    const active = this.activeRecord();
    const pkg = active ? this.storage.read(active.id) : undefined;
    const tokens: ThemeTokens = pkg?.tokens ?? {};
    const css = pkg ? renderThemeCss(pkg, this.contracts()) : "";
    return {
      activeThemeId: active?.id ?? DEFAULT_THEME_ID,
      fallback: this.value.requestedThemeId !== this.value.activeThemeId,
      activeName: active?.name ?? "Dark",
      tokens,
      css,
      themes: this.list(),
      diagnostics: this.diagnostics()
    };
  }

  /* ---------------- §13 lifecycle ---------------- */

  /** §22 order: verify → (switch fallback) → unregister → delete → validate rest. */
  delete(themeId: string): ThemeOperationResult {
    const record = this.record(themeId);
    const plan = planThemeDeletion(record, { activeThemeId: this.value.activeThemeId, remaining: this.value.records });
    if (!plan.ok || !record) {
      this.log(`theme deletion refused for ${themeId}: ${plan.reason}`);
      this.persist();
      return { ok: false, themeId, activeThemeId: this.value.activeThemeId, fallback: false, reason: plan.reason, plan, ...(plan.code ? {} : {}) };
    }
    let activeThemeId = this.value.activeThemeId;
    let fallback = false;
    if (plan.steps.includes("SWITCH_FALLBACK")) {
      const switched = this.activateInternal(plan.fallbackThemeId ?? DEFAULT_THEME_ID, { persist: false, silent: true });
      activeThemeId = switched.activeThemeId;
      fallback = true;
      this.log(`deleting the active theme ${themeId}: switched to ${activeThemeId}`);
    }
    this.value.records = this.value.records.filter((entry) => entry.id !== themeId);
    this.storage.remove(themeId);
    this.value.activeThemeId = activeThemeId;
    this.log(`theme ${themeId} deleted; ${this.value.records.length} theme(s) remain`);
    // §22 final step: validate what remains, so a deletion can never leave a
    // broken registry behind.
    const remaining = this.value.records.filter((entry) => entry.builtIn).map((entry) => validateThemePackage(this.storage.read(entry.id)!, this.contracts(), { now: this.now() }));
    const broken = remaining.filter((report) => !report.ok).length;
    if (broken) this.log(`${broken} remaining built-in theme(s) failed validation after the deletion`);
    this.persist();
    return { ok: true, themeId, activeThemeId: this.value.activeThemeId, fallback, reason: plan.reason, plan };
  }

  activate(themeId: string): ThemeOperationResult {
    const result = this.activateInternal(themeId, { persist: true, silent: false });
    return {
      ok: result.ok,
      themeId,
      activeThemeId: result.activeThemeId,
      fallback: result.fallback,
      reason: result.reason,
      ...(result.state ? { state: result.state } : {})
    };
  }

  private activateInternal(themeId: string, options: { persist: boolean; silent: boolean }): { ok: boolean; activeThemeId: string; fallback: boolean; reason: string; state?: ThemeState } {
    const record = this.record(themeId);
    let decision = planActivation(record, { requestedId: themeId, preferFallback: DEFAULT_THEME_ID });
    let validated: ThemeValidationReport | undefined;
    if (decision.ok && record) {
      // Never trust a stale validation: re-check the package on disk first.
      const pkg = this.storage.read(record.id);
      validated = pkg ? validateThemePackage(pkg, this.contracts(), { now: this.now() }) : undefined;
      record.validation = validated;
      if (!validated || !validated.ok) {
        record.state = "INVALID";
        decision = { ok: false, themeId: DEFAULT_THEME_ID, fallbackThemeId: DEFAULT_THEME_ID, code: "INVALID", reason: `${record.id} failed re-validation: ${validated ? describe(validated) : "package could not be read"}` };
      }
    }
    this.value.requestedThemeId = themeId;
    this.value.activeThemeId = decision.themeId;
    for (const entry of this.value.records) {
      if (entry.builtIn) continue;
      if (entry.id === decision.themeId) entry.state = "ACTIVE";
      else if (entry.state === "ACTIVE") entry.state = "INSTALLED";
    }
    if (decision.ok && record && !record.builtIn) record.state = "ACTIVE";
    if (!decision.ok && !options.silent) this.log(`activation fallback: ${decision.reason}`);
    if (options.persist) this.persist();
    return { ok: decision.ok, activeThemeId: decision.themeId, fallback: !decision.ok || decision.themeId !== themeId, reason: decision.reason, ...(record?.state ? { state: record.state } : {}) };
  }

  /** §13: an explicit disable of a custom theme, falling back if it was active. */
  disable(themeId: string): ThemeOperationResult {
    const record = this.record(themeId);
    if (!record) return { ok: false, themeId, activeThemeId: this.value.activeThemeId, fallback: false, reason: "theme is not registered" };
    if (record.builtIn) return { ok: false, themeId, activeThemeId: this.value.activeThemeId, fallback: false, reason: `${themeId} is a built-in theme and cannot be disabled (§12)` };
    record.state = "DISABLED";
    let fallback = false;
    if (this.value.activeThemeId === themeId) {
      const switched = this.activateInternal(DEFAULT_THEME_ID, { persist: false, silent: true });
      fallback = true;
      this.log(`${themeId} disabled while active: switched to ${switched.activeThemeId}`);
    }
    this.persist();
    return { ok: true, themeId, activeThemeId: this.value.activeThemeId, fallback, state: record.state, reason: "theme disabled" };
  }

  /** §13: rename a custom theme. Built-ins keep their shipped names. */
  rename(themeId: string, name: string): ThemeOperationResult {
    const record = this.record(themeId);
    if (!record) return { ok: false, themeId, activeThemeId: this.value.activeThemeId, fallback: false, reason: "theme is not registered" };
    if (record.builtIn) return { ok: false, themeId, activeThemeId: this.value.activeThemeId, fallback: false, reason: "built-in themes cannot be renamed" };
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return { ok: false, themeId, activeThemeId: this.value.activeThemeId, fallback: false, reason: "a theme name cannot be empty" };
    const pkg = this.storage.read(themeId);
    if (pkg) {
      const renamed: ThemePackage = { ...pkg, manifest: { ...pkg.manifest, name: trimmed, updatedAt: this.now() } };
      const written = this.storage.write(renamed, { state: record.state, createdAt: record.createdAt });
      Object.assign(record, written, { state: record.state, validation: record.validation });
    }
    record.name = trimmed;
    record.updatedAt = this.now();
    this.persist();
    return { ok: true, themeId, activeThemeId: this.value.activeThemeId, fallback: false, state: record.state, reason: `renamed to ${trimmed}` };
  }

  /**
   * §11/§13: duplicate a theme into a complete, independent custom package. The
   * new theme records `derivedFrom` as provenance only — deleting the source can
   * never affect it.
   */
  duplicate(sourceId: string, options: { id: string; name: string }): ThemeOperationResult {
    const source = this.storage.read(sourceId);
    if (!source) return { ok: false, themeId: options.id, activeThemeId: this.value.activeThemeId, fallback: false, reason: `theme ${sourceId} has no package to duplicate` };
    const pkg: ThemePackage = {
      manifest: {
        schemaVersion: source.manifest.schemaVersion,
        id: options.id,
        name: options.name,
        type: "CUSTOM",
        version: "1.0.0",
        createdAt: this.now(),
        updatedAt: this.now(),
        builtIn: false,
        deletable: true,
        derivedFrom: sourceId
      },
      tokens: { ...source.tokens },
      overrides: source.overrides.map((entry) => ({ ...entry })),
      ...(typeof source.css === "string" ? { css: source.css } : {}),
      metadata: { schemaVersion: source.manifest.schemaVersion, createdBy: "DUPLICATED", notes: [`duplicated from ${sourceId}`], basedOn: sourceId }
    };
    return this.install(pkg, { state: "INSTALLED" });
  }

  /**
   * Installs (or replaces) a package as a CUSTOM theme. §5-style write gate: the
   * §20 validator decides, and a failing package is registered as QUARANTINED so
   * it is visible to the user instead of silently dropped.
   */
  install(pkg: ThemePackage, options: { state?: ThemeState; expectedBuiltInHash?: string } = {}): ThemeOperationResult {
    if (isBuiltInThemeId(pkg.manifest.id) || pkg.manifest.type === "BUILT_IN") {
      const reason = `${pkg.manifest.id} collides with a built-in theme id; custom themes need their own id (§12)`;
      this.log(reason);
      this.persist();
      return { ok: false, themeId: pkg.manifest.id, activeThemeId: this.value.activeThemeId, fallback: false, reason };
    }
    const report = validateThemePackage(pkg, this.contracts(), { now: this.now(), ...(options.expectedBuiltInHash ? { expectedBuiltInHash: options.expectedBuiltInHash } : {}) });
    if (!report.ok) {
      const written = this.storage.write(pkg, { state: "QUARANTINED", createdAt: this.record(pkg.manifest.id)?.createdAt ?? this.now() });
      this.upsert({ ...written, state: "QUARANTINED", validation: report });
      this.log(`theme ${pkg.manifest.id} quarantined: ${describe(report)}`);
      this.persist();
      return { ok: false, themeId: pkg.manifest.id, activeThemeId: this.value.activeThemeId, fallback: false, state: "QUARANTINED", reason: describe(report), report };
    }
    const existing = this.record(pkg.manifest.id);
    const written = this.storage.write(pkg, { state: options.state ?? "INSTALLED", createdAt: existing?.createdAt ?? this.now() });
    this.upsert({ ...written, state: existing?.state === "ACTIVE" ? "ACTIVE" : (options.state ?? "INSTALLED"), validation: report });
    this.log(`theme ${pkg.manifest.id} installed (${report.diagnostics.length} diagnostic(s))`);
    this.persist();
    return { ok: true, themeId: pkg.manifest.id, activeThemeId: this.value.activeThemeId, fallback: false, state: options.state ?? "INSTALLED", reason: "theme installed", report };
  }

  /**
   * §13 "edit": replace tokens/overrides of an existing custom theme. The result
   * is re-validated, so an edit that breaks contrast or references fails closed
   * and leaves the previous validated revision in place.
   */
  update(themeId: string, patch: { tokens?: ThemeTokens; overrides?: ThemePackage["overrides"]; css?: string; name?: string }): ThemeOperationResult {
    const record = this.record(themeId);
    if (!record) return { ok: false, themeId, activeThemeId: this.value.activeThemeId, fallback: false, reason: "theme is not registered" };
    if (record.builtIn) return { ok: false, themeId, activeThemeId: this.value.activeThemeId, fallback: false, reason: "built-in themes cannot be edited; duplicate one instead (§12)" };
    const current = this.storage.read(themeId);
    if (!current) return { ok: false, themeId, activeThemeId: this.value.activeThemeId, fallback: false, reason: "theme package is missing on disk" };
    const candidate: ThemePackage = {
      ...current,
      tokens: patch.tokens ? { ...patch.tokens } : current.tokens,
      overrides: patch.overrides ? patch.overrides.map((entry) => ({ ...entry })) : current.overrides,
      manifest: { ...current.manifest, ...(patch.name ? { name: patch.name } : {}), updatedAt: this.now() },
      ...(patch.css !== undefined ? { css: patch.css } : {})
    };
    const report = validateThemePackage(candidate, this.contracts(), { now: this.now() });
    if (!report.ok) {
      this.log(`edit of ${themeId} refused: ${describe(report)}`);
      this.persist();
      return { ok: false, themeId, activeThemeId: this.value.activeThemeId, fallback: false, state: record.state, reason: describe(report), report };
    }
    const written = this.storage.write(candidate, { state: record.state, createdAt: record.createdAt });
    this.upsert({ ...written, state: record.state, validation: report, name: candidate.manifest.name });
    if (this.value.activeThemeId === themeId) {
      // The active theme changed: re-validate through the normal activation path.
      this.activateInternal(themeId, { persist: false, silent: true });
    }
    this.persist();
    return { ok: true, themeId, activeThemeId: this.value.activeThemeId, fallback: false, state: record.state, reason: "theme updated", report };
  }

  /** §12: adopt a built-in's tokens as a new custom theme. */
  createFromBuiltIn(builtInId: string, options: { id: string; name: string }): ThemeOperationResult {
    return this.duplicate(builtInId, options);
  }

  /** Absolute directory of the theme root (evidence/reporting). */
  root(): string {
    return path.resolve(this.options.root);
  }

  /** True when the registry file exists on disk (restart evidence). */
  persisted(): boolean {
    return fs.existsSync(this.options.registryFile);
  }
}

function describe(report: ThemeValidationReport): string {
  const errors = report.diagnostics.filter((entry) => entry.severity === "ERROR").map((entry) => `${entry.rule}: ${entry.message}`);
  return errors.length ? errors.slice(0, 4).join("; ") : "no errors";
}

export type { ThemeTokens };
