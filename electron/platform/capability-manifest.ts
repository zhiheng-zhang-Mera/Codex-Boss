import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  formatCapabilityRef,
  isValidCapabilityId,
  isValidSemver,
  isValidStateNamespace,
  parseCapabilityRef,
  type CapabilityManifest,
  type CapabilityPermissionClaim,
  type CapabilityRef,
  type CapabilityRequirement,
  type ManifestProblem
} from "./capability-contract";

/**
 * Manifest parsing and validation (platform foundation, Phase 01 Task A).
 *
 * One job: turn untrusted manifest files into either a validated
 * `CapabilityManifest` or a list of problems precise enough to fix. It is a pure
 * function of file contents — no caching, no registry, no global state — so a test
 * can feed it a deliberately broken manifest and assert the exact rejection.
 *
 * The rejections the engineering book mandates are all here: empty id, duplicate
 * provide, invalid semver, and the same capability appearing as both required and
 * optional. Beyond those, this parser rejects any manifest that would make the
 * graph ambiguous (two spellings of one interface, a requirement with no stated
 * reason, a state claim owned by somebody else) because those are the failures
 * that would only surface much later as a mystery at boot.
 */

/** A manifest that failed validation, kept together with everything wrong with it. */
export class ManifestValidationError extends Error {
  constructor(readonly source: string, readonly problems: readonly ManifestProblem[]) {
    super(`${source}: ${problems.length} manifest problem(s)\n${problems.map((problem) => `  ${problem.path}: ${problem.message}`).join("\n")}`);
    this.name = "ManifestValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collects problems against a dotted field path, so one pass reports every error. */
class Problems {
  readonly list: ManifestProblem[] = [];
  constructor(private readonly source: string) {}
  add(path: string, message: string): void {
    this.list.push({ source: this.source, path, message });
  }
}

function readStringArray(problems: Problems, raw: unknown, field: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.add(field, "must be an array");
    return [];
  }
  const out: string[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== "string") {
      problems.add(`${field}[${index}]`, "must be a string");
      continue;
    }
    out.push(entry.trim());
  }
  return out;
}

/**
 * Parse one `provides` entry.
 *
 * A duplicate provide is rejected with the canonical spelling of the first
 * occurrence, so the message names the value the author has to delete rather than
 * whatever spelling came second.
 */
function readProvides(problems: Problems, raw: unknown): CapabilityRef[] {
  const declared = readStringArray(problems, raw, "provides");
  const seen = new Set<string>();
  const out: CapabilityRef[] = [];
  for (const [index, entry] of declared.entries()) {
    const parsed = parseCapabilityRef(entry);
    if (!parsed) {
      problems.add(`provides[${index}]`, `not a capability reference (expected "id@major" with a positive integer major): ${JSON.stringify(entry)}`);
      continue;
    }
    const canonical = formatCapabilityRef(parsed);
    if (seen.has(canonical)) {
      problems.add(`provides[${index}]`, `duplicate provide: ${canonical} is already provided by this manifest`);
      continue;
    }
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

/**
 * Parse one requirement list.
 *
 * `required` and `optional` are parsed by the same code with a different `kind`,
 * which is what makes the cross-list check below exact rather than string-matched.
 */
function readRequirements(problems: Problems, raw: unknown, field: "requires" | "optional"): CapabilityRequirement[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.add(field, "must be an array");
    return [];
  }
  const out: CapabilityRequirement[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const at = `${field}[${index}]`;
    if (!isRecord(entry)) {
      problems.add(at, "must be a mapping with a `ref` and a `reason`");
      continue;
    }
    const refRaw = entry.ref;
    if (typeof refRaw !== "string") {
      problems.add(`${at}.ref`, "is required and must be a string");
      continue;
    }
    const parsed = parseCapabilityRef(refRaw);
    if (!parsed) {
      problems.add(`${at}.ref`, `not a capability reference (expected "id@major" with a positive integer major): ${JSON.stringify(refRaw)}`);
      continue;
    }
    const canonical = formatCapabilityRef(parsed);
    if (seen.has(canonical)) {
      problems.add(`${at}.ref`, `duplicate ${field} entry: ${canonical}`);
      continue;
    }
    const reason = entry.reason;
    if (typeof reason !== "string" || reason.trim() === "") {
      problems.add(`${at}.reason`, "is required and must be a non-empty string — an unexplained dependency edge is not reviewable");
      continue;
    }
    seen.add(canonical);
    out.push({ ref: canonical, capability: parsed, kind: field === "requires" ? "required" : "optional", reason: reason.trim() });
  }
  return out;
}

/**
 * Reject the same interface appearing in both lists.
 *
 * This is the mandated "one capability both required and optional" case, and it is
 * checked on the canonical `id@major` rather than the raw text, so `foo@1` and a
 * padded `" foo@1 "` cannot slip through as two different entries.
 */
function rejectContradictoryRequirements(problems: Problems, requires: readonly CapabilityRequirement[], optional: readonly CapabilityRequirement[]): void {
  const requiredRefs = new Set(requires.map((requirement) => requirement.ref));
  for (const [index, entry] of optional.entries()) {
    if (requiredRefs.has(entry.ref)) {
      problems.add(`optional[${index}].ref`, `contradiction: ${entry.ref} is declared in both \`requires\` and \`optional\``);
    }
  }
}

function readStateClaims(problems: Problems, raw: unknown, id: string): CapabilityManifest["state"] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.add("state", "must be an array");
    return [];
  }
  const out: CapabilityManifest["state"] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const at = `state[${index}]`;
    if (!isRecord(entry)) {
      problems.add(at, "must be a mapping with `namespace` and `owner`");
      continue;
    }
    const namespace = entry.namespace;
    if (typeof namespace !== "string" || !isValidStateNamespace(namespace)) {
      problems.add(`${at}.namespace`, `must be a lowercase dotted namespace: ${JSON.stringify(namespace)}`);
      continue;
    }
    const owner = entry.owner;
    if (typeof owner !== "string" || !isValidCapabilityId(owner)) {
      problems.add(`${at}.owner`, `must be a capability id: ${JSON.stringify(owner)}`);
      continue;
    }
    if (owner !== id) {
      // A manifest may only claim its own state. Letting it name another owner is
      // how ownership gets silently reassigned by editing the wrong file.
      problems.add(`${at}.owner`, `a manifest may only claim its own state: ${owner} != ${id}`);
      continue;
    }
    if (seen.has(namespace)) {
      problems.add(`${at}.namespace`, `duplicate state claim: ${namespace}`);
      continue;
    }
    seen.add(namespace);
    out.push({ namespace, owner });
  }
  return out;
}

function readPaths(problems: Problems, raw: unknown, field: "modules" | "surface" | "bootModules"): string[] {
  const declared = readStringArray(problems, raw, field);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of declared.entries()) {
    // Repo-relative POSIX paths only: a manifest must not depend on the machine it
    // is read on, and the ratchet compares these against paths it derived the same way.
    if (entry.startsWith("/") || /^[A-Za-z]:/.test(entry) || entry.includes("\\")) {
      problems.add(`${field}[${index}]`, `must be a repo-relative POSIX path: ${JSON.stringify(entry)}`);
      continue;
    }
    const normalized = path.posix.normalize(entry);
    if (normalized.startsWith("..")) {
      problems.add(`${field}[${index}]`, `must stay inside the repository: ${JSON.stringify(entry)}`);
      continue;
    }
    if (seen.has(normalized)) {
      problems.add(`${field}[${index}]`, `duplicate path: ${normalized}`);
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function readPermissions(problems: Problems, raw: unknown): CapabilityPermissionClaim[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.add("permissions", "must be an array");
    return [];
  }
  const out: CapabilityPermissionClaim[] = [];
  for (const [index, entry] of raw.entries()) {
    const at = `permissions[${index}]`;
    if (!isRecord(entry)) {
      problems.add(at, "must be a mapping with a `capability`");
      continue;
    }
    if (typeof entry.capability !== "string" || entry.capability.trim() === "") {
      problems.add(`${at}.capability`, "is required and must be a non-empty string");
      continue;
    }
    const claim: CapabilityPermissionClaim = { capability: entry.capability.trim() };
    if (entry.resource !== undefined) {
      if (typeof entry.resource !== "string") { problems.add(`${at}.resource`, "must be a string when present"); continue; }
      claim.resource = entry.resource;
    }
    if (entry.action !== undefined) {
      if (typeof entry.action !== "string") { problems.add(`${at}.action`, "must be a string when present"); continue; }
      claim.action = entry.action;
    }
    out.push(claim);
  }
  return out;
}

/**
 * Validate an already-decoded manifest value.
 *
 * Returns every problem it finds rather than throwing on the first: a manifest
 * with three mistakes should take one edit to fix, not three runs.
 */
export function validateCapabilityManifest(raw: unknown, source: string): { manifest?: CapabilityManifest; problems: ManifestProblem[] } {
  const problems = new Problems(source);
  if (!isRecord(raw)) {
    problems.add("", "manifest must be a mapping");
    return { problems: problems.list };
  }

  const idRaw = raw.id;
  let id = "";
  if (typeof idRaw !== "string" || idRaw.trim() === "") {
    problems.add("id", "is required and must be a non-empty string");
  } else if (!isValidCapabilityId(idRaw.trim())) {
    problems.add("id", `must be a lowercase dotted capability id: ${JSON.stringify(idRaw)}`);
  } else {
    id = idRaw.trim();
  }

  const versionRaw = raw.version;
  if (typeof versionRaw !== "string") {
    problems.add("version", "is required and must be a string");
  } else if (!isValidSemver(versionRaw.trim())) {
    problems.add("version", `must be a semantic version (major.minor.patch): ${JSON.stringify(versionRaw)}`);
  }

  const kindRaw = raw.kind;
  if (kindRaw !== "kernel" && kindRaw !== "feature") {
    problems.add("kind", `must be "kernel" or "feature": ${JSON.stringify(kindRaw)}`);
  }

  const healthRaw = raw.health;
  let critical = false;
  if (healthRaw === undefined) {
    problems.add("health", "is required");
  } else if (!isRecord(healthRaw)) {
    problems.add("health", "must be a mapping with a boolean `critical`");
  } else if (typeof healthRaw.critical !== "boolean") {
    problems.add("health.critical", `must be a boolean: ${JSON.stringify(healthRaw.critical)}`);
  } else {
    critical = healthRaw.critical;
  }

  const provides = readProvides(problems, raw.provides);
  const requires = readRequirements(problems, raw.requires, "requires");
  const optional = readRequirements(problems, raw.optional, "optional");
  rejectContradictoryRequirements(problems, requires, optional);
  const state = readStateClaims(problems, raw.state, id);
  const modules = readPaths(problems, raw.modules, "modules");
  const bootModules = readPaths(problems, raw.bootModules, "bootModules");
  const surface = readPaths(problems, raw.surface, "surface");
  const permissions = readPermissions(problems, raw.permissions);

  // A `bootModules` path that is not part of the capability is a typo that would
  // otherwise silently claim nothing — or worse, double-claim a module owned by
  // another capability.
  for (const [index, entry] of bootModules.entries()) {
    if (!modules.includes(entry)) problems.add(`bootModules[${index}]`, `must also be listed in \`modules\`: ${entry}`);
  }

  // A `surface` path that is not part of the capability is a typo that would
  // otherwise silently publish nothing.
  for (const [index, entry] of surface.entries()) {
    if (!modules.includes(entry)) problems.add(`surface[${index}]`, `must also be listed in \`modules\`: ${entry}`);
  }

  // A feature may be critical, but the reverse mismatch is the dangerous one: a
  // non-critical capability that the platform cannot boot without would contradict
  // its own health declaration, so the two are cross-checked here.
  if (kindRaw === "kernel" && healthRaw !== undefined && isRecord(healthRaw) && healthRaw.critical === false) {
    problems.add("health.critical", "a kernel capability is composition the platform is made of; it cannot declare itself non-critical");
  }

  if (problems.list.length > 0) return { problems: problems.list };

  return {
    manifest: {
      id,
      version: (versionRaw as string).trim(),
      kind: kindRaw as "kernel" | "feature",
      provides,
      requires,
      optional,
      state,
      health: { critical },
      modules,
      bootModules,
      surface,
      permissions,
      source
    },
    problems: []
  };
}

/** Parse manifest text (YAML or JSON — YAML is a superset of JSON) from a named source. */
export function parseCapabilityManifestText(text: string, source: string): { manifest?: CapabilityManifest; problems: ManifestProblem[] } {
  let decoded: unknown;
  try {
    decoded = parseYaml(text);
  } catch (error) {
    return { problems: [{ source, path: "", message: `not parseable as YAML or JSON: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  return validateCapabilityManifest(decoded, source);
}

/** Parse a manifest file. A missing or unreadable file is a problem, never a skip. */
export function parseCapabilityManifestFile(file: string, repoRoot: string): { manifest?: CapabilityManifest; problems: ManifestProblem[] } {
  const source = path.relative(repoRoot, file).split(path.sep).join("/");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    return { problems: [{ source, path: "", message: `cannot be read: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  return parseCapabilityManifestText(text, source);
}

/** The manifest file extensions the loader accepts, in the order it prefers them. */
export const MANIFEST_EXTENSIONS = [".yaml", ".yml", ".json"] as const;

/**
 * Every manifest under a capabilities root, in a deterministic order.
 *
 * Deterministic by construction — directory entries are sorted before recursing —
 * because the engineering book requires the graph to be independent of filesystem
 * traversal order, and the cheapest way to guarantee that is to never let the
 * order reach the graph in the first place.
 */
export function manifestFilesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if ((MANIFEST_EXTENSIONS as readonly string[]).includes(path.extname(entry.name).toLowerCase())) found.push(full);
    }
  };
  walk(root);
  return found;
}

/**
 * Load and validate every manifest under a capabilities root.
 *
 * Throws if any manifest is invalid. There is no "skip the broken one" mode: a
 * capability that cannot be described is a capability the ratchet cannot protect,
 * so silently dropping it would make the whole constraint layer a lie.
 */
export function loadCapabilityManifests(root: string, repoRoot: string): CapabilityManifest[] {
  const problems: ManifestProblem[] = [];
  const manifests: CapabilityManifest[] = [];
  const seen = new Map<string, string>();
  for (const file of manifestFilesUnder(root)) {
    const result = parseCapabilityManifestFile(file, repoRoot);
    problems.push(...result.problems);
    if (!result.manifest) continue;
    const previous = seen.get(result.manifest.id);
    if (previous) {
      problems.push({ source: result.manifest.source, path: "id", message: `duplicate capability id: ${result.manifest.id} is already declared by ${previous}` });
      continue;
    }
    seen.set(result.manifest.id, result.manifest.source);
    manifests.push(result.manifest);
  }
  if (problems.length > 0) {
    const bySource = new Map<string, ManifestProblem[]>();
    for (const problem of problems) {
      const list = bySource.get(problem.source) ?? [];
      list.push(problem);
      bySource.set(problem.source, list);
    }
    throw new ManifestValidationError([...bySource.keys()].join(", "), problems);
  }
  return manifests.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
