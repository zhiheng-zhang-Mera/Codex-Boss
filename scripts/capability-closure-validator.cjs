#!/usr/bin/env node
/**
 * THE CAPABILITY CLOSURE VALIDATOR (workbook section 15, P2-A).
 *
 * WHAT IT ANSWERS THAT NOTHING ELSE DOES
 *
 *   `scripts/architecture.cjs` already validates each manifest's SHAPE: id, version, kind, health, the
 *   `id@major` form of every `provides`/`requires`, `surface` and `bootModules` being subsets of `modules`, and
 *   state ownership matching the declaring capability (its loader, lines 35-118). What it does NOT answer is
 *   whether the declarations are TRUE of the real tree, and whether the ownership a reader finds is the only
 *   ownership there is. This program answers exactly that, and only that, so the two do not drift into two
 *   overlapping judges:
 *
 *     1  stale path            every declared `modules`/`surface`/`bootModules` entry exists ON DISK and is a FILE
 *     2  boot subset           `bootModules` is a subset of `modules` (architecture.cjs checks the same thing;
 *                              repeated here because this program's verdict must be self-contained for CI)
 *     3  ownership coverage    every tracked source file under the scan roots is owned by exactly one capability,
 *                              or named in the composition-root table, or exempted WITH A REASON
 *     4  no double claim       no file is owned by two capabilities
 *     5  no contradictory      the three owner tables are pairwise disjoint: capability, composition root and
 *         ownership            exemption are three different answers to "whose change is this?", so a file in
 *                              two of them is a contradiction rather than a precedence rule
 *     6  one purpose           every capability declares at least one `provides` id -- a capability with no
 *                              declared external purpose is a directory, not a building
 *     7  model agreement       the ownership map and the manifests must agree: each manifest's declared modules
 *                              are owned by that capability, and the map names no capability the manifests do not
 *
 * WHY CHECK 7 IS THE ONE THAT MATTERS TODAY
 *
 *   Measured at this commit: the 27 manifests declare 25 module paths, while `config/capability-modules.json`
 *   owns 597 of the 613 scanned files. So the repository has TWO ownership models that disagree about 572 files,
 *   and every number downstream -- the test-impact selector's blast radius, the catalogue's `covers`, the
 *   enforcement baseline's `declared_owned_files` -- depends on which one a reader picked. This program exists so
 *   that disagreement is a FAILING CHECK rather than a footnote in a report, and so that adopting one model (P2-A's
 *   first deliverable) has a machine that can tell when it has actually happened.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   It does not measure dependency edges, cycles, private-state access or Core size -- those belong to P2-B/C/D/H
 *   and have their own validators. It does not attempt to decide whether 597 is the RIGHT ownership; it decides
 *   whether the two declarations agree, and whether the one they agree on covers the tree. Deciding which model is
 *   right is a design act recorded in `docs/city/PHASE2_ARCHITECTURE_MIGRATION_SPEC.md`, not a check.
 *
 * USAGE
 *
 *   node scripts/capability-closure-validator.cjs            human report, exit 1 on any problem
 *   node scripts/capability-closure-validator.cjs --json     the same report as JSON
 *
 * Exit codes: 0 = every check passed, 1 = at least one problem (all problems are reported, never just the first).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("yaml");

const ROOT = path.resolve(__dirname, "..");
const CAPABILITIES_ROOT = "config/capabilities";
const OWNERSHIP_MAP = "config/capability-modules.json";

/** The scan roots. Deliberately the OBSERVATORY's set (`electron`, `src`), not the selector's (`electron`, `src/shared`). */
const SCAN_ROOTS = ["electron", "src"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

/* -------------------------------------------------------------------------- */
/* Reading the tree                                                            */
/* -------------------------------------------------------------------------- */

function walkSourceFiles(root, relativeDir, out = []) {
  const absolute = path.join(root, relativeDir);
  if (!fs.existsSync(absolute)) return out;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const child = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) { walkSourceFiles(root, child, out); continue; }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(child);
  }
  return out;
}

function scanSet(root = ROOT) {
  const files = [];
  for (const scanRoot of SCAN_ROOTS) walkSourceFiles(root, scanRoot, files);
  return [...new Set(files)].sort();
}

/* -------------------------------------------------------------------------- */
/* Reading the declarations                                                    */
/* -------------------------------------------------------------------------- */

function readManifests(root = ROOT) {
  const manifests = [];
  const capabilitiesRoot = path.join(root, CAPABILITIES_ROOT);
  if (!fs.existsSync(capabilitiesRoot)) return manifests;
  for (const name of fs.readdirSync(capabilitiesRoot).sort()) {
    if (!/\.(ya?ml|json)$/i.test(name)) continue;
    const file = path.join(capabilitiesRoot, name);
    const source = `${CAPABILITIES_ROOT}/${name}`;
    let raw;
    try {
      raw = parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      manifests.push({ source, unreadable: true, error: String(error && error.message ? error.message : error) });
      continue;
    }
    const list = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : []);
    manifests.push({
      source,
      id: typeof raw?.id === "string" ? raw.id : null,
      kind: typeof raw?.kind === "string" ? raw.kind : null,
      provides: list(raw?.provides),
      requires: Array.isArray(raw?.requires) ? raw.requires : [],
      modules: list(raw?.modules),
      bootModules: list(raw?.bootModules),
      surface: list(raw?.surface),
      state: Array.isArray(raw?.state) ? raw.state : [],
    });
  }
  return manifests;
}

function readOwnershipMap(root = ROOT) {
  const absolute = path.join(root, OWNERSHIP_MAP);
  if (!fs.existsSync(absolute)) return { capabilities: {}, compositionRoot: {}, exempt: {} };
  const raw = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return {
    capabilities: raw.capabilities && typeof raw.capabilities === "object" ? raw.capabilities : {},
    compositionRoot: raw.composition_root && typeof raw.composition_root === "object" ? raw.composition_root : {},
    exempt: raw.exempt && typeof raw.exempt === "object" ? raw.exempt : {},
  };
}

/** The map's own matching rule, mirrored deliberately: `test-impact.ts:217-222`. */
function ownsPath(entries, file) {
  for (const entry of entries) {
    const normalized = String(entry).replace(/\\/g, "/").replace(/\/+$/, "");
    if (file === normalized || file.startsWith(`${normalized}/`)) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                  */
/* -------------------------------------------------------------------------- */

function validate(root = ROOT) {
  const files = scanSet(root);
  const manifests = readManifests(root);
  const map = readOwnershipMap(root);
  const problems = [];
  const findings = {};

  const capabilityIds = manifests.filter((manifest) => !manifest.unreadable && manifest.id).map((manifest) => manifest.id);
  const duplicateIds = capabilityIds.filter((id, index) => capabilityIds.indexOf(id) !== index);

  // --- 1. stale path: every declared entry exists and is a FILE -------------------------------------
  const declaredModules = new Map();
  const stalePaths = [];
  const directoryEntries = [];
  for (const manifest of manifests) {
    if (manifest.unreadable) { problems.push(`${manifest.source}: not parseable: ${manifest.error}`); continue; }
    for (const module of manifest.modules) {
      const normalized = module.split(path.sep).join("/");
      declaredModules.set(normalized, [...(declaredModules.get(normalized) ?? []), manifest.id]);
      const absolute = path.join(root, normalized);
      if (!fs.existsSync(absolute)) { stalePaths.push({ manifest: manifest.source, path: normalized }); continue; }
      if (fs.statSync(absolute).isDirectory()) directoryEntries.push({ manifest: manifest.source, path: normalized });
    }
  }
  findings.declaredModulePaths = declaredModules.size;
  findings.stalePaths = stalePaths;
  findings.directoryDeclaredAsModule = directoryEntries;
  if (stalePaths.length > 0) problems.push(`${stalePaths.length} declared module path(s) do not exist`);
  if (directoryEntries.length > 0) problems.push(`${directoryEntries.length} declared module path(s) are directories, not files`);

  // --- 2. bootModules is a subset of modules ---------------------------------------------------------
  const bootNotInModules = [];
  for (const manifest of manifests) {
    if (manifest.unreadable) continue;
    for (const entry of [...manifest.bootModules, ...manifest.surface]) {
      if (!manifest.modules.includes(entry)) bootNotInModules.push({ manifest: manifest.source, path: entry });
    }
  }
  findings.bootOrSurfaceNotDeclaredInModules = bootNotInModules;
  if (bootNotInModules.length > 0) problems.push(`${bootNotInModules.length} bootModules/surface entr(ies) are not in modules`);

  // --- 3/4/5. coverage, double claims, owned-and-exempt ----------------------------------------------
  const ownedBy = new Map();
  const doubleClaims = [];
  for (const [capability, patterns] of Object.entries(map.capabilities)) {
    for (const file of files) {
      if (!ownsPath(patterns, file)) continue;
      const existing = ownedBy.get(file);
      if (existing && existing !== capability) doubleClaims.push({ file, owners: [existing, capability] });
      ownedBy.set(file, existing ?? capability);
    }
  }
  const exemptEntries = Object.entries(map.exempt);
  const compositionRootEntries = Object.entries(map.compositionRoot);
  const isExempt = (file) => exemptEntries.some(([entry]) => ownsPath([entry], file));
  const isCompositionRoot = (file) => compositionRootEntries.some(([entry]) => ownsPath([entry], file));
  const missingExemptionReasons = exemptEntries.filter(([, reason]) => typeof reason !== "string" || reason.trim().length < 20).map(([entry]) => entry);
  const missingCompositionRootReasons = compositionRootEntries.filter(([, reason]) => typeof reason !== "string" || reason.trim().length < 20).map(([entry]) => entry);
  const ownedAndExempt = files.filter((file) => ownedBy.has(file) && isExempt(file));
  // A third class means three more ways to contradict, and each pair is two different answers to the
  // same question -- "whose change is this?" -- so all three are failures rather than precedence rules:
  //   capability + composition root   two owners, one of which claims to be wiring rather than a building
  //   composition root + exempt       "the platform owns this" alongside "nobody owns this"
  const ownedAndCompositionRoot = files.filter((file) => ownedBy.has(file) && isCompositionRoot(file));
  const compositionRootAndExempt = files.filter((file) => isCompositionRoot(file) && isExempt(file));
  const compositionRootFiles = files.filter((file) => isCompositionRoot(file));
  const unowned = files.filter((file) => !ownedBy.has(file) && !isExempt(file) && !isCompositionRoot(file));

  findings.scannedSourceFiles = files.length;
  findings.ownedFiles = ownedBy.size;
  findings.exemptEntries = exemptEntries.length;
  findings.compositionRootEntries = compositionRootEntries.length;
  findings.compositionRootFiles = compositionRootFiles.length;
  findings.doubleClaims = doubleClaims;
  findings.missingExemptionReasons = missingExemptionReasons;
  findings.missingCompositionRootReasons = missingCompositionRootReasons;
  findings.ownedAndExempt = ownedAndExempt;
  findings.ownedAndCompositionRoot = ownedAndCompositionRoot;
  findings.compositionRootAndExempt = compositionRootAndExempt;
  findings.unowned = unowned;
  findings.unownedCount = unowned.length;
  if (doubleClaims.length > 0) problems.push(`${doubleClaims.length} file(s) are claimed by two capabilities`);
  if (missingExemptionReasons.length > 0) problems.push(`${missingExemptionReasons.length} exemption(s) carry no substantive reason`);
  if (missingCompositionRootReasons.length > 0) problems.push(`${missingCompositionRootReasons.length} composition-root entr(ies) carry no substantive reason`);
  if (ownedAndExempt.length > 0) problems.push(`${ownedAndExempt.length} file(s) are owned by a capability AND exempt: ${ownedAndExempt.join(", ")}`);
  if (ownedAndCompositionRoot.length > 0) problems.push(`${ownedAndCompositionRoot.length} file(s) are owned by a capability AND by the composition root: ${ownedAndCompositionRoot.join(", ")}`);
  if (compositionRootAndExempt.length > 0) problems.push(`${compositionRootAndExempt.length} file(s) are owned by the composition root AND exempt: ${compositionRootAndExempt.join(", ")}`);
  if (unowned.length > 0) problems.push(`${unowned.length} scanned source file(s) are owned by no capability, by no composition-root entry and exempt from none`);

  // --- 6. one declared external purpose ---------------------------------------------------------------
  const withoutPurpose = manifests.filter((manifest) => !manifest.unreadable && manifest.provides.length === 0).map((manifest) => manifest.source);
  findings.withoutDeclaredPurpose = withoutPurpose;
  if (withoutPurpose.length > 0) problems.push(`${withoutPurpose.length} manifest(s) declare no provided id, so the capability has no declared external purpose`);

  // --- 7. the two models must agree -------------------------------------------------------------------
  const mapCapabilities = Object.keys(map.capabilities);
  const mapWithoutManifest = mapCapabilities.filter((id) => !capabilityIds.includes(id));
  const manifestWithoutMap = capabilityIds.filter((id) => !mapCapabilities.includes(id));
  const declaredButUnowned = [];
  for (const [module, owners] of declaredModules) {
    // A declared module is "true" when the map (or, for a capability the map does not list at all, the manifest
    // itself) holds it. The check is about DISAGREEMENT, not about which model wins.
    const mapped = owners.some((owner) => map.capabilities[owner] && ownsPath(map.capabilities[owner], module));
    if (!mapped) declaredButUnowned.push({ path: module, declaredBy: owners });
  }
  findings.mapWithoutManifest = mapWithoutManifest;
  findings.manifestWithoutMap = manifestWithoutMap;
  findings.declaredButUnowned = declaredButUnowned;
  findings.modelsAgree = mapWithoutManifest.length === 0 && manifestWithoutMap.length === 0 && declaredButUnowned.length === 0;
  if (mapWithoutManifest.length > 0) problems.push(`the ownership map names ${mapWithoutManifest.length} capability id(s) no manifest declares: ${mapWithoutManifest.join(", ")}`);
  if (manifestWithoutMap.length > 0) problems.push(`${manifestWithoutMap.length} manifest(s) are absent from the ownership map: ${manifestWithoutMap.join(", ")}`);
  if (declaredButUnowned.length > 0) problems.push(`${declaredButUnowned.length} declared module path(s) are not owned by the capability that declares them`);

  if (duplicateIds.length > 0) problems.push(`duplicate capability id(s): ${[...new Set(duplicateIds)].join(", ")}`);

  // --- the measurement the programme is actually trying to move ----------------------------------------
  // Reported rather than judged: P2-A's deliverable is to make this number small, and the number cannot be
  // interpreted until the two models agree (check 7).
  const declaredOwnedFiles = [...ownedBy.keys()].filter((file) => [...declaredModules.keys()].includes(file)).length;
  findings.declaredOwnedOverlap = declaredOwnedFiles;

  return {
    schema: "city-capability-closure-validation/1",
    scannedSourceFiles: files.length,
    manifests: manifests.length,
    problems,
    findings,
  };
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                                */
/* -------------------------------------------------------------------------- */

function render(report) {
  const lines = [];
  const { findings } = report;
  lines.push(`[closure] scanned ${report.scannedSourceFiles} source files under ${SCAN_ROOTS.join(", ")}`);
  lines.push(`[closure] ${report.manifests} manifests declare ${findings.declaredModulePaths} module path(s)`);
  lines.push(`[closure] the ownership map (${OWNERSHIP_MAP}) owns ${findings.ownedFiles} file(s), exempts ${findings.exemptEntries}`);
  lines.push(`[closure] the composition root owns ${findings.compositionRootFiles} file(s) over ${findings.compositionRootEntries} entr(ies): not a capability, not an exemption`);
  lines.push(`[closure] two-model agreement: ${findings.modelsAgree ? "AGREE" : "DISAGREE"}`
    + ` (map-without-manifest ${findings.mapWithoutManifest.length}, manifest-without-map ${findings.manifestWithoutMap.length},`
    + ` declared-but-unowned ${findings.declaredButUnowned.length})`);
  lines.push(`[closure] unowned scanned files: ${findings.unownedCount}`);
  if (findings.unownedCount > 0 && findings.unownedCount <= 20) lines.push(`[closure]   ${findings.unowned.join(", ")}`);
  if (report.problems.length === 0) {
    lines.push("[closure] VERDICT=PASS");
    return lines.join("\n");
  }
  lines.push(`[closure] VERDICT=FAIL (${report.problems.length} problem class(es))`);
  for (const problem of report.problems) lines.push(`[closure]   - ${problem}`);
  return lines.join("\n");
}

function main(argv) {
  const report = validate();
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${render(report)}\n`);
  return report.problems.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`capability-closure-validator failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, validate, ownsPath, scanSet, readManifests, readOwnershipMap };
