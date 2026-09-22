#!/usr/bin/env node
/**
 * Capability City Phase 1A — prospective architecture enforcement.
 *
 * Specification (normative): docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md, sections 7 and 8.
 *
 * ROLES STAY SEPARATE
 *   architecture:ratchet   legacy control sensor   (untouched, never replaced here)
 *   architecture:observe   truth sensor            (Phase 0, qualified by Q-01..Q-08)
 *   architecture:enforce   prospective policy      (this file)
 *
 * PROSPECTIVE, NOT RETROSPECTIVE
 *   Inherited relations are grandfathered by IDENTITY. New relations are judged by policy. Removing debt is
 *   allowed; adding undeclared debt is refused. A count-only comparison would let an attacker add debt while
 *   removing the same amount elsewhere, which is why ENF-17 exists and why the baseline stores identities.
 *
 * ONE EVALUATOR, TWO MODES
 *   shadow  -> policy violation reported, exit 0
 *   enforce -> policy violation reported, exit non-zero
 *   engine error -> non-zero in BOTH
 * The findings list is produced by the same function in both modes; only the exit code differs, which is what
 * makes ENF-12 ("shadow/enforce findings identical") a meaningful check rather than a coincidence.
 *
 * USAGE
 *   node scripts/architecture-enforcement.cjs --mode shadow
 *   node scripts/architecture-enforcement.cjs --mode enforce
 *   node scripts/architecture-enforcement.cjs --mode enforce --baseline <path> --measurement <path> --declarations <path>
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const observatory = require("./architecture-observatory.cjs");
const baselineModule = require("./architecture-enforcement-baseline.cjs");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join("artifacts", "city", "phase1");
const SCHEMA = "city-phase1a-architecture-enforcement/1";

const OWNER_UNDECLARED = observatory.OWNER_UNDECLARED; // UNDECLARED

// Machine codes. Policy codes are the mission's; the rest are engine-level.
const CODE = {
  PASS_AS_GRANDFATHERED: "PASS_AS_GRANDFATHERED",
  DEBT_REDUCED: "DEBT_REDUCED",
  NEW_DECLARED_SOURCE: "NEW_DECLARED_SOURCE",
  NEW_UNDECLARED_SOURCE: "NEW_UNDECLARED_SOURCE",
  NEW_EDGE_UNDECLARED_ENDPOINT: "NEW_EDGE_UNDECLARED_ENDPOINT",
  NEW_EDGE_DECLARED_ENDPOINT: "NEW_EDGE_DECLARED_ENDPOINT",
  NEW_UNDECLARED_CROSS_CAPABILITY_EDGE: "NEW_UNDECLARED_CROSS_CAPABILITY_EDGE",
  REINTRODUCED_DEBT: "REINTRODUCED_DEBT",
  OWNERSHIP_CONFLICT: "OWNERSHIP_CONFLICT",
  SENSOR_INCOMPLETE: "SENSOR_INCOMPLETE",
  UNRESOLVED_SOURCE_TARGET_MISSING: "UNRESOLVED_SOURCE_TARGET_MISSING",
  UNRESOLVED_UNSUPPORTED_SOURCE_RESOLUTION: "UNRESOLVED_UNSUPPORTED_SOURCE_RESOLUTION",
  UNRESOLVED_OTHER_UNKNOWN: "UNRESOLVED_OTHER_UNKNOWN",
  NON_SOURCE_ASSET: "NON_SOURCE_ASSET",
  NOT_YET_ENFORCED: "NOT_YET_ENFORCED",
  ENGINE_ERROR: "ENGINE_ERROR",
};

const SEVERITY = { VIOLATION: "VIOLATION", INFO: "INFO", ENGINE: "ENGINE_ERROR" };

// ---------------------------------------------------------------------------------------------
// declarations (what the repository's own manifests authorize)
// ---------------------------------------------------------------------------------------------

/**
 * Flatten capability manifests into the two maps the authorization rule needs.
 * `provides` maps a capability reference to the capability that provides it; `declares` maps a capability to
 * the references it declares as required or optional. E-07 then reduces to: A may import B iff A declares a
 * reference that B provides.
 */
function declarationsFromManifests(manifests) {
  const provides = {};
  const declares = {};
  for (const manifest of manifests) {
    for (const ref of manifest.provides ?? []) provides[ref] = manifest.id;
    const refs = new Set();
    for (const entry of manifest.requires ?? []) refs.add(typeof entry === "string" ? entry : entry.ref);
    for (const entry of manifest.optional ?? []) refs.add(typeof entry === "string" ? entry : entry.ref);
    declares[manifest.id] = [...refs].sort();
  }
  return { provides, declares };
}

function loadDeclarationsFromTree(root) {
  const dir = path.join(root, "config", "capabilities");
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(ya?ml|json)$/i.test(entry.name)) files.push(full);
    }
  };
  walk(dir);
  const { parse: parseYaml } = require("yaml");
  const manifests = files.map((file) => {
    const raw = parseYaml(fs.readFileSync(file, "utf8"));
    return {
      id: String(raw?.id ?? ""),
      provides: Array.isArray(raw?.provides) ? raw.provides.map(String) : [],
      requires: Array.isArray(raw?.requires) ? raw.requires.map((entry) => ({ ref: String(entry?.ref ?? entry) })) : [],
      optional: Array.isArray(raw?.optional) ? raw.optional.map((entry) => ({ ref: String(entry?.ref ?? entry) })) : [],
    };
  });
  return declarationsFromManifests(manifests);
}

function isAuthorized(fromCapability, toCapability, declarations) {
  const refs = declarations?.declares?.[fromCapability] ?? [];
  const provides = declarations?.provides ?? {};
  return refs.some((ref) => provides[ref] === toCapability);
}

// ---------------------------------------------------------------------------------------------
// measurement
// ---------------------------------------------------------------------------------------------

/** Measure the real tree into the shape the evaluator consumes (also the shape fixtures inject). */
function measureTree(root) {
  const tracked = baselineModule.listTracked(root);
  const scanSet = observatory.selectScanSet(tracked);
  const trackedSet = new Set(scanSet);
  const { ownership } = baselineModule.loadOwnership(root);

  let readCalls = 0;
  const graph = observatory.buildObserverGraph({
    root,
    files: scanSet,
    trackedSet,
    ownership,
    readFile: (rel) => {
      readCalls += 1;
      return fs.readFileSync(path.join(root, rel), "utf8");
    },
  });

  const files = {};
  for (const file of scanSet) files[file] = ownership.moduleOwner.get(file) ?? OWNER_UNDECLARED;

  const unreadable = graph.parseIssues.filter((issue) => issue.kind === "unreadable");
  return {
    source_commit: null,
    files,
    edges: graph.edges.map((edge) => [edge.from, edge.to]),
    unresolved: graph.unresolved.map((item) => ({
      from: item.from,
      specifier: item.specifier,
      phase0_reason: item.reason,
      classification: baselineModule.classifyUnresolved(item),
    })),
    parse_issues: graph.parseIssues.filter((issue) => issue.kind !== "unreadable"),
    read_failures: unreadable,
    silent_skips: scanSet.length - readCalls,
    ownership_conflicts: ownership.conflicts,
    semantic: { tracked_source_files: scanSet.length, internal_edges: graph.edges.length },
  };
}

// ---------------------------------------------------------------------------------------------
// the evaluator — one function, both modes
// ---------------------------------------------------------------------------------------------

function pairKey(edge) {
  return `${edge[0]}\u0000${edge[1]}`;
}

/**
 * Evaluate prospective policy. Pure: it reads only its arguments, so shadow and enforce provably share it and a
 * fixture can drive every rule without touching the repository.
 */
function evaluatePolicy({ baseline, measurement, declarations }) {
  const findings = [];
  const add = (code, severity, subject, detail) => findings.push({ code, severity, subject, detail });

  if (!baseline || !Array.isArray(baseline.edges) || typeof baseline.files !== "object" || baseline.files === null) {
    add(CODE.ENGINE_ERROR, SEVERITY.ENGINE, "baseline", "the baseline is missing or malformed");
    return { findings, verdict: "ENGINE_ERROR" };
  }
  if (!measurement || !Array.isArray(measurement.edges) || typeof measurement.files !== "object" || measurement.files === null) {
    add(CODE.ENGINE_ERROR, SEVERITY.ENGINE, "measurement", "the measurement is missing or malformed");
    return { findings, verdict: "ENGINE_ERROR" };
  }

  // ---- E-09: the sensor must be complete, or nothing may pass -------------------------------
  const readFailures = measurement.read_failures ?? [];
  const parseIssues = measurement.parse_issues ?? [];
  const silentSkips = measurement.silent_skips ?? 0;
  if (readFailures.length > 0) add(CODE.SENSOR_INCOMPLETE, SEVERITY.VIOLATION, "sensor", `${readFailures.length} read failure(s): ${readFailures.slice(0, 5).map((i) => i.file ?? i).join(", ")}`);
  if (parseIssues.length > 0) add(CODE.SENSOR_INCOMPLETE, SEVERITY.VIOLATION, "sensor", `${parseIssues.length} parse issue(s)`);
  if (silentSkips > 0) add(CODE.SENSOR_INCOMPLETE, SEVERITY.VIOLATION, "sensor", `${silentSkips} silently skipped file(s)`);

  // ---- unresolved references, classified (section 6) ----------------------------------------
  for (const item of measurement.unresolved ?? []) {
    const classification = item.classification ?? baselineModule.classifyUnresolved(item);
    switch (classification) {
      case baselineModule.NON_SOURCE_ASSET:
        add(CODE.NON_SOURCE_ASSET, SEVERITY.INFO, `${item.from} -> ${item.specifier}`, "non-source asset; reported, not an architecture failure");
        break;
      case baselineModule.SOURCE_TARGET_MISSING:
        add(CODE.UNRESOLVED_SOURCE_TARGET_MISSING, SEVERITY.VIOLATION, `${item.from} -> ${item.specifier}`, "a source target is named but absent");
        break;
      case baselineModule.UNSUPPORTED_SOURCE_RESOLUTION:
        add(CODE.UNRESOLVED_UNSUPPORTED_SOURCE_RESOLUTION, SEVERITY.VIOLATION, `${item.from} -> ${item.specifier}`, "the resolution form is unsupported; fail closed");
        break;
      default:
        add(CODE.UNRESOLVED_OTHER_UNKNOWN, SEVERITY.VIOLATION, `${item.from} -> ${item.specifier}`, "unknown classification; fail closed");
        break;
    }
  }

  // ---- E-08 ownership conflicts -------------------------------------------------------------
  for (const conflict of measurement.ownership_conflicts ?? []) {
    add(CODE.OWNERSHIP_CONFLICT, SEVERITY.VIOLATION, conflict.module ?? String(conflict), `multiple authoritative owners: ${(conflict.capabilities ?? []).join(", ")}`);
  }

  // ---- E-04 new source ownership ------------------------------------------------------------
  const baselineFiles = baseline.files ?? {};
  for (const [file, owner] of Object.entries(measurement.files ?? {})) {
    if (Object.prototype.hasOwnProperty.call(baselineFiles, file)) continue;
    if (owner === OWNER_UNDECLARED) add(CODE.NEW_UNDECLARED_SOURCE, SEVERITY.VIOLATION, file, "new tracked production source with owner UNDECLARED");
    else add(CODE.NEW_DECLARED_SOURCE, SEVERITY.INFO, file, `new tracked production source declared by ${owner}`);
  }

  // ---- edges: E-01, E-02, E-03, E-05, E-06, E-07 --------------------------------------------
  const baselineEdgeSet = new Set((baseline.edges ?? []).map(pairKey));
  const retiredEdgeSet = new Set((baseline.retired_edges ?? []).map(pairKey));
  const currentEdgeSet = new Set((measurement.edges ?? []).map(pairKey));

  for (const edge of measurement.edges ?? []) {
    const key = pairKey(edge);
    const [from, to] = edge;
    const fromOwner = measurement.files?.[from] ?? OWNER_UNDECLARED;
    const toOwner = measurement.files?.[to] ?? OWNER_UNDECLARED;

    if (baselineEdgeSet.has(key)) {
      add(CODE.PASS_AS_GRANDFATHERED, SEVERITY.INFO, key.split("\u0000").join(" -> "), "existed before enforcement; grandfathered, still labelled as debt");
      continue;
    }

    // E-03: an edge that an accepted later baseline retired and that has come back is NEW, never eternally
    // grandfathered. It is labelled distinctly so the reintroduction is visible, but the decision is the
    // new-edge decision.
    const reintroduced = retiredEdgeSet.has(key);

    if (fromOwner === OWNER_UNDECLARED || toOwner === OWNER_UNDECLARED) {
      add(reintroduced ? CODE.REINTRODUCED_DEBT : CODE.NEW_EDGE_UNDECLARED_ENDPOINT, SEVERITY.VIOLATION,
        `${from} -> ${to}`,
        `${reintroduced ? "retired earlier and reintroduced" : "new edge"} with an undeclared endpoint (from ${fromOwner}, to ${toOwner})`);
      continue;
    }
    if (fromOwner === toOwner) {
      add(CODE.NEW_EDGE_DECLARED_ENDPOINT, SEVERITY.INFO, `${from} -> ${to}`, `new within-capability edge for ${fromOwner}`);
      continue;
    }
    if (isAuthorized(fromOwner, toOwner, declarations)) {
      add(CODE.NEW_EDGE_DECLARED_ENDPOINT, SEVERITY.INFO, `${from} -> ${to}`, `new cross-capability edge authorized by declaration: ${fromOwner} -> ${toOwner}`);
      continue;
    }
    add(reintroduced ? CODE.REINTRODUCED_DEBT : CODE.NEW_UNDECLARED_CROSS_CAPABILITY_EDGE, SEVERITY.VIOLATION,
      `${from} -> ${to}`,
      `${reintroduced ? "retired earlier and reintroduced" : "new cross-capability edge"} not authorized by any declaration: ${fromOwner} -> ${toOwner}`);
  }

  // E-02: debt removal is a pass, and is reported so a reduction is visible rather than merely absent.
  for (const key of baselineEdgeSet) {
    if (currentEdgeSet.has(key)) continue;
    add(CODE.DEBT_REDUCED, SEVERITY.INFO, key.split("\u0000").join(" -> "), "this relation existed before enforcement and no longer does");
  }

  // ---- E-10 unmodeled debt is labelled, never called clean ----------------------------------
  for (const klass of baseline.not_yet_enforced ?? baselineModule.NOT_YET_ENFORCED) {
    add(CODE.NOT_YET_ENFORCED, SEVERITY.INFO, klass, "this defect class is not modelled by Phase 1A and is therefore NOT claimed to be clean");
  }

  const violations = findings.filter((finding) => finding.severity === SEVERITY.VIOLATION);
  const engineErrors = findings.filter((finding) => finding.severity === SEVERITY.ENGINE);
  const verdict = engineErrors.length > 0 ? "ENGINE_ERROR" : violations.length > 0 ? "POLICY_VIOLATION" : "PASS";
  return { findings, verdict };
}

function summarize(findings) {
  const byCode = {};
  for (const finding of findings) byCode[finding.code] = (byCode[finding.code] ?? 0) + 1;
  return {
    findings_total: findings.length,
    by_code: Object.fromEntries(Object.entries(byCode).sort()),
    grandfathered_edges: byCode[CODE.PASS_AS_GRANDFATHERED] ?? 0,
    debt_reduced: byCode[CODE.DEBT_REDUCED] ?? 0,
    new_declared_source: byCode[CODE.NEW_DECLARED_SOURCE] ?? 0,
    new_undeclared_source: byCode[CODE.NEW_UNDECLARED_SOURCE] ?? 0,
    new_edge_undeclared_endpoint: byCode[CODE.NEW_EDGE_UNDECLARED_ENDPOINT] ?? 0,
    new_undeclared_cross_capability_edge: byCode[CODE.NEW_UNDECLARED_CROSS_CAPABILITY_EDGE] ?? 0,
    reintroduced_debt: byCode[CODE.REINTRODUCED_DEBT] ?? 0,
    new_declared_edges: byCode[CODE.NEW_EDGE_DECLARED_ENDPOINT] ?? 0,
    ownership_conflict: byCode[CODE.OWNERSHIP_CONFLICT] ?? 0,
    sensor_incomplete: byCode[CODE.SENSOR_INCOMPLETE] ?? 0,
    non_source_asset: byCode[CODE.NON_SOURCE_ASSET] ?? 0,
    not_yet_enforced_classes: byCode[CODE.NOT_YET_ENFORCED] ?? 0,
    violations: findings.filter((f) => f.severity === SEVERITY.VIOLATION).length,
    engine_errors: findings.filter((f) => f.severity === SEVERITY.ENGINE).length,
  };
}

/** Deterministic ordering: severity first, then code, then subject. */
function sortFindings(findings) {
  const rank = { ENGINE_ERROR: 0, VIOLATION: 1, INFO: 2 };
  return [...findings].sort((a, b) => {
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  const argv = process.argv.slice(2);
  const modeIndex = argv.indexOf("--mode");
  const mode = modeIndex >= 0 && argv[modeIndex + 1] ? argv[modeIndex + 1] : "shadow";
  if (mode !== "shadow" && mode !== "enforce") {
    process.stderr.write(`usage: architecture-enforcement.cjs --mode shadow|enforce\n`);
    return 2;
  }
  const noWrite = argv.includes("--no-write");
  const outIndex = argv.indexOf("--out");
  const outDir = outIndex >= 0 && argv[outIndex + 1]
    ? (path.isAbsolute(argv[outIndex + 1]) ? argv[outIndex + 1] : path.join(ROOT, argv[outIndex + 1]))
    : path.join(ROOT, DEFAULT_OUT_DIR);
  const baselineIndex = argv.indexOf("--baseline");
  const measurementIndex = argv.indexOf("--measurement");
  const declarationsIndex = argv.indexOf("--declarations");

  const started = Date.now();
  let baseline;
  let measurement;
  let declarations;
  try {
    baseline = baselineIndex >= 0 && argv[baselineIndex + 1] ? readJson(argv[baselineIndex + 1]) : readJson(baselineModule.BASELINE_PATH);
  } catch (error) {
    const payload = {
      schema: SCHEMA, mode, verdict: "ENGINE_ERROR",
      findings: [{ code: CODE.ENGINE_ERROR, severity: SEVERITY.ENGINE, subject: "baseline", detail: `the baseline could not be read: ${error.message}` }],
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 1; // engine error: non-zero in both modes
  }
  try {
    measurement = measurementIndex >= 0 && argv[measurementIndex + 1] ? readJson(argv[measurementIndex + 1]) : measureTree(ROOT);
  } catch (error) {
    const payload = {
      schema: SCHEMA, mode, verdict: "ENGINE_ERROR",
      findings: [{ code: CODE.ENGINE_ERROR, severity: SEVERITY.ENGINE, subject: "measurement", detail: `the measurement could not be produced: ${error.message}` }],
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 1;
  }
  try {
    declarations = declarationsIndex >= 0 && argv[declarationsIndex + 1] ? readJson(argv[declarationsIndex + 1]) : loadDeclarationsFromTree(ROOT);
  } catch (error) {
    const payload = {
      schema: SCHEMA, mode, verdict: "ENGINE_ERROR",
      findings: [{ code: CODE.ENGINE_ERROR, severity: SEVERITY.ENGINE, subject: "declarations", detail: `the declarations could not be read: ${error.message}` }],
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 1;
  }

  const { findings, verdict } = evaluatePolicy({ baseline, measurement, declarations });
  const ordered = sortFindings(findings);
  const summary = summarize(ordered);

  const payload = {
    schema: SCHEMA,
    mode,
    policy: {
      roles: { ratchet: "legacy control", observe: "truth sensor", enforce: "prospective policy" },
      means: "inherited relations are grandfathered by identity; new undeclared debt is refused",
      not_yet_enforced: baseline.not_yet_enforced ?? baselineModule.NOT_YET_ENFORCED,
    },
    baseline: {
      path: path.relative(ROOT, baselineIndex >= 0 && argv[baselineIndex + 1] ? path.resolve(argv[baselineIndex + 1]) : baselineModule.BASELINE_PATH).split(path.sep).join("/"),
      baseline_version: baseline.baseline_version ?? null,
      baseline_hash: baseline.baseline_hash ?? null,
      parent_baseline_hash: baseline.parent_baseline_hash ?? null,
      source_commit: baseline.source_commit ?? null,
      edges: Array.isArray(baseline.edges) ? baseline.edges.length : null,
      files: baseline.files ? Object.keys(baseline.files).length : null,
    },
    measurement: {
      files: Object.keys(measurement.files ?? {}).length,
      edges: (measurement.edges ?? []).length,
      unresolved: (measurement.unresolved ?? []).length,
      silent_skips: measurement.silent_skips ?? null,
    },
    summary,
    verdict,
    findings: ordered,
    volatile: { generatedAt: new Date().toISOString(), wall_time_ms: Date.now() - started },
  };

  if (!noWrite) {
    fs.mkdirSync(outDir, { recursive: true });
    const name = mode === "shadow" ? "architecture-enforcement-shadow.json" : "architecture-enforcement-live.json";
    fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify({ mode, verdict, summary, shadow_enforce_same_evaluator: true }, null, 2)}\n`);

  if (verdict === "ENGINE_ERROR") return 1;
  if (mode === "enforce" && verdict === "POLICY_VIOLATION") return 1;
  return 0;
}

module.exports = {
  SCHEMA,
  CODE,
  SEVERITY,
  declarationsFromManifests,
  loadDeclarationsFromTree,
  isAuthorized,
  measureTree,
  evaluatePolicy,
  summarize,
  sortFindings,
  pairKey,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`architecture enforcement failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
