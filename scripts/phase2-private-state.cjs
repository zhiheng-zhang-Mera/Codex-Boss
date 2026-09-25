#!/usr/bin/env node
/**
 * PHASE 2 — the cross-domain PRIVATE-STATE access validator (P2-D; see
 * docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md, section 18).
 *
 * WHAT IT ANSWERS
 *
 *   Section 18: "Freshly measure all cross-domain private-state reads/writes" and "Machine-enforce both:
 *   cross-domain private-state accesses = 0; uncontrolled multi-writer durable stores = 0." This is the
 *   "private-state-access validator" the final acceptance suite names.
 *
 * THE DEFINITION, AND WHY IT IS A PATH RULE RATHER THAN A NAME RULE
 *
 *   The first measurement tried matching a declared namespace as a quoted string and reported 12 cross-domain
 *   "accesses". Reading them showed the rule was wrong: `"history"` inside a SKIP set, `FleetAggregate["tasks"]`
 *   and `"tasks"` as a component id are not state access at all. What section 18 forbids is reaching another
 *   capability's DURABLE STATE without going through its contract, and in this repository that is a PATH: the
 *   durable root plus a namespace directory. So an access is a `path.join(...)` whose last segment is a declared
 *   namespace, optionally through ONE level of indirection (this repository writes
 *   `export const HISTORY_DIRECTORY = "history"` and joins with the constant).
 *
 * TWO TIERS, BECAUSE A PATH JOIN IS STILL NOT ALWAYS AN ACCESS
 *
 *   `path.join(artifacts, "history")` is a session's own subdirectory that happens to share a namespace's name,
 *   and `path.join(context.dir, "tasks")` is a fault lab's sandbox. Both were in the first candidate list and
 *   neither touches durable state. So an access is CONFIRMED only when the join also carries a durable-root
 *   marker (`dataRoot`, `userData`, or the `.boss` segment); a namespace join without one is reported as a
 *   CANDIDATE for a reader to classify, and only the CONFIRMED tier is ratcheted. Reporting the two together
 *   would make the number depend on how many directories happen to be named after a namespace.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM
 *
 *   It does NOT distinguish a READ from a WRITE. The stores here are classes constructed with a path and the
 *   open mode is not in the source, so read-versus-write is not statically decidable from this analysis, and a
 *   validator that guessed it would be inventing the number section 18 asks for. What it reports instead is
 *   which namespaces are touched by more than one NON-OWNER capability, as a candidate list, and the property it
 *   does machine-enforce for multiple writers is the DECLARED one: every namespace has exactly one declared
 *   owner, and no code path resolves into a namespace owned by someone else.
 *
 * READ-ONLY. It writes nothing and exits non-zero when a recorded ceiling is exceeded.
 *
 * USAGE
 *
 *   node scripts/phase2-private-state.cjs            human report, exit 1 on a regression
 *   node scripts/phase2-private-state.cjs --json     the same report as JSON
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("yaml");

const ROOT = path.resolve(__dirname, "..");
const RATCHET_PATH = "config/p2d-private-state-ratchet.json";
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "dist-electron", ".git", "artifacts"]);
/** A join carrying one of these is resolving under the DURABLE root; without one it is some other directory. */
const DURABLE_ROOT_MARKERS = [/\bdataRoot\b/, /\buserData\b/, /["']\.boss["']/];

function walk(absolute, root, out = []) {
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name)) continue;
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) walk(child, root, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path.relative(root, child).split(path.sep).join("/"));
  }
  return out;
}

/** Module-level string constants whose value is a declared namespace: one level of indirection. */
function namespaceConstantsOf(text, namespaces) {
  const found = new Map();
  for (const match of text.matchAll(/(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*(?::\s*string\s*)?=\s*["']([^"']+)["']/g)) {
    if (namespaces.has(match[2])) found.set(match[1], match[2]);
  }
  return found;
}

/**
 * Local names bound to the durable root IN THE SAME FILE: `const boss = path.join(sources.dataRoot, ".boss")`.
 *
 * The second indirection, and it is the one the workbook's own historical example needs. `host-status` reaches
 * `persistence`'s task ledger through `path.join(boss, "tasks")`, and a marker list that only knew the spelling
 * `dataRoot` classified the defect as "unclassified" -- the defect named in
 * docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md (section 18). A name is a durable root when its own
 * initialiser carries a durable-root marker, so the rule is derived from the file rather than guessed at.
 * Symmetric with `namespaceConstantsOf`: one level for the ROOT, one for the NAMESPACE.
 */
function durableRootNamesOf(text) {
  const names = new Set();
  for (const match of text.matchAll(/(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*(?::\s*string\s*)?=\s*(path\.join\([^;]*\))/g)) {
    if (DURABLE_ROOT_MARKERS.some((marker) => marker.test(match[2]))) names.add(match[1]);
  }
  return names;
}

/**
 * The namespace a `path.join(...)` resolves into, or undefined.
 *
 * The LAST argument is the segment that names the directory; if it is a constant bound to a namespace, that is
 * the namespace. Anything else -- a field, a variable, another join -- is not a namespace access this can decide.
 */
function namespaceOfJoin(argumentsText, constants, namespaces, durableRootNames = new Set()) {
  const parts = argumentsText.split(",").map((part) => part.trim());
  const last = parts[parts.length - 1] ?? "";
  const literal = /^["']([^"']+)["']$/.exec(last);
  const namespace = literal ? literal[1] : constants.get(last);
  if (namespace === undefined || !namespaces.has(namespace)) return undefined;
  const durableRoot = DURABLE_ROOT_MARKERS.some((marker) => marker.test(argumentsText))
    || [...durableRootNames].some((name) => new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(argumentsText));
  return { namespace, argumentsText, confirmed: durableRoot };
}

/** Every namespace join in one file's text, classified. Pure, so a test can feed it synthetic source. */
function namespaceJoinsIn(text, constants, namespaces, durableRootNames = new Set()) {
  const joins = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/path\.join\(([^)]*)\)/g)) {
      const resolved = namespaceOfJoin(match[1], constants, namespaces, durableRootNames);
      if (resolved === undefined) continue;
      joins.push({ ...resolved, line: index + 1, text: line.trim().slice(0, 140) });
    }
  });
  return joins;
}

function declaredNamespaces(root) {
  const owner = new Map();
  const kinds = new Map();
  const directory = path.join(root, "config", "capabilities");
  for (const name of fs.readdirSync(directory).sort()) {
    if (!name.endsWith(".yaml")) continue;
    const doc = parse(fs.readFileSync(path.join(directory, name), "utf8"));
    if (typeof doc?.kind === "string") kinds[doc.id] = doc.kind;
    for (const entry of doc?.state ?? []) owner.set(String(entry.namespace), doc.id);
  }
  return { owner, kinds };
}

function measure(root = ROOT) {
  const map = JSON.parse(fs.readFileSync(path.join(root, "config", "capability-modules.json"), "utf8"));
  const ownsPath = (entries, file) => entries.some((entry) => {
    const normalized = String(entry).replace(/\\/g, "/").replace(/\/+$/, "");
    return file === normalized || file.startsWith(`${normalized}/`);
  });
  const ownerOf = (file) => {
    for (const [capability, patterns] of Object.entries(map.capabilities)) if (ownsPath(patterns, file)) return capability;
    if (Object.keys(map.composition_root ?? {}).some((entry) => ownsPath([entry], file))) return "<composition-root>";
    return null;
  };

  const { owner: stateOwner, kinds } = declaredNamespaces(root);
  const namespaces = new Set(stateOwner.keys());
  const files = [...walk(path.join(root, "electron"), root), ...walk(path.join(root, "src"), root)];

  const confirmed = [];
  const candidates = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const constants = namespaceConstantsOf(text, namespaces);
    const durableRoots = durableRootNamesOf(text);
    const owner = ownerOf(file) ?? "(unowned)";
    for (const join of namespaceJoinsIn(text, constants, namespaces, durableRoots)) {
      if (stateOwner.get(join.namespace) === owner) continue;
      const access = { namespace: join.namespace, declaredOwner: stateOwner.get(join.namespace), accessedBy: owner, accessedByKind: kinds[owner] ?? null, file, line: join.line, join: join.argumentsText, text: join.text };
      (join.confirmed ? confirmed : candidates).push(access);
    }
  }

  // A namespace touched by more than one NON-OWNER capability is a multi-writer CANDIDATE. Advisory only: the
  // open mode is not in the source, so this cannot decide read from write, and it says so.
  const touchedBy = new Map();
  for (const access of confirmed) {
    if (!touchedBy.has(access.namespace)) touchedBy.set(access.namespace, new Set());
    touchedBy.get(access.namespace).add(access.accessedBy);
  }
  const multiWriterCandidates = [...touchedBy.entries()]
    .filter(([, capabilities]) => capabilities.size > 1)
    .map(([namespace, capabilities]) => ({ namespace, declaredOwner: stateOwner.get(namespace), accessedBy: [...capabilities].sort() }));

  const pairs = [...new Set(confirmed.map((access) => `${access.namespace} <- ${access.accessedBy}`))].sort();
  return {
    schema: "city-phase2-private-state/1",
    ownershipModel: "config/capability-modules.json -- the OWNERSHIP MAP, not the manifests",
    definition: "a path.join whose last segment is a declared durable namespace and which carries a durable-root marker, reached from a file owned by a different capability",
    confirmedAccesses: confirmed.length,
    confirmedPairs: pairs.length,
    confirmed,
    pairs,
    candidates: candidates.length,
    candidateAccesses: candidates,
    multiWriterCandidates,
    multiWriterClaim: "NOT CLAIMED: the open mode is not in the source, so this lists namespaces touched by more than one non-owner capability and does not decide read from write",
    declaredNamespaces: namespaces.size,
    scannedSourceFiles: files.length,
    namespacesTouchedCrossDomain: [...touchedBy.keys()].sort(),
  };
}

function readRatchet(root = ROOT) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, RATCHET_PATH), "utf8"));
  return { ownershipModel: raw.ownership_model, measuredAt: raw.measured_at, recorded: raw.recorded ?? {}, target: raw.target ?? {} };
}

/** The judgement, pure. Ceilings for the accesses; floors so the count cannot fall by measuring less. */
function decide(report, ratchet) {
  const problems = [];
  const improvements = [];
  const recorded = ratchet.recorded ?? {};
  const model = ratchet.ownershipModel ?? "(ownership model not stated)";
  const risen = (name, actual, ceiling, consequence) => {
    if (typeof ceiling !== "number" || typeof actual !== "number") { problems.push(`${name}: not comparable (measured ${JSON.stringify(actual)}, recorded ${JSON.stringify(ceiling)})`); return; }
    if (actual > ceiling) problems.push(`${name} ROSE to ${actual}, above the recorded ${ceiling} (${consequence}); measured under ${model}`);
    else if (actual < ceiling) improvements.push(`${name} fell from ${ceiling} to ${actual} -- lower the recorded value in ${RATCHET_PATH} in this commit`);
  };
  const floor = (name, actual, minimum, consequence) => {
    if (typeof minimum !== "number" || typeof actual !== "number") { problems.push(`${name}: not comparable (measured ${JSON.stringify(actual)}, recorded ${JSON.stringify(minimum)})`); return; }
    if (actual < minimum) problems.push(`${name} FELL to ${actual}, below the recorded ${minimum} (${consequence}); measured under ${model}`);
  };

  risen("cross-domain private-state accesses", report.confirmedAccesses, recorded.cross_domain_state_accesses, "section 18's target is 0");
  risen("cross-domain private-state pairs", report.confirmedPairs, recorded.cross_domain_state_pairs, "a new (namespace, accessing capability) pair is a new consumer reaching past the owner");
  // The CANDIDATE tier is a ceiling too, but a looser one: it is the tier whose members a reader still has to
  // classify, so it must not grow either -- it is where an unclassified access would hide.
  risen("unclassified namespace joins", report.candidates, recorded.unclassified_namespace_joins, "a namespace join that is neither confirmed nor explained by a durable-root marker; each one needs a classification, not a count");
  // The SECOND HALF of docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 18, and the artifact section 30 names as the "durable-writer validator". This artifact's target block has declared
  // `uncontrolled_multi_writer_durable_stores: 0` since it was written, and NOTHING ASSERTED IT: the count was
  // printed in the report and carried in the decision's `measured` block, and no rule compared it with anything, so a
  // namespace acquiring a second non-owner writer would have been displayed and passed. A DECLARED TARGET THAT
  // NOTHING ASSERTS is a target in name only -- the same defect class as an artifact the workbook names and nobody
  // writes (ledger CC-041), which is why the rule is here rather than in a note. Recorded as a CEILING at its
  // currently accepted value, so a rise fails and a fall is reported as the improvement to record.
  risen("uncontrolled multi-writer durable stores", Array.isArray(report.multiWriterCandidates) ? report.multiWriterCandidates.length : undefined, recorded.uncontrolled_multi_writer_durable_stores, "section 18's target is 0: a namespace written by more than one non-owner capability has no single authoritative writer");
  floor("declared durable namespaces", report.declaredNamespaces, recorded.declared_namespaces, "a namespace removed from the manifests stops being declared, which turns every access to it into an access to state nobody owns -- the opposite of progress");
  floor("scanned source files", report.scannedSourceFiles, recorded.scanned_source_files, "fewer files scanned is not fewer accesses; a file removed from the scan set makes the count fall without anything being repaired");

  return {
    schema: "city-phase2-private-state-decision/1",
    ok: problems.length === 0,
    ownershipModel: model,
    recordedAt: ratchet.measuredAt ?? null,
    target: ratchet.target ?? {},
    problems,
    improvements,
    measured: {
      confirmedAccesses: report.confirmedAccesses ?? null,
      confirmedPairs: report.confirmedPairs ?? null,
      candidates: report.candidates ?? null,
      declaredNamespaces: report.declaredNamespaces ?? null,
      scannedSourceFiles: report.scannedSourceFiles ?? null,
      multiWriterCandidates: report.multiWriterCandidates?.length ?? null,
    },
  };
}

function render(report, decision) {
  const lines = [];
  lines.push(`[p2d] ownership model: ${report.ownershipModel}`);
  lines.push(`[p2d] definition: ${report.definition}`);
  lines.push(`[p2d] CONFIRMED cross-domain private-state accesses: ${report.confirmedAccesses} over ${report.confirmedPairs} (namespace, capability) pair(s)   (section 18 target: 0)`);
  for (const access of report.confirmed) lines.push(`[p2d]   ${access.namespace} (owner ${access.declaredOwner}) <- ${access.accessedBy}  ${access.file}:${access.line}`);
  lines.push(`[p2d] unclassified namespace joins (no durable-root marker; a reader must classify each): ${report.candidates}`);
  for (const access of report.candidateAccesses) lines.push(`[p2d]   ${access.namespace} <- ${access.accessedBy}  ${access.file}:${access.line}`);
  lines.push(`[p2d] multi-writer candidates: ${report.multiWriterCandidates.length} -- ${report.multiWriterClaim}`);
  for (const entry of report.multiWriterCandidates) lines.push(`[p2d]   ${entry.namespace} (owner ${entry.declaredOwner}) touched by ${entry.accessedBy.join(", ")}`);
  lines.push(`[p2d] declared durable namespaces ${report.declaredNamespaces}; scanned source files ${report.scannedSourceFiles}`);
  for (const line of decision.improvements) lines.push(`[p2d] IMPROVED ${line}`);
  if (decision.ok) {
    lines.push("[p2d] VERDICT=HOLDS (no recorded ceiling was exceeded and nothing was hidden to achieve it)");
    return lines.join("\n");
  }
  lines.push(`[p2d] VERDICT=REGRESSED (${decision.problems.length} problem(s))`);
  for (const problem of decision.problems) lines.push(`[p2d]   - ${problem}`);
  return lines.join("\n");
}

function main(argv) {
  const report = measure();
  const decision = decide(report, readRatchet());
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify({ report, decision }, null, 2)}\n`);
  else process.stdout.write(`${render(report, decision)}\n`);
  return decision.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`phase2-private-state failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, measure, decide, readRatchet, declaredNamespaces, namespaceConstantsOf, durableRootNamesOf, namespaceJoinsIn, namespaceOfJoin, RATCHET_PATH };
