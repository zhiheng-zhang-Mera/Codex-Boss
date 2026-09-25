#!/usr/bin/env node
/**
 * THE ROADS VALIDATOR (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 19, P2-E)
 *
 * WHAT THIS CHECKS, AND WHY IT IS NOT A FORMALITY
 *
 *   A road declaration is the cheapest way in this whole programme to make a number move without repairing
 *   anything: attribute an edge to the class `<road>` and a kernel stops "depending on a building" without a line of
 *   code changing. Section 24 of docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md refuses exactly that (count compensation), and ledger CC-030 already measured one
 *   attempt and refused it.
 *
 *   So a declaration has to pass BOTH halves of a test that the machine can check:
 *
 *     NECESSARY   the file is a LEAF -- imported across a capability boundary by two or more capabilities, and
 *                 importing NO other capability. A file that reaches a capability is that capability's surface with
 *                 many callers, and attributing it to the road class would HIDE its edges.
 *     SUFFICIENT  the file carries NO POLICY OF ITS OWN -- types, enumerations, tables and mechanical primitives
 *                 over data are roads; a function that decides an outcome is not. This half cannot be automated
 *                 without pretending to solve a semantic judgement, so the machine enforces the EVIDENCE: five
 *                 substantive proofs, and a REFUTATION RECORD for the candidates that pass the leaf test and are
 *                 still refused. A refutation is not decoration -- it is what stops the next reader re-proposing the
 *                 same file, and the validator refuses a refutation for a file that was never a candidate.
 *
 *   It also refuses the two structural ways a declaration could cheat: a road that is also a composition-root file
 *   or exempt (two contradictory answers about who owns it), and a road whose declared owner is not the capability
 *   the ownership map actually gives it (which would mean the declaration is describing a different tree).
 *
 * READ-ONLY. It measures and judges; it never writes.
 *
 * USAGE
 *
 *   node scripts/capability-roads-validator.cjs            check and print the report
 *   node scripts/capability-roads-validator.cjs --json     the report as JSON
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ROADS_PATH = path.join("config", "capability-roads.json");
const LEDGER_PATH = path.join("docs", "city", "OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md");
const ROAD = "<road>";
const PROOFS = ["whyShared", "whyNotBusiness", "invariant", "contract", "exitCondition"];

function readRoads(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, ROADS_PATH), "utf8"));
}

function substantive(value, minimum) {
  return typeof value === "string" && value.trim().length >= minimum;
}

/** Everything measured, with the instrument's own primitives so this cannot disagree with the counts CI enforces. */
function measure(root = ROOT, options = {}) {
  const inspect = options.scan ?? require(path.join(ROOT, "scripts", "phase2-pair-edges.cjs")).scan();
  const closure = require(path.join(ROOT, "scripts", "capability-closure-validator.cjs"));
  const map = closure.readOwnershipMap(root);
  const manifests = closure.readManifests(root);
  const kinds = new Map(manifests.filter((manifest) => manifest.id).map((manifest) => [manifest.id, manifest.kind ?? null]));
  const ownerKind = (capability) => kinds.get(capability) ?? null;

  const importers = new Map();
  const reached = new Map();
  for (const edge of inspect.edges) {
    const set = importers.get(edge.toFile) ?? new Set();
    set.add(edge.from);
    importers.set(edge.toFile, set);
    const out = reached.get(edge.fromFile) ?? new Set();
    out.add(edge.to);
    reached.set(edge.fromFile, out);
  }
  const ownerOf = new Map();
  const kindOf = new Map();
  for (const edge of inspect.edges) {
    if (edge.to !== ROAD) ownerOf.set(edge.toFile, edge.to);
    kindOf.set(edge.from, edge.fromKind);
  }
  const kernelEdgesOnto = new Map();
  for (const edge of inspect.edges) {
    if (edge.fromKind === "kernel" && edge.to === ROAD) kernelEdgesOnto.set(edge.toFile, (kernelEdgesOnto.get(edge.toFile) ?? 0) + 1);
  }
  return { inspect, map, importers, reached, ownerOf, kindOf, kernelEdgesOnto, ownerKind };
}

function validate(root = ROOT, options = {}) {
  const roads = options.roads ?? readRoads(root);
  const ledger = fs.existsSync(path.join(root, LEDGER_PATH)) ? fs.readFileSync(path.join(root, LEDGER_PATH), "utf8") : "";
  const { inspect, map, importers, reached, ownerOf, kernelEdgesOnto, ownerKind } = measure(root, options);
  const problems = [];
  const entries = [];

  const classification = roads.classification ?? {};
  for (const field of ["necessary_condition", "sufficient_condition", "why_this_is_not_count_compensation"]) {
    if (!substantive(classification[field], 80)) problems.push(`classification.${field} is missing or too thin to be a rule`);
  }

  const compositionRootPaths = new Set(Object.keys(map.compositionRoot ?? {}));
  const exemptPaths = new Set(Object.keys(map.exempt ?? {}));
  const declaredOwners = map.capabilities ?? {};

  const claimedBy = (file) => Object.entries(declaredOwners).filter(([, patterns]) => patterns.some((pattern) => {
    const normalized = String(pattern).replace(/\\/g, "/").replace(/\/+$/, "");
    return file === normalized || file.startsWith(`${normalized}/`);
  })).map(([capability]) => capability);

  const roadEntries = Object.entries(roads.roads ?? {});
  for (const [file, entry] of roadEntries) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      problems.push(`road ${file} does not exist or is not a file`);
      continue;
    }
    // NECESSARY -- the leaf test.
    const reaches = [...(reached.get(file) ?? new Set())];
    const consumers = [...(importers.get(file) ?? new Set())].sort();
    if (reaches.length > 0) {
      problems.push(`road ${file} imports ${reaches.join(", ")}: a road that reaches a capability is not a road, and attributing it would hide that edge (ledger CC-030)`);
    }
    if (consumers.length < 2) {
      problems.push(`road ${file} is imported by ${consumers.length} capabilit(ies): section 19's definition is a capability needed by SEVERAL independent buildings`);
    }
    // The declaration must describe the tree as it is.
    const declared = claimedBy(file);
    if (declared.length === 0) {
      problems.push(`road ${file} is owned by no capability in the ownership map, so it is not trapped inside a building and is not a road`);
    } else if (declared.length > 1) {
      problems.push(`road ${file} is claimed by ${declared.join(" and ")} in the ownership map, which the closure validator refuses outright`);
    } else if (entry.owner !== declared[0]) {
      problems.push(`road ${file} declares owner ${JSON.stringify(entry.owner)} but the ownership map gives it to ${declared[0]}`);
    } else if (ownerKind(declared[0]) !== "feature") {
      // Section 19's road (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md) is a shared concern trapped inside a BUILDING. A file owned by a kernel is already
      // foundation, so declaring it a road moves nothing and says nothing -- and the first version of this
      // validator accepted exactly that, which the falsification case caught.
      problems.push(`road ${file} is owned by ${declared[0]}, whose manifest kind is ${JSON.stringify(ownerKind(declared[0]))} rather than a feature: it is not trapped inside a building`);
    }
    if (compositionRootPaths.has(file)) problems.push(`road ${file} is also a composition-root file: the platform owns it, so it is not trapped inside a building`);
    if (exemptPaths.has(file)) problems.push(`road ${file} is also exempt: "a building owns this" and "nobody owns this" are contradictory claims about one file`);
    // SUFFICIENT -- the evidence, machine-enforced because the judgement cannot be.
    for (const proof of PROOFS) {
      if (!substantive(entry[proof], 60)) problems.push(`road ${file} does not state a substantive ${proof}`);
    }
    if (!substantive(entry.ledgerEntry, 2)) {
      problems.push(`road ${file} names no ledger entry, so nothing append-only records why it was declared`);
    } else if (!ledger.includes(`ENTRY_ID                    ${entry.ledgerEntry}`)) {
      problems.push(`road ${file} cites ledger entry ${entry.ledgerEntry}, which the ledger does not contain`);
    }
    entries.push({
      file,
      owner: entry.owner ?? null,
      measuredOwner: declared[0] ?? null,
      consumers,
      leaf: reaches.length === 0,
      kernelEdges: kernelEdgesOnto.get(file) ?? 0,
    });
  }

  // A refutation must be a REAL candidate: a file that was never a leaf would make the record look thorough while
  // recording nothing, and a file with one consumer was never a candidate under docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 19 either.
  const refuted = Object.entries(roads.refuted ?? {});
  const refutations = [];
  for (const [file, entry] of refuted) {
    if (!fs.existsSync(path.join(root, file))) {
      problems.push(`refuted candidate ${file} does not exist`);
      continue;
    }
    const reaches = [...(reached.get(file) ?? new Set())];
    const consumers = [...(importers.get(file) ?? new Set())].sort();
    if (reaches.length > 0) problems.push(`refuted candidate ${file} is not even a leaf, so it was never a candidate and the refutation records nothing`);
    if (consumers.length < 2) problems.push(`refuted candidate ${file} has ${consumers.length} consumer(s), so it was never a candidate under section 19`);
    if (!substantive(entry.reason, 100)) problems.push(`refuted candidate ${file} does not state a substantive reason`);
    if (Object.prototype.hasOwnProperty.call(roads.roads ?? {}, file)) problems.push(`${file} is both declared a road and recorded as refuted`);
    refutations.push({ file, owner: ownerOf.get(file) ?? entry.owner ?? null, consumers, leaf: reaches.length === 0 });
  }

  // The effect, resolved from the instrument rather than declared.
  const edgesToRoads = inspect.edges.filter((edge) => edge.to === ROAD).length;
  const edgesFromRoads = inspect.edges.filter((edge) => edge.from === ROAD).length;
  const kernelEdgesOntoRoads = [...kernelEdgesOnto.values()].reduce((sum, value) => sum + value, 0);
  const kernelEdgesOntoFeatureRoads = roadEntries
    .filter(([, entry]) => (map.capabilities?.[entry.owner] ? entry.owner : null) !== null)
    .filter(([file]) => {
      const ownerKind = inspect.edges.find((edge) => edge.fromFile === file)?.fromKind ?? null;
      return ownerKind === null || ownerKind === "feature";
    })
    .reduce((sum, [file]) => sum + (kernelEdgesOnto.get(file) ?? 0), 0);
  const kernelToFeatureNow = inspect.totals.kernelToFeatureFileEdges;
  const kernelToFeatureBefore = kernelToFeatureNow + kernelEdgesOntoFeatureRoads;

  // The disposition work list of docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 16: leaves that a KERNEL imports across a boundary and that are neither declared a
  // road nor refused as one. Each is either shared surface (declare it) or a building dependency (extract it), and
  // until it is dispositioned the kernel -> feature count cannot honestly reach zero. Resolved HERE rather than in
  // the acceptance suite, so that one program owns the number.
  const undispositioned = [];
  for (const [file, consumers] of importers) {
    if ((reached.get(file)?.size ?? 0) !== 0) continue;
    if (consumers.size < 2) continue;
    if (Object.prototype.hasOwnProperty.call(roads.roads ?? {}, file)) continue;
    if (Object.prototype.hasOwnProperty.call(roads.refuted ?? {}, file)) continue;
    if ((kernelEdgesOnto.get(file) ?? 0) === 0) continue;
    undispositioned.push({ file, owner: ownerOf.get(file) ?? null, consumers: [...consumers].sort(), kernelEdges: kernelEdgesOnto.get(file) ?? 0 });
  }
  undispositioned.sort((a, b) => b.kernelEdges - a.kernelEdges || a.file.localeCompare(b.file));

  return {
    schema: "city-capability-roads-report/1",
    ok: problems.length === 0,
    problems,
    roads: entries,
    refutations,
    undispositioned,
    effect: {
      roads: roadEntries.length,
      refutedCandidates: refuted.length,
      edgesToRoads,
      edgesFromRoads,
      kernelEdgesOntoRoads,
      kernelToFeatureNow,
      kernelToFeatureBefore,
    },
  };
}

function render(report) {
  const lines = [];
  lines.push(`[roads] declared ${report.effect.roads} road(s), ${report.effect.refutedCandidates} measured refutation(s)`);
  for (const entry of report.roads) {
    lines.push(`[roads]   ${entry.file}  owner ${entry.owner}  LEAF ${entry.leaf}  consumers ${entry.consumers.length}: ${entry.consumers.join(", ")}`);
  }
  for (const entry of report.refutations) {
    lines.push(`[roads]   REFUTED ${entry.file}  owner ${entry.owner}  leaf ${entry.leaf}  consumers ${entry.consumers.length}`);
  }
  lines.push(`[roads] edges onto roads ${report.effect.edgesToRoads}; edges LEAVING roads ${report.effect.edgesFromRoads} (must be 0)`);
  lines.push(`[roads] measured kernel -> feature edges ${report.effect.kernelToFeatureNow}; before the declarations ${report.effect.kernelToFeatureBefore}`);
  if (report.ok) {
    lines.push("[roads] VERDICT=HOLDS (every declaration is a leafless shared sink, and every refutation is a real candidate)");
    return lines.join("\n");
  }
  lines.push(`[roads] VERDICT=REGRESSED (${report.problems.length} problem(s))`);
  for (const problem of report.problems) lines.push(`[roads]   - ${problem}`);
  return lines.join("\n");
}

function main(argv, root = ROOT) {
  const report = validate(root);
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${render(report)}\n`);
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`capability-roads-validator failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, validate, measure, readRoads, render, ROADS_PATH, PROOFS };
