#!/usr/bin/env node
/**
 * Update-Plan/self-evlo.md §17/§18/§19/§76 + §96/§97 — Validator B: the independent
 * Prestart certificate verifier.
 *
 *   node scripts/acceptance-evolution-certificate.cjs [--artifacts <dir>] [--root <dir>]
 *        [--certificate <file>] [--json] [--out <file>] [--no-git] [--allow-no-git]
 *        [--strict-reports]
 *
 * §17: an important certification is verified by TWO independent implementations.
 * Validator A is the TypeScript root auditor inside the Prestart generator. This file
 * is Validator B, and it is deliberately a different program:
 *
 *   - it never requires a TypeScript trust module — not the evidence layer, not the
 *     audit layer, not the session layer — and it never runs the generator script;
 *   - it re-implements canonical JSON (object keys sorted at every depth) and SHA-256
 *     itself, so agreeing with Validator A is evidence rather than a shared import;
 *   - its whole input is the repository (`git` via `node:child_process`), the
 *     certificate, the artifact directory, and the repository's own contract source.
 *
 * §19: the certificate's `state`/`bootstrap` fields are printed for information only
 * and are NEVER branched on. Every part of the verdict is re-derived here from bytes
 * on disk. (§97 makes those fields part of the root digest, so editing them breaks the
 * seal — that is tamper detection, not trust.)
 *
 * §97 root hash: `root_hash` is the canonical digest of the certificate body without
 * `root_hash` and without `certified_at`. Certificates written before §97 used the
 * older `prestart-attestation-1` composition (schema/session/commit/root/supporting/
 * manifest/decision); that digest is still accepted, but ONLY for a certificate that
 * carries no `tree_sha` and no `graduate_identity` whose session manifest also carries
 * no tree — an old seal may not silently replace a new one.
 *
 * Evidence modes: when the artifact directory ships the gate report files, every
 * report is re-hashed and re-validated (FULL). When it ships none of them — a
 * certificate download carrying only the certificate, its attestations, the session,
 * the ledger and the bootstrap record — each manifest entry is instead bound to its
 * attestation and to the bootstrap record; that mode is printed, carried in the JSON
 * verdict, and `--strict-reports` turns it into a failure. §42: a bundle that ships
 * *some* reports but not all of them is always a failure, never a degraded mode.
 *
 * Exit code: 0 exactly when the certificate is VALID.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

/* ------------------------------------------------------------------ *
 * 0. arguments
 * ------------------------------------------------------------------ */
const USAGE = [
  "usage: node scripts/acceptance-evolution-certificate.cjs [options]",
  "  --artifacts <dir>    acceptance artifact directory (default <root>/artifacts/acceptance)",
  "  --root <dir>         repository root whose git identity is re-read (default cwd)",
  "  --certificate <file> certificate to verify (default <artifacts>/prestart-attestation.json)",
  "  --json               print the machine-readable verdict as the final stdout block",
  "  --out <file>         write the machine-readable verdict to <file>",
  "  --no-git             do not re-read the repository (fatal unless --allow-no-git)",
  "  --allow-no-git       permit the git identity check to be NOT_CHECKED",
  "  --strict-reports     refuse a bundle that ships none of its gate report files"
].join("\n");

function parseArguments(argv) {
  const options = {
    artifacts: "",
    root: process.cwd(),
    certificate: "",
    json: false,
    out: "",
    noGit: false,
    allowNoGit: false,
    strictReports: false
  };
  const valued = new Set(["--artifacts", "--root", "--certificate", "--out"]);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument : argument.slice(0, separator);
    const inline = separator === -1 ? undefined : argument.slice(separator + 1);
    if (valued.has(name)) {
      const value = inline ?? argv[++index];
      if (value === undefined) {
        console.error(`[verify] ${name} needs a value`);
        console.error(USAGE);
        process.exit(2);
      }
      if (name === "--artifacts") options.artifacts = value;
      else if (name === "--root") options.root = value;
      else if (name === "--certificate") options.certificate = value;
      else options.out = value;
      continue;
    }
    if (name === "--json") { options.json = true; continue; }
    if (name === "--no-git") { options.noGit = true; continue; }
    if (name === "--allow-no-git") { options.allowNoGit = true; continue; }
    if (name === "--strict-reports") { options.strictReports = true; continue; }
    console.error(`[verify] unknown argument: ${argument}`);
    console.error(USAGE);
    process.exit(2);
  }
  options.root = path.resolve(options.root);
  options.artifacts = options.artifacts === "" ? path.join(options.root, "artifacts", "acceptance") : path.resolve(options.artifacts);
  options.certificate = options.certificate === "" ? path.join(options.artifacts, "prestart-attestation.json") : path.resolve(options.certificate);
  return options;
}

const options = parseArguments(process.argv.slice(2));
const SCRIPT_ROOT = path.resolve(__dirname, "..");

/* ------------------------------------------------------------------ *
 * 1. canonical form and digests, re-implemented here on purpose
 * ------------------------------------------------------------------ */

/** Deterministic JSON: object keys sorted at every depth, arrays keep their order. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function canonicalSha256(value) {
  return sha256Hex(canonicalJson(value));
}

/** The digest of a contract's required id list, mirrored from the evidence layer. */
function requiredIdsHash(ids) {
  return canonicalSha256([...ids]);
}

/** SHA-256 of a file's exact bytes, or "" when the file cannot be read. */
function sha256File(file) {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { ok: false, value: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isCommitSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

/* ------------------------------------------------------------------ *
 * 2. the repository's own contract source
 * ------------------------------------------------------------------ */

/**
 * §6.1: the versioned desktop black-box claim contract and its own digest, read from
 * the compiled module when it exists and otherwise re-derived from the source.
 */
function readDesktopClaimContract(repoRoot) {
  const compiledPath = path.join(repoRoot, "dist-electron", "src", "shared", "desktop-black-box-contract.js");
  if (fs.existsSync(compiledPath)) {
    try {
      const compiled = require(compiledPath);
      return {
        ok: true,
        version: compiled.DESKTOP_BLACK_BOX_CONTRACT_VERSION,
        ids: [...(compiled.DESKTOP_BLACK_BOX_REQUIRED_IDS || [])],
        claims: compiled.DESKTOP_BLACK_BOX_REQUIRED_CLAIMS,
        hash: compiled.DESKTOP_BLACK_BOX_CONTRACT_HASH,
        origin: relative(repoRoot, compiledPath) || compiledPath
      };
    } catch { /* fall through to the source */ }
  }
  const sourcePath = path.join(repoRoot, "src", "shared", "desktop-black-box-contract.ts");
  if (fs.existsSync(sourcePath)) {
    try {
      const text = fs.readFileSync(sourcePath, "utf8");
      const version = /DESKTOP_BLACK_BOX_CONTRACT_VERSION\s*=\s*"([^"]+)"/.exec(text);
      const requirements = [...text.matchAll(/\{\s*id:\s*"([^"]+)",\s*title:\s*"([^"]*)"\s*\}/g)].map((match) => [match[1], match[2]]);
      if (!version || requirements.length === 0) return { ok: false, reason: "the desktop claim contract could not be parsed" };
      return {
        ok: true,
        version: version[1],
        ids: requirements.map((entry) => entry[0]),
        claims: requirements.length,
        hash: sha256Hex(JSON.stringify({ version: version[1], requirements })),
        origin: relative(repoRoot, sourcePath) || sourcePath
      };
    } catch (error) {
      return { ok: false, reason: `the desktop claim contract could not be read (${error instanceof Error ? error.message : String(error)})` };
    }
  }
  return { ok: false, reason: "no desktop claim contract source could be read" };
}

/**
 * A deliberately small reader for the contract source: it extracts string constants
 * and the `{ gate, contract_version, report_file, required_ids, out_of_scope_ids,
 * exact_ids }` shape without evaluating TypeScript.
 */
function parseContractSource(text, desktop) {
  const constants = new Map();
  for (const match of text.matchAll(/export const ([A-Za-z_$][\w$]*)\s*=\s*"([^"]*)"/g)) constants.set(match[1], match[2]);
  for (const match of text.matchAll(/const ([A-Za-z_$][\w$]*)\s*:\s*AcceptanceOutOfScopeId\s*=\s*\{\s*id:\s*"([^"]+)"/g)) constants.set(match[1], match[2]);

  const resolve = (token) => {
    const value = String(token).trim();
    if (value.startsWith('"')) return value.slice(1, -1);
    if (!/^[A-Za-z_$][\w$]*$/.test(value)) return "";
    if (constants.has(value)) return constants.get(value);
    if (value === "DESKTOP_BLACK_BOX_GATE") return "acceptance-desktop-workbook";
    if (value === "DESKTOP_BLACK_BOX_CONTRACT_VERSION" && desktop.ok) return desktop.version;
    return "";
  };
  const arrayBody = (window, field) => {
    const start = window.indexOf(`${field}:`);
    if (start === -1) return undefined;
    const open = window.indexOf("[", start);
    if (open === -1) return undefined;
    let depth = 0;
    for (let index = open; index < window.length; index++) {
      if (window[index] === "[") depth++;
      else if (window[index] === "]") {
        depth--;
        if (depth === 0) return window.slice(open + 1, index);
      }
    }
    return undefined;
  };
  const idsOf = (body) => {
    if (body === undefined) return undefined;
    const literals = [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    if (literals.length) return literals;
    for (const identifier of [...body.matchAll(/[A-Za-z_$][\w$]*/g)].map((match) => match[0])) {
      if (identifier === "DESKTOP_BLACK_BOX_REQUIRED_IDS" && desktop.ok) return [...desktop.ids];
      if (constants.has(identifier)) return [constants.get(identifier)];
    }
    return [];
  };

  const groups = [
    { name: "delivery", index: text.indexOf("export const ACCEPTANCE_GATE_CONTRACTS") },
    { name: "desktop", index: text.indexOf("export const DESKTOP_BLACK_BOX_CONTRACT") },
    { name: "supporting", index: text.indexOf("export const ACCEPTANCE_SUPPORTING_CONTRACTS") }
  ].filter((group) => group.index !== -1).sort((left, right) => left.index - right.index);

  const gates = [...text.matchAll(/gate:\s*("([^"]+)"|[A-Za-z_$][\w$]*)/g)];
  const contracts = [];
  for (let index = 0; index < gates.length; index++) {
    const start = gates[index].index;
    const end = index + 1 < gates.length ? gates[index + 1].index : text.length;
    const window = text.slice(start, end);
    const gate = resolve(gates[index][1]);
    if (!gate) continue;
    const version = /contract_version:\s*("([^"]+)"|[A-Za-z_$][\w$]*)/.exec(window);
    const reportFile = /report_file:\s*"([^"]+)"/.exec(window);
    const required = idsOf(arrayBody(window, "required_ids"));
    if (!version || !reportFile || !required) continue;
    const group = groups.filter((candidate) => candidate.index <= start).pop();
    contracts.push({
      group: group ? group.name : "unknown",
      gate,
      contract_version: resolve(version[1]),
      report_file: reportFile[1],
      required_ids: required,
      out_of_scope_ids: idsOf(arrayBody(window, "out_of_scope_ids")) ?? [],
      exact_ids: /exact_ids:\s*true/.test(window)
    });
  }
  return contracts;
}

/**
 * The gate contracts the certificate is judged against. The compiled module is what
 * the generator itself runs, so it wins; the checked-in source is the fallback that
 * keeps a contract verifiable before the next build. When the two disagree about the
 * same gate there is no honest rule set to apply, so the verifier refuses.
 */
function readContractSource(repoRoot) {
  const contracts = new Map();
  const order = { delivery: [], desktop: [], supporting: [] };
  const problems = [];
  const notes = [];
  const sourcesUsed = [];
  const desktop = readDesktopClaimContract(repoRoot);

  const normalise = (raw, from, group) => {
    if (!isObject(raw) || typeof raw.gate !== "string" || raw.gate === "") return undefined;
    return {
      group,
      origin: from,
      gate: raw.gate,
      contract_version: typeof raw.contract_version === "string" ? raw.contract_version : "",
      report_file: typeof raw.report_file === "string" ? raw.report_file : "",
      required_ids: Array.isArray(raw.required_ids) ? raw.required_ids.map(String) : [],
      out_of_scope_ids: Array.isArray(raw.out_of_scope_ids)
        ? raw.out_of_scope_ids.map((entry) => (isObject(entry) ? String(entry.id) : String(entry)))
        : [],
      exact_ids: raw.exact_ids === true
    };
  };
  const remember = (contract) => {
    contracts.set(contract.gate, contract);
    const bucket = order[contract.group];
    if (bucket && !bucket.includes(contract.gate)) bucket.push(contract.gate);
  };

  let compiledContracts = [];
  const compiledPath = path.join(repoRoot, "dist-electron", "src", "shared", "acceptance-contracts.js");
  if (fs.existsSync(compiledPath)) {
    try {
      const compiled = require(compiledPath);
      compiledContracts = [
        ...(compiled.ACCEPTANCE_GATE_CONTRACTS || []).map((entry) => normalise(entry, "compiled module", "delivery")),
        normalise(compiled.DESKTOP_BLACK_BOX_CONTRACT, "compiled module", "desktop"),
        ...(compiled.ACCEPTANCE_SUPPORTING_CONTRACTS || []).map((entry) => normalise(entry, "compiled module", "supporting"))
      ].filter(Boolean);
      sourcesUsed.push(`${relative(SCRIPT_ROOT, compiledPath) || compiledPath} (compiled)`);
    } catch (error) {
      problems.push(`the compiled contract module could not be read (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  let sourceContracts = [];
  const sourcePath = path.join(repoRoot, "src", "shared", "acceptance-contracts.ts");
  if (fs.existsSync(sourcePath)) {
    try {
      sourceContracts = parseContractSource(fs.readFileSync(sourcePath, "utf8"), desktop)
        .map((entry) => normalise(entry, "typescript source", entry.group));
      sourcesUsed.push(`${relative(SCRIPT_ROOT, sourcePath) || sourcePath} (source)`);
    } catch (error) {
      problems.push(`the contract source could not be parsed (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  if (compiledContracts.length === 0 && sourceContracts.length === 0) {
    problems.push(`no contract source could be read under ${repoRoot}: the verifier refuses to guess the required id sets`);
    return { contracts, order, problems, notes, sourcesUsed, desktop };
  }

  for (const contract of compiledContracts) remember(contract);
  for (const contract of sourceContracts) {
    const known = contracts.get(contract.gate);
    if (!known) {
      remember(contract);
      notes.push(`the gate ${contract.gate} is declared by the contract source but not by the compiled module; the source was used`);
      continue;
    }
    const differing = ["contract_version", "report_file", "required_ids", "out_of_scope_ids", "exact_ids"]
      .filter((field) => !sameJson(known[field], contract[field]));
    if (differing.length) {
      problems.push(`the compiled module and the contract source disagree about ${contract.gate} (${differing.join(", ")}): a certificate cannot be judged under two rule sets, so rebuild before verifying`);
    }
  }
  return { contracts, order, problems, notes, sourcesUsed, desktop };
}

/* ------------------------------------------------------------------ *
 * 3. the strict report and attestation rules, re-derived
 * ------------------------------------------------------------------ */

function judgeReport(contract, report) {
  const problems = [];
  if (!isObject(report)) {
    problems.push("REPORT_NOT_OBJECT");
    return { problems, counts: { results: 0, pass: 0, fail: 0, notRun: 0 } };
  }
  if (report.schemaVersion !== 1) problems.push(`SCHEMA_VERSION_UNSUPPORTED:${String(report.schemaVersion)}`);
  if (typeof report.unit !== "string" || report.unit.trim() === "") problems.push("UNIT_MISSING");
  const results = [];
  const seen = new Set();
  if (!Array.isArray(report.requirementResults)) problems.push("RESULTS_NOT_ARRAY");
  else if (report.requirementResults.length === 0) problems.push("RESULTS_EMPTY");
  else {
    report.requirementResults.forEach((entry, index) => {
      if (!isObject(entry)) { problems.push(`RESULT_NOT_OBJECT:${index}`); return; }
      if (typeof entry.id !== "string" || entry.id.trim() === "") { problems.push(`RESULT_ID_INVALID:${index}`); return; }
      if (!["PASS", "FAIL", "NOT_RUN"].includes(entry.verdict)) { problems.push(`RESULT_VERDICT_INVALID:${entry.id}=${String(entry.verdict)}`); return; }
      if (seen.has(entry.id)) problems.push(`DUPLICATE_ID:${entry.id}`);
      seen.add(entry.id);
      results.push({ id: entry.id, verdict: entry.verdict });
    });
  }
  const required = [...contract.required_ids];
  const outOfScope = [...contract.out_of_scope_ids];
  const verdictOf = new Map(results.map((entry) => [entry.id, entry.verdict]));
  for (const id of required) {
    const verdict = verdictOf.get(id);
    if (verdict === undefined) problems.push(`REQUIRED_ID_MISSING:${id}`);
    else if (verdict !== "PASS") problems.push(`REQUIRED_ID_NOT_PASS:${id}=${verdict}`);
  }
  for (const entry of results) {
    if (entry.verdict === "FAIL") problems.push(`FAIL_PRESENT:${entry.id}`);
    if (entry.verdict === "NOT_RUN" && !outOfScope.includes(entry.id)) problems.push(`NOT_RUN_PRESENT:${entry.id}`);
  }
  for (const id of outOfScope) {
    if (!verdictOf.has(id)) problems.push(`OUT_OF_SCOPE_ID_MISSING:${id}`);
    else if (verdictOf.get(id) !== "NOT_RUN") problems.push(`OUT_OF_SCOPE_ID_NOT_NOT_RUN:${id}=${verdictOf.get(id)}`);
  }
  const counts = {
    results: results.length,
    pass: results.filter((entry) => entry.verdict === "PASS").length,
    fail: results.filter((entry) => entry.verdict === "FAIL").length,
    notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
  };
  if (!isObject(report.totals)) problems.push("TOTALS_MISSING");
  else {
    for (const field of ["pass", "fail", "notRun"]) {
      if (typeof report.totals[field] !== "number" || !Number.isFinite(report.totals[field])) problems.push(`TOTALS_FIELD_INVALID:${field}`);
      else if (report.totals[field] !== counts[field]) problems.push(`TOTALS_${field.toUpperCase()}_MISMATCH:${report.totals[field]}!=${counts[field]}`);
    }
    if (["pass", "fail", "notRun"].every((field) => typeof report.totals[field] === "number")
      && report.totals.pass + report.totals.fail + report.totals.notRun !== counts.results) {
      problems.push(`TOTALS_SUM_MISMATCH:${report.totals.pass + report.totals.fail + report.totals.notRun}!=${counts.results}`);
    }
  }
  if (report.passed !== true) problems.push(`PASSED_NOT_TRUE:${String(report.passed)}`);
  if (contract.exact_ids) {
    const extras = [...new Set(results.filter((entry) => !required.includes(entry.id)).map((entry) => entry.id))];
    const missing = required.filter((id) => !verdictOf.has(id));
    if (extras.length) problems.push(`EXACT_IDS_EXTRA:${extras.join(",")}`);
    if (missing.length) problems.push(`EXACT_IDS_MISSING:${missing.join(",")}`);
  }
  return { problems, counts };
}

/** The §5.5 attestation rules: source bytes, provenance, id set, own digest. */
function judgeAttestation(gate, contract, session, certificate, attestation, sourceSha256) {
  const problems = [];
  if (!isObject(attestation)) return ["ATTESTATION_MISSING_OR_NOT_OBJECT"];
  if (attestation.schemaVersion !== 1) problems.push(`ATTESTATION_SCHEMA_UNSUPPORTED:${String(attestation.schemaVersion)}`);
  if (attestation.gate !== gate) problems.push(`ATTESTATION_GATE_MISMATCH:${String(attestation.gate)}`);
  if (attestation.contract_version !== contract.contract_version) problems.push(`ATTESTATION_CONTRACT_VERSION_MISMATCH:${String(attestation.contract_version)}!=${contract.contract_version}`);
  if (attestation.session_id !== certificate.session_id) problems.push(`ATTESTATION_SESSION_MISMATCH:${String(attestation.session_id)}!=${certificate.session_id}`);
  if (attestation.commit_sha !== certificate.commit_sha) problems.push(`ATTESTATION_COMMIT_MISMATCH:${String(attestation.commit_sha).slice(0, 12)}…!=${certificate.commit_sha.slice(0, 12)}…`);
  if (typeof session?.tree_sha === "string" && session.tree_sha !== "" && attestation.tree_sha !== session.tree_sha) {
    problems.push(`ATTESTATION_TREE_MISMATCH:${String(attestation.tree_sha).slice(0, 12)}…!=${session.tree_sha.slice(0, 12)}…`);
  }
  if (attestation.source_file !== contract.report_file) problems.push(`ATTESTATION_SOURCE_FILE_MISMATCH:${String(attestation.source_file)}!=${contract.report_file}`);
  if (!isSha256(attestation.source_sha256)) problems.push(`ATTESTATION_SOURCE_SHA_INVALID:${String(attestation.source_sha256)}`);
  else if (sourceSha256 !== "" && attestation.source_sha256 !== sourceSha256) {
    problems.push(`SOURCE_HASH_MISMATCH:${gate} attested ${String(attestation.source_sha256).slice(0, 12)}… but the report on disk hashes to ${sourceSha256.slice(0, 12)}…`);
  }
  if (attestation.validation !== "PASS") problems.push(`ATTESTATION_VALIDATION_NOT_PASS:${String(attestation.validation)}`);
  if (attestation.required_ids_hash !== requiredIdsHash(contract.required_ids)) problems.push("ATTESTATION_REQUIRED_IDS_HASH_MISMATCH");
  if (!sameJson(attestation.required_ids ?? null, contract.required_ids)) problems.push("ATTESTATION_REQUIRED_IDS_MISMATCH");
  if (!sameJson(attestation.out_of_scope_ids ?? null, contract.out_of_scope_ids)) problems.push("ATTESTATION_OUT_OF_SCOPE_MISMATCH");
  if (typeof attestation.attestation_hash !== "string") problems.push("ATTESTATION_HASH_MISSING");
  else {
    const body = { ...attestation };
    delete body.attestation_hash;
    if (canonicalSha256(body) !== attestation.attestation_hash) problems.push("ATTESTATION_HASH_MISMATCH");
  }
  return problems;
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return { ok: false, status: result.status, output: String(result.stderr ?? result.error?.message ?? "").trim() };
  }
  return { ok: true, status: 0, output: String(result.stdout ?? "").trim() };
}

/* ------------------------------------------------------------------ *
 * 4. the checks
 * ------------------------------------------------------------------ */
const checks = [];
const notes = [];
let certificate;
let certificateSha256 = "";
let sessionValue;
let evidenceMode = "UNKNOWN";

function addCheck(name, verdict, detail, display) {
  const check = { name, verdict, detail, display: display ?? (verdict === "OK" ? "OK" : `${verdict} (${detail})`) };
  checks.push(check);
  return check;
}

function note(text) {
  if (!notes.includes(text)) notes.push(text);
}

const contractRepo = fs.existsSync(path.join(options.root, "src", "shared", "acceptance-contracts.ts")) ? options.root : SCRIPT_ROOT;
const contractSource = readContractSource(contractRepo);
const CONTRACTS = [...contractSource.contracts.values()];
const contractOf = (gate) => contractSource.contracts.get(gate);
for (const problem of contractSource.problems) note(`contract source: ${problem}`);
for (const text of contractSource.notes) note(`contract source: ${text}`);
if (CONTRACTS.length) note(`contract source: ${contractSource.sourcesUsed.join(" + ")} → ${contractSource.order.delivery.length} delivery gates, ${contractSource.order.desktop.length} desktop gate, ${contractSource.order.supporting.length} supporting suites`);
if (contractSource.desktop.ok) note(`desktop claim contract: ${contractSource.desktop.claims} claims from ${contractSource.desktop.origin}`);
else note(`desktop claim contract: ${contractSource.desktop.reason}`);

const CORE_SUPPORTING = ["acceptance-evidence-integrity", "acceptance-desktop-contract", "acceptance-owner-ledger", "acceptance-root-hardening", "acceptance-adversarial"];
// §18: when the repository's rules cannot be established there is nothing to judge a
// certificate against, so the gate checks fail closed instead of passing vacuously.
const CONTRACT_FAILURE = contractSource.problems.length > 0
  || CONTRACTS.length === 0
  || contractSource.order.delivery.length === 0
  || contractSource.order.desktop.length !== 1
  ? contractSource.problems.length > 0
    ? contractSource.problems.join("; ")
    : "the repository declares no usable contract set"
  : "";

const readCertificate = readJson(options.certificate);
if (!readCertificate.ok || !isObject(readCertificate.value)) {
  addCheck("certificate schema", "FAIL", `${options.certificate} is missing or not a JSON object${readCertificate.ok ? "" : ` (${readCertificate.error})`}`);
  addCheck("certificate state", "INFO", "no certificate", "FAIL (no certificate)");
  for (const name of ["root hash", "session", "git identity", "gate attestations", "gate reports", "owner ledger", "source manifest", "bootstrap record", "adversarial acceptance", "supporting suites"]) {
    addCheck(name, "NOT_CHECKED", "no certificate was readable");
  }
  addCheck("verdict", "FAIL", "INVALID_CERTIFICATE", "INVALID_CERTIFICATE");
  finish();
}
certificate = readCertificate.value;
certificateSha256 = sha256File(options.certificate);

/* ---------------- certificate schema ---------------- */
{
  const problems = [];
  if (certificate.schemaVersion !== 1) problems.push(`schemaVersion ${String(certificate.schemaVersion)}`);
  if (typeof certificate.state !== "string" || certificate.state === "") problems.push("state");
  if (typeof certificate.bootstrap !== "string" || certificate.bootstrap === "") problems.push("bootstrap");
  if (typeof certificate.session_id !== "string" || certificate.session_id === "") problems.push("session_id");
  if (!isCommitSha(certificate.commit_sha)) problems.push(`commit_sha ${String(certificate.commit_sha)}`);
  if (certificate.tree_sha !== undefined && !isCommitSha(certificate.tree_sha)) problems.push(`tree_sha ${String(certificate.tree_sha)}`);
  if (!isObject(certificate.gates) || typeof certificate.gates.passed !== "number" || typeof certificate.gates.required !== "number") problems.push("gates");
  if (!isObject(certificate.desktop_black_box) || typeof certificate.desktop_black_box.passed !== "boolean"
    || typeof certificate.desktop_black_box.verified_claims !== "number" || typeof certificate.desktop_black_box.required_claims !== "number") problems.push("desktop_black_box");
  if (!isObject(certificate.capabilities) || typeof certificate.capabilities.established !== "number" || typeof certificate.capabilities.required !== "number") problems.push("capabilities");
  if (typeof certificate.owner_interventions !== "number") problems.push("owner_interventions");
  if (!isObject(certificate.owner_intervention_ledger) || !isSha256(certificate.owner_intervention_ledger.sha256)
    || !isSha256(certificate.owner_intervention_ledger.hash) || typeof certificate.owner_intervention_ledger.events !== "number") problems.push("owner_intervention_ledger");
  if (!isObject(certificate.provenance)) problems.push("provenance");
  if (!isObject(certificate.adversarial_acceptance) || typeof certificate.adversarial_acceptance.passed !== "boolean"
    || typeof certificate.adversarial_acceptance.false_positive_cases !== "number") problems.push("adversarial_acceptance");
  if (!Array.isArray(certificate.supporting_evidence)) problems.push("supporting_evidence");
  if (!isObject(certificate.bootstrap_record) || typeof certificate.bootstrap_record.file !== "string"
    || !isSha256(certificate.bootstrap_record.sha256) || !isSha256(certificate.bootstrap_record.root_hash)
    || !Array.isArray(certificate.bootstrap_record.problems)) problems.push("bootstrap_record");
  if (!Array.isArray(certificate.sources)) problems.push("sources");
  else {
    certificate.sources.forEach((source, index) => {
      if (!isObject(source) || typeof source.gate !== "string" || typeof source.kind !== "string" || typeof source.report !== "string"
        || !isSha256(source.sha256) || typeof source.attestation !== "string"
        || !(source.attestation_sha256 === "" || isSha256(source.attestation_sha256))) {
        problems.push(`sources[${index}]`);
      }
    });
  }
  if (!Array.isArray(certificate.reasons)) problems.push("reasons");
  if (!isSha256(certificate.root_hash)) problems.push(`root_hash ${String(certificate.root_hash)}`);
  if (typeof certificate.certified_at !== "string" || Number.isNaN(Date.parse(certificate.certified_at))) problems.push("certified_at");
  if (certificate.graduate_identity !== undefined) {
    const identity = certificate.graduate_identity;
    if (!isObject(identity) || !isCommitSha(identity.commit_sha) || !isCommitSha(identity.tree_sha)
      || typeof identity.worktree_clean !== "boolean" || typeof identity.index_clean !== "boolean"
      || typeof identity.checked_at !== "string" || Number.isNaN(Date.parse(identity.checked_at)) || !Array.isArray(identity.problems)) {
      problems.push("graduate_identity");
    }
  }
  if (Array.isArray(certificate.reasons) && certificate.reasons.length !== 0) {
    problems.push(`the certificate body records ${certificate.reasons.length} reason(s), so it does not certify anything`);
  }
  if (isObject(certificate.gates) && certificate.gates.passed !== certificate.gates.required) {
    problems.push(`gates ${String(certificate.gates.passed)}/${String(certificate.gates.required)} trusted PASS`);
  }
  if (isObject(certificate.capabilities) && certificate.capabilities.established !== certificate.capabilities.required) {
    problems.push(`capabilities ${String(certificate.capabilities.established)}/${String(certificate.capabilities.required)} established`);
  }
  if (isObject(certificate.desktop_black_box) && certificate.desktop_black_box.passed !== true) problems.push("the desktop black box is not PASS");
  if (certificate.owner_interventions !== 0) problems.push(`${String(certificate.owner_interventions)} Owner intervention(s) were needed`);
  if (certificate.tree_sha === undefined && certificate.graduate_identity === undefined) {
    note("certificate schema: this certificate carries no tree_sha and no graduate_identity, so it predates the §6 tree binding");
  }
  addCheck("certificate schema", problems.length ? "FAIL" : "OK",
    problems.length ? [...new Set(problems)].slice(0, 4).join("; ") : `schemaVersion 1, ${certificate.sources.length} manifest sources, ${certificate.supporting_evidence.length} supporting entries`);
}

/* ---------------- certificate state (§19: printed, never trusted) ---------------- */
addCheck("certificate state", "INFO", `${String(certificate.state)} / bootstrap ${String(certificate.bootstrap)} (ignored as evidence — §19)`,
  `${String(certificate.state)} (ignored as evidence — §19)`);

/* ---------------- session manifest (read early: the root hash needs its format) ---------------- */
const sessionRead = readJson(path.join(options.artifacts, "session.json"));
if (sessionRead.ok && isObject(sessionRead.value)) sessionValue = sessionRead.value;

/* ---------------- root hash (§97) ---------------- */
{
  const problems = [];
  const body = { ...certificate };
  delete body.root_hash;
  delete body.certified_at;
  const recomputed = canonicalSha256(body);
  const supportingEvidence = Array.isArray(certificate.supporting_evidence) ? certificate.supporting_evidence : [];
  const manifestSources = Array.isArray(certificate.sources) ? certificate.sources : [];
  const legacyComposition = {
    schema: "prestart-attestation-1",
    session_id: certificate.session_id,
    commit_sha: certificate.commit_sha,
    bootstrap_root_hash: certificate.bootstrap_record?.root_hash,
    supporting: supportingEvidence.map((entry) => ({ gate: entry?.gate, report_sha256: entry?.report_sha256, attestation_sha256: entry?.attestation_sha256 })),
    manifest: manifestSources.map((entry) => ({ gate: entry?.gate, sha256: entry?.sha256, attestation_sha256: entry?.attestation_sha256 })),
    decision: Array.isArray(certificate.reasons) && certificate.reasons.length === 0 ? "PRESTART_CERTIFIED" : "PRESTART_INCOMPLETE"
  };
  const legacyRecomputed = canonicalSha256(legacyComposition);
  const legacyEligible = certificate.tree_sha === undefined
    && certificate.graduate_identity === undefined
    && (sessionValue === undefined || sessionValue.tree_sha === undefined);
  let detail = "";
  if (recomputed === certificate.root_hash) {
    detail = "§97 body digest (canonical sha256 of the body without root_hash and certified_at)";
  } else if (legacyEligible && legacyRecomputed === certificate.root_hash) {
    detail = "legacy prestart-attestation-1 digest (pre-§97 certificate: no tree binding)";
    note("root hash: this certificate is sealed with the superseded pre-§97 digest, which does not cover state/bootstrap/tree/reasons; it was accepted only because neither the certificate nor its session carries a tree binding");
  } else {
    problems.push(`recorded ${certificate.root_hash.slice(0, 16)}… but the body hashes to ${recomputed.slice(0, 16)}…`);
    if (legacyRecomputed === certificate.root_hash) problems.push("it only satisfies the legacy digest while declaring a §6 tree binding");
  }
  addCheck("root hash", problems.length ? "FAIL" : "OK", problems.length ? problems.join("; ") : detail);
}

/* ---------------- session ---------------- */
{
  const problems = [];
  if (!sessionRead.ok || !isObject(sessionRead.value)) {
    problems.push(`session.json is missing or unreadable (${sessionRead.ok ? "not an object" : sessionRead.error})`);
  } else {
    sessionValue = sessionRead.value;
    const session = sessionValue;
    if (session.schemaVersion !== 1) problems.push(`session schemaVersion ${String(session.schemaVersion)}`);
    if (typeof session.session_id !== "string" || session.session_id === "") problems.push("session_id");
    if (!isCommitSha(session.commit_sha)) problems.push(`session commit_sha ${String(session.commit_sha)}`);
    if (typeof session.started_at !== "string" || Number.isNaN(Date.parse(session.started_at))) problems.push("session started_at");
    if (typeof session.certification_mode !== "boolean") problems.push("session certification_mode");
    else if (session.certification_mode !== true) problems.push("the session is not a certification session");
    if (typeof session.working_tree_clean !== "boolean") problems.push("session working_tree_clean");
    else if (session.working_tree_clean !== true) problems.push("the session recorded a dirty working tree");
    if (session.working_tree_clean === true && session.working_tree_status !== "") problems.push("session working_tree_status is not empty");
    // §6: a certificate that declares a tree binding must come from a session that
    // knew its tree. A pre-§6 pair (neither the certificate nor the session has one)
    // is reported as a note instead, never silently upgraded.
    const expectsTree = certificate.tree_sha !== undefined || certificate.graduate_identity !== undefined;
    if (typeof session.tree_sha !== "string" || !isCommitSha(session.tree_sha)) {
      if (expectsTree) problems.push(`session tree_sha ${String(session.tree_sha)}`);
      else note("session: the session manifest carries no tree_sha, and neither does the certificate (pre-§6 evidence)");
    }
    if (expectsTree && session.certification_mode === true && !isCommitSha(session.tree_sha)) {
      problems.push("a certification session must bind the tree it certifies");
    }
    if (session.session_id !== certificate.session_id) problems.push(`session ${String(session.session_id)} != certificate ${certificate.session_id}`);
    if (session.commit_sha !== certificate.commit_sha) problems.push(`session commit ${String(session.commit_sha).slice(0, 12)}… != certificate ${certificate.commit_sha.slice(0, 12)}…`);
    if (certificate.tree_sha !== undefined && session.tree_sha !== certificate.tree_sha) {
      problems.push(`session tree ${String(session.tree_sha).slice(0, 12)}… != certificate ${String(certificate.tree_sha).slice(0, 12)}…`);
    }
    if (isObject(certificate.graduate_identity)) {
      const identity = certificate.graduate_identity;
      if (identity.commit_sha !== certificate.commit_sha) problems.push(`graduate_identity commit ${String(identity.commit_sha).slice(0, 12)}… != the certified commit`);
      if (identity.tree_sha !== session.tree_sha) problems.push(`graduate_identity tree ${String(identity.tree_sha).slice(0, 12)}… != the session tree`);
      if (identity.worktree_clean !== true || identity.index_clean !== true) problems.push("graduate_identity records a dirty worktree or index");
      if (Array.isArray(identity.problems) && identity.problems.length) problems.push(`graduate_identity records ${identity.problems.length} identity problem(s)`);
    }
  }
  addCheck("session", problems.length ? "FAIL" : "OK",
    problems.length ? [...new Set(problems)].slice(0, 3).join("; ") : `${String(certificate.session_id)} @ ${certificate.commit_sha.slice(0, 12)}…, certification session, clean tree, tree bound`);
}

/* ---------------- git identity (§5/§6) ---------------- */
{
  const probe = git(options.root, ["rev-parse", "--is-inside-work-tree"]);
  const isRepo = probe.ok && probe.output === "true";
  const skip = options.noGit || options.allowNoGit || !isRepo;
  if (skip) {
    const why = options.allowNoGit ? "--allow-no-git" : options.noGit ? "--no-git" : `${options.root} is not a git repository`;
    const recorded = isObject(certificate.graduate_identity) && Array.isArray(certificate.graduate_identity.problems) ? certificate.graduate_identity.problems : [];
    const allowed = options.allowNoGit;
    addCheck("git identity", allowed ? "NOT_CHECKED" : "FAIL",
      `${why}: HEAD and the tree were not re-read from the repository${recorded.length ? `; the certificate records ${recorded.length} identity problem(s)` : ""}`,
      `${allowed ? "NOT_CHECKED" : "FAIL"} (${why})`);
    if (!allowed) note("git identity: --allow-no-git is only for a certificate verified outside the repository it certifies");
  } else {
    const problems = [];
    const head = git(options.root, ["rev-parse", "HEAD"]);
    const tree = git(options.root, ["rev-parse", "HEAD^{tree}"]);
    const status = git(options.root, ["status", "--porcelain"]);
    const index = git(options.root, ["diff", "--cached", "--quiet"]);
    const worktree = git(options.root, ["diff", "--quiet"]);
    if (!head.ok) problems.push(`HEAD could not be read (${head.output})`);
    else if (head.output !== certificate.commit_sha) problems.push(`HEAD ${head.output.slice(0, 12)}… != commit_sha ${certificate.commit_sha.slice(0, 12)}…`);
    if (certificate.tree_sha === undefined) problems.push("the certificate carries no tree_sha, so HEAD^{tree} cannot be bound");
    else if (!tree.ok) problems.push(`HEAD^{tree} could not be read (${tree.output})`);
    else if (tree.output !== certificate.tree_sha) problems.push(`HEAD^{tree} ${tree.output.slice(0, 12)}… != tree_sha ${certificate.tree_sha.slice(0, 12)}…`);
    if (!status.ok) problems.push(`git status could not be read (${status.output})`);
    else if (status.output !== "") problems.push(`the worktree is dirty (${status.output.split("\n").length} entry/entries)`);
    if (index.status !== 0) problems.push("the index has staged changes");
    if (worktree.status !== 0) problems.push("the worktree has unstaged changes");
    if (isObject(certificate.graduate_identity)) {
      const identity = certificate.graduate_identity;
      if (identity.commit_sha !== head.output) problems.push("graduate_identity.commit_sha != HEAD");
      if (identity.tree_sha !== tree.output) problems.push("graduate_identity.tree_sha != HEAD^{tree}");
      if (identity.worktree_clean !== (status.output === "")) problems.push("graduate_identity.worktree_clean disagrees with git");
      if (identity.index_clean !== (index.status === 0)) problems.push("graduate_identity.index_clean disagrees with git");
      if (Array.isArray(identity.problems) && identity.problems.length) problems.push(`graduate_identity records ${identity.problems.length} identity problem(s)`);
    }
    addCheck("git identity", problems.length ? "FAIL" : "OK",
      problems.length ? [...new Set(problems)].slice(0, 3).join("; ") : `HEAD ${head.output.slice(0, 12)}… == commit_sha, HEAD^{tree} == tree_sha, worktree and index clean`);
  }
}

/* ---------------- the evidence set the certificate must cover ---------------- */
const declaredSupporting = (Array.isArray(certificate.supporting_evidence) ? certificate.supporting_evidence : [])
  .map((entry) => (isObject(entry) ? String(entry.gate) : ""))
  .filter((gate) => gate !== "");
const supportingRequired = [...new Set([...CORE_SUPPORTING, ...declaredSupporting])];
const coreGates = [...contractSource.order.delivery, ...contractSource.order.desktop];
const requiredGates = [...new Set([...coreGates, ...supportingRequired])];
const manifestOf = (gate) => (Array.isArray(certificate.sources) ? certificate.sources : []).find((entry) => isObject(entry) && entry.gate === gate);
const reportFileOf = (gate, contract) => path.join(options.artifacts, path.basename(String(manifestOf(gate)?.report || contract?.report_file || `${gate}.json`)));
const attestationFileOf = (gate) => path.join(options.artifacts, "attestations", `${gate}.json`);

const evidence = requiredGates.map((gate) => {
  const contract = contractOf(gate);
  const reportFile = reportFileOf(gate, contract);
  const attestationFile = attestationFileOf(gate);
  const reportSha256 = sha256File(reportFile);
  const attestationSha256 = sha256File(attestationFile);
  const parsed = readJson(reportFile);
  return {
    gate,
    contract,
    reportFile,
    reportPresent: reportSha256 !== "",
    reportSha256,
    report: parsed.ok ? parsed.value : undefined,
    attestationFile,
    attestationPresent: attestationSha256 !== "",
    attestationSha256,
    attestation: (() => {
      const read = readJson(attestationFile);
      return read.ok ? read.value : undefined;
    })()
  };
});

// §42: the report files are either all shipped or none are; partial coverage is a
// deletion, never a degraded bundle.
const shipped = evidence.filter((entry) => entry.reportPresent).length;
evidenceMode = shipped === evidence.length ? "FULL" : shipped === 0 ? "ATTESTATION_ONLY" : "PARTIAL";
if (evidenceMode === "PARTIAL") {
  const missing = evidence.filter((entry) => !entry.reportPresent).map((entry) => entry.gate);
  note(`evidence mode: PARTIAL — ${missing.length} report file(s) are missing from the bundle (${missing.slice(0, 5).join(", ")})`);
} else if (evidenceMode === "ATTESTATION_ONLY") {
  note("evidence mode: ATTESTATION_ONLY — this bundle ships none of the gate report files, so each manifest entry is bound to its attestation and to the bootstrap record instead of being re-hashed; --strict-reports refuses this mode");
}
const reportBytesVerified = evidenceMode === "FULL";

/* ---------------- gate attestations ---------------- */
{
  const problems = [];
  const satisfied = [];
  if (CONTRACT_FAILURE) problems.push(`the repository's contract rules could not be established (${CONTRACT_FAILURE})`);
  for (const entry of evidence) {
    const { gate, contract } = entry;
    if (!contract) {
      problems.push(`${gate}: the repository declares no contract for this gate`);
      continue;
    }
    const issues = [];
    if (!entry.attestationPresent) issues.push(`the attestation attestations/${gate}.json is missing from the bundle`);
    const manifest = manifestOf(gate);
    if (!manifest) issues.push("the certificate's source manifest has no entry for this gate");
    issues.push(...judgeAttestation(gate, contract, sessionValue, certificate, entry.attestation, entry.reportSha256));
    if (manifest) {
      if (isObject(entry.attestation) && entry.attestation.source_sha256 !== manifest.sha256) {
        issues.push(`the attestation binds source ${String(entry.attestation.source_sha256).slice(0, 12)}… but the manifest records ${String(manifest.sha256).slice(0, 12)}…`);
      }
      if (entry.attestationPresent && manifest.attestation_sha256 !== entry.attestationSha256) {
        issues.push(`the manifest records attestation ${String(manifest.attestation_sha256).slice(0, 12)}… but the file hashes to ${entry.attestationSha256.slice(0, 12)}…`);
      }
    }
    const unique = [...new Set(issues)];
    if (unique.length) problems.push(`${gate}: ${unique.slice(0, 2).join("; ")}`);
    else satisfied.push(gate);
  }
  // Evidence the certificate ignores is worse than absent evidence.
  for (const contract of CONTRACTS) {
    if (coreGates.includes(contract.gate) || supportingRequired.includes(contract.gate)) continue;
    if (fs.existsSync(attestationFileOf(contract.gate))) {
      problems.push(`${contract.gate}: the bundle holds an attestation for a suite this certificate does not cover`);
    }
  }
  const uncovered = CONTRACTS.filter((contract) => !coreGates.includes(contract.gate)
    && !supportingRequired.includes(contract.gate)).map((contract) => contract.gate);
  if (uncovered.length) {
    note(`gate attestations: the certificate covers ${declaredSupporting.length} supporting suite(s); ${uncovered.length} suite(s) declared by this repository are newer than it (${uncovered.slice(0, 4).join(", ")})`);
  }
  addCheck("gate attestations", problems.length ? "FAIL" : "OK",
    problems.length ? [...new Set(problems)].slice(0, 3).join(" | ") : `${evidence.length} attestations bound to ${certificate.session_id} @ ${certificate.commit_sha.slice(0, 12)}… with recomputed digests`,
    `${satisfied.length}/${evidence.length} ${problems.length ? `FAIL (${[...new Set(problems)].slice(0, 2).join(" | ")})` : "OK"}`);
}

/* ---------------- gate reports ---------------- */
{
  const problems = [];
  let validated = 0;
  if (CONTRACT_FAILURE) problems.push(`the repository's contract rules could not be established (${CONTRACT_FAILURE})`);
  for (const entry of evidence) {
    const { gate, contract } = entry;
    if (!contract) { problems.push(`${gate}: the repository declares no contract for this gate`); continue; }
    if (!entry.reportPresent) {
      if (reportBytesVerified || evidenceMode === "PARTIAL") { problems.push(`${gate}: the report file is missing from the bundle`); continue; }
      // ATTESTATION_ONLY: the report bytes are not in the bundle, so the strongest
      // available statement is that the attestation passed its own strict validation.
      if (!isObject(entry.attestation) || entry.attestation.validation !== "PASS") problems.push(`${gate}: no attestation records a PASS validation`);
      else validated += 1;
      continue;
    }
    const issues = [...judgeReport(contract, entry.report).problems];
    if (gate === contractSource.order.desktop[0]) {
      const block = isObject(entry.report) ? entry.report.contract : undefined;
      if (!contractSource.desktop.ok) issues.push(`DESKTOP_CONTRACT_UNREADABLE:${contractSource.desktop.reason}`);
      else if (!isObject(block)) issues.push("DESKTOP_CONTRACT_MISSING");
      else {
        if (block.version !== contractSource.desktop.version) issues.push(`DESKTOP_CONTRACT_VERSION_MISMATCH:${String(block.version)}`);
        if (block.required_claims !== contractSource.desktop.claims) issues.push(`DESKTOP_CONTRACT_COUNT_MISMATCH:${String(block.required_claims)}`);
        const declaredHash = typeof block.claim_ids_hash === "string" ? block.claim_ids_hash : block.required_ids_hash;
        if (declaredHash !== contractSource.desktop.hash) issues.push("DESKTOP_CONTRACT_HASH_MISMATCH");
      }
    }
    if (issues.length) problems.push(`${gate}: ${[...new Set(issues)].slice(0, 2).join("; ")}`);
    else validated += 1;
  }
  addCheck("gate reports", problems.length ? "FAIL" : "OK",
    problems.length ? [...new Set(problems)].slice(0, 3).join(" | ") : `${evidence.length} reports re-validated against the repository contracts (exact id sets where declared)`,
    `${validated}/${evidence.length} ${problems.length ? `FAIL (${[...new Set(problems)].slice(0, 2).join(" | ")})` : "OK"}${evidenceMode === "ATTESTATION_ONLY" ? " (attestation-level: report bytes not shipped)" : evidenceMode === "PARTIAL" ? " (partial report coverage)" : ""}`);
}

/* ---------------- owner ledger ---------------- */
{
  const problems = [];
  const declared = isObject(certificate.owner_intervention_ledger) ? certificate.owner_intervention_ledger : {};
  const ledgerFile = path.join(options.artifacts, path.basename(String(declared.file || "owner-interventions.json")));
  const read = readJson(ledgerFile);
  if (!read.ok || !isObject(read.value)) {
    problems.push(`the ledger is missing or unreadable (${read.ok ? "not an object" : read.error})`);
  } else {
    const ledger = read.value;
    const fileSha256 = sha256File(ledgerFile);
    if (fileSha256 !== declared.sha256) problems.push(`the ledger file hashes to ${fileSha256.slice(0, 12)}… but the certificate records ${String(declared.sha256).slice(0, 12)}…`);
    if (ledger.schemaVersion !== 1) problems.push(`ledger schemaVersion ${String(ledger.schemaVersion)}`);
    if (ledger.session_id !== certificate.session_id) problems.push(`ledger session ${String(ledger.session_id)} != certificate ${certificate.session_id}`);
    if (ledger.commit_sha !== certificate.commit_sha) problems.push(`ledger commit ${String(ledger.commit_sha).slice(0, 12)}… != certificate commit ${certificate.commit_sha.slice(0, 12)}…`);
    if (!Array.isArray(ledger.events)) problems.push("ledger events is not an array");
    else {
      if (ledger.count !== ledger.events.length) problems.push(`ledger count ${String(ledger.count)} != ${ledger.events.length} event(s)`);
      const ids = new Set();
      ledger.events.forEach((event, index) => {
        if (!isObject(event)) { problems.push(`ledger event ${index} is not an object`); return; }
        for (const field of ["id", "at", "source", "blocker_class", "reason", "requested_action", "outcome"]) {
          if (typeof event[field] !== "string" || event[field].trim() === "") problems.push(`ledger event ${index} is missing ${field}`);
        }
        if (typeof event.at === "string" && Number.isNaN(Date.parse(event.at))) problems.push(`ledger event ${index} has an invalid timestamp`);
        if (typeof event.id === "string") {
          if (ids.has(event.id)) problems.push(`ledger event id ${event.id} is duplicated`);
          ids.add(event.id);
        }
      });
      if (ledger.events.length !== 0) problems.push(`${ledger.events.length} Owner intervention(s) are recorded, which a certificate forbids`);
    }
    const body = { ...ledger };
    delete body.ledger_hash;
    const recomputed = canonicalSha256(body);
    if (ledger.ledger_hash !== recomputed) problems.push(`the ledger digest does not recompute (recorded ${String(ledger.ledger_hash).slice(0, 12)}…, recomputed ${recomputed.slice(0, 12)}…)`);
    if (declared.hash !== ledger.ledger_hash) problems.push("the certificate records a different ledger digest");
    if (declared.events !== ledger.events?.length) problems.push(`the certificate records ${String(declared.events)} event(s) but the ledger holds ${String(ledger.events?.length)}`);
    if (certificate.owner_interventions !== ledger.events?.length) problems.push(`certificate.owner_interventions ${String(certificate.owner_interventions)} != ${String(ledger.events?.length)}`);
  }
  addCheck("owner ledger", problems.length ? "FAIL" : "OK",
    problems.length ? [...new Set(problems)].slice(0, 3).join("; ") : "session and commit bound, count derived from the events, digest recomputed, 0 interventions");
}

/* ---------------- source manifest ---------------- */
{
  const problems = [];
  const sources = Array.isArray(certificate.sources) ? certificate.sources : [];
  let verified = 0;
  for (const source of sources) {
    if (!isObject(source)) { problems.push("a manifest entry is not an object"); continue; }
    const file = path.join(options.artifacts, path.basename(String(source.report || "")));
    const onDisk = sha256File(file);
    const reportKind = ["gate", "desktop", "supporting"].includes(String(source.kind));
    const attestationFile = path.join(options.artifacts, "attestations", `${source.gate}.json`);
    if (onDisk !== "") {
      if (onDisk === source.sha256) verified += 1;
      else problems.push(`${source.gate}: ${path.basename(file)} hashes to ${onDisk.slice(0, 12)}… but the manifest records ${String(source.sha256).slice(0, 12)}… (source hash mismatch)`);
      // The entry binds two files: the report and the attestation that sealed it.
      if (reportBytesVerified && isSha256(source.attestation_sha256)) {
        const attestationSha = sha256File(attestationFile);
        if (attestationSha === "") problems.push(`${source.gate}: its attestation attestations/${source.gate}.json is missing from the bundle`);
        else if (attestationSha !== source.attestation_sha256) {
          problems.push(`${source.gate}: its attestation hashes to ${attestationSha.slice(0, 12)}… but the manifest records ${String(source.attestation_sha256).slice(0, 12)}…`);
        }
      }
      continue;
    }
    if (!reportKind) {
      problems.push(`${source.gate}: the manifest source ${String(source.report)} is missing from the bundle`);
      continue;
    }
    if (reportBytesVerified || evidenceMode === "PARTIAL") {
      problems.push(`${source.gate}: the manifest source ${path.basename(file)} is missing from the bundle`);
      continue;
    }
    // ATTESTATION_ONLY: bind the manifest entry to the shipped attestation.
    const read = readJson(attestationFile);
    if (!read.ok || !isObject(read.value)) { problems.push(`${source.gate}: neither the report nor its attestation is in the bundle`); continue; }
    const binding = [];
    if (read.value.source_sha256 !== source.sha256) binding.push(`its attestation binds source ${String(read.value.source_sha256).slice(0, 12)}…`);
    if (sha256File(attestationFile) !== source.attestation_sha256) binding.push("its attestation bytes do not match the manifest");
    if (binding.length) problems.push(`${source.gate}: ${binding.join("; ")}`);
    else verified += 1;
  }
  const recordRead = readJson(path.join(options.artifacts, path.basename(String(certificate.bootstrap_record?.file || "bootstrap-completion.json"))));
  if (recordRead.ok && isObject(recordRead.value) && Array.isArray(recordRead.value.sources)) {
    for (const source of recordRead.value.sources) {
      const entry = sources.find((candidate) => isObject(candidate) && candidate.gate === source.gate);
      if (!entry) { problems.push(`${String(source.gate)}: the bootstrap record audits a source the manifest omits`); continue; }
      if (entry.sha256 !== source.report_sha256) problems.push(`${String(source.gate)}: the bootstrap record hashes ${String(source.report_sha256).slice(0, 12)}… but the manifest records ${String(entry.sha256).slice(0, 12)}…`);
    }
  }
  for (const entry of Array.isArray(certificate.supporting_evidence) ? certificate.supporting_evidence : []) {
    const manifest = sources.find((candidate) => isObject(candidate) && candidate.gate === entry?.gate);
    if (!manifest) { problems.push(`${String(entry?.gate)}: the supporting evidence has no manifest entry`); continue; }
    if (manifest.sha256 !== entry.report_sha256) problems.push(`${String(entry?.gate)}: the manifest and the supporting evidence disagree about the report hash`);
    if (manifest.attestation_sha256 !== entry.attestation_sha256) problems.push(`${String(entry?.gate)}: the manifest and the supporting evidence disagree about the attestation hash`);
  }
  addCheck("source manifest", problems.length ? "FAIL" : "OK",
    problems.length ? [...new Set(problems)].slice(0, 3).join(" | ") : `${sources.length} manifest entries re-derived from the certificate and ${reportBytesVerified ? "re-hashed from disk" : "bound to their attestations"}`,
    `${verified}/${sources.length} ${problems.length ? `FAIL (${[...new Set(problems)].slice(0, 2).join(" | ")})` : "OK"}${evidenceMode === "ATTESTATION_ONLY" ? " (attestation-bound)" : evidenceMode === "PARTIAL" ? " (partial report coverage)" : ""}`);
}

/* ---------------- bootstrap record ---------------- */
{
  const problems = [];
  const declared = isObject(certificate.bootstrap_record) ? certificate.bootstrap_record : {};
  const recordFile = path.join(options.artifacts, path.basename(String(declared.file || "bootstrap-completion.json")));
  const read = readJson(recordFile);
  if (!read.ok || !isObject(read.value)) {
    problems.push(`the bootstrap record is missing or unreadable (${read.ok ? "not an object" : read.error})`);
  } else {
    const record = read.value;
    if (sha256File(recordFile) !== declared.sha256) problems.push("the bootstrap record file does not hash to the digest the certificate records");
    if (record.root_hash !== declared.root_hash) problems.push(`the record root ${String(record.root_hash).slice(0, 12)}… != certificate ${String(declared.root_hash).slice(0, 12)}…`);
    if (record.session_id !== certificate.session_id) problems.push(`the record session ${String(record.session_id)} != certificate ${certificate.session_id}`);
    if (record.commit_sha !== certificate.commit_sha) problems.push(`the record commit ${String(record.commit_sha).slice(0, 12)}… != certificate commit ${certificate.commit_sha.slice(0, 12)}…`);
    const declaredProblems = Array.isArray(declared.problems) ? declared.problems : [];
    if (declaredProblems.length) problems.push(`the certificate records ${declaredProblems.length} bootstrap record problem(s)`);
    const expected = declaredProblems.length === 0 ? "BOOTSTRAP_COMPLETE" : "INCOMPLETE";
    if (record.decision !== expected) problems.push(`the record decides ${String(record.decision)} where the certificate's own record problems imply ${expected}`);
    if (record.decision !== "BOOTSTRAP_COMPLETE") problems.push(`the record decides ${String(record.decision)}`);
    if (Array.isArray(record.reasons) && record.reasons.length) problems.push(`the record carries ${record.reasons.length} reason(s)`);
    if (record.schemaVersion !== 2) problems.push(`the record schemaVersion is ${String(record.schemaVersion)}`);
    if (record.owner_interventions !== certificate.owner_interventions) problems.push("the record and the certificate disagree about the Owner intervention count");
  }
  addCheck("bootstrap record", problems.length ? "FAIL" : "OK",
    problems.length ? [...new Set(problems)].slice(0, 3).join("; ") : `root ${String(declared.root_hash).slice(0, 12)}… matches, decision BOOTSTRAP_COMPLETE, session and commit bound`);
}

/* ---------------- adversarial acceptance ---------------- */
{
  const problems = [];
  const declared = isObject(certificate.adversarial_acceptance) ? certificate.adversarial_acceptance : {};
  const contract = contractOf("acceptance-adversarial");
  const reportFile = reportFileOf("acceptance-adversarial", contract);
  const read = readJson(reportFile);
  const attestation = (() => {
    const value = readJson(attestationFileOf("acceptance-adversarial"));
    return value.ok ? value.value : undefined;
  })();
  if (!isObject(attestation)) problems.push("the adversarial attestation is missing from the bundle");
  else if (attestation.validation !== "PASS") problems.push(`the adversarial attestation records ${String(attestation.validation)}`);
  if (declared.passed !== true) problems.push("the certificate does not record the adversarial suite as PASS");
  if (declared.false_positive_cases !== 0) problems.push(`false_positive_cases=${String(declared.false_positive_cases)}`);
  const currentReportSha = sha256File(reportFile);
  if (currentReportSha !== "") {
    if (declared.report_sha256 !== currentReportSha) {
      problems.push(`the certificate records adversarial report ${String(declared.report_sha256).slice(0, 12)}… but the file hashes to ${currentReportSha.slice(0, 12)}…`);
    }
  } else {
    // The report bytes are not in this bundle: bind the certificate's claim to the
    // manifest entry and to the attestation instead of accepting it as prose.
    const manifest = manifestOf("acceptance-adversarial");
    if (!manifest || manifest.sha256 !== declared.report_sha256) {
      problems.push(`the certificate records adversarial report ${String(declared.report_sha256).slice(0, 12)}… but its manifest entry records ${String(manifest?.sha256).slice(0, 12)}…`);
    }
    if (isObject(attestation) && attestation.source_sha256 !== declared.report_sha256) {
      problems.push(`the certificate records adversarial report ${String(declared.report_sha256).slice(0, 12)}… but its attestation binds ${String(attestation.source_sha256).slice(0, 12)}…`);
    }
  }
  if (read.ok && isObject(read.value)) {
    if (read.value.false_positive_cases !== 0) problems.push(`the adversarial report records false_positive_cases=${String(read.value.false_positive_cases)}`);
    if (Array.isArray(read.value.false_positive_ids) && read.value.false_positive_ids.length) problems.push(`the adversarial report lists ${read.value.false_positive_ids.length} accepted mutation(s)`);
    if (read.value.positive_control !== "BOOTSTRAP_COMPLETE") problems.push(`the adversarial report's positive control is ${String(read.value.positive_control)}`);
  } else if (reportBytesVerified || evidenceMode === "PARTIAL") {
    problems.push(`the adversarial report ${path.basename(reportFile)} is missing from the bundle`);
  } else {
    note("adversarial acceptance: the report bytes are not in this bundle, so false_positive_cases and positive_control were read from the certificate and its attestation only");
  }
  addCheck("adversarial acceptance", problems.length ? "FAIL" : "OK",
    problems.length ? [...new Set(problems)].slice(0, 3).join("; ") : "attested PASS, 0 false positives, accepted positive control BOOTSTRAP_COMPLETE");
}

/* ---------------- supporting suites ---------------- */
{
  const problems = [];
  let passed = 0;
  for (const gate of supportingRequired) {
    const contract = contractOf(gate);
    const entry = (Array.isArray(certificate.supporting_evidence) ? certificate.supporting_evidence : []).find((candidate) => isObject(candidate) && candidate.gate === gate);
    const issues = [];
    if (!contract) issues.push("the repository declares no contract for this suite");
    if (!entry) issues.push("the certificate carries no supporting evidence entry");
    else {
      if (entry.verdict !== "PASS") issues.push(`verdict ${String(entry.verdict)}`);
      if (Array.isArray(entry.problems) && entry.problems.length) issues.push(`${entry.problems.length} problem(s)`);
      if (contract) {
        if (entry.contract_version !== contract.contract_version) issues.push(`contract version ${String(entry.contract_version)} != ${contract.contract_version}`);
        if (entry.required_ids !== contract.required_ids.length) issues.push(`required_ids ${String(entry.required_ids)} != ${contract.required_ids.length}`);
        if (entry.verified_ids !== contract.required_ids.length) issues.push(`verified_ids ${String(entry.verified_ids)} != ${contract.required_ids.length}`);
        const current = sha256File(reportFileOf(gate, contract));
        if (current !== "" && entry.report_sha256 !== current) issues.push(`report hash ${String(entry.report_sha256).slice(0, 12)}… != ${current.slice(0, 12)}…`);
        const attestationSha = sha256File(attestationFileOf(gate));
        if (attestationSha === "") issues.push("the attestation is missing from the bundle");
        else if (entry.attestation_sha256 !== attestationSha) issues.push(`attestation hash ${String(entry.attestation_sha256).slice(0, 12)}… != ${attestationSha.slice(0, 12)}…`);
      }
    }
    if (issues.length) problems.push(`${gate}: ${[...new Set(issues)].slice(0, 2).join("; ")}`);
    else passed += 1;
  }
  addCheck("supporting suites", problems.length ? "FAIL" : "OK",
    problems.length ? [...new Set(problems)].slice(0, 3).join(" | ") : `${supportingRequired.length} trust-boundary suites attested, verified and PASS`,
    `${passed}/${supportingRequired.length} ${problems.length ? `FAIL (${[...new Set(problems)].slice(0, 2).join(" | ")})` : "OK"}`);
}

/* ---------------- verdict ---------------- */
{
  if (evidenceMode === "ATTESTATION_ONLY" && options.strictReports) {
    const check = checks.find((entry) => entry.name === "source manifest");
    check.verdict = "FAIL";
    check.detail = "the bundle ships none of its gate report files and --strict-reports was passed";
    check.display = `FAIL (${check.detail})`;
    note("strict reports: the bundle ships none of its gate report files");
  }
  const blocking = checks.filter((entry) => entry.verdict === "FAIL" || (entry.verdict === "NOT_CHECKED" && !options.allowNoGit));
  const valid = blocking.length === 0;
  addCheck("verdict", valid ? "OK" : "FAIL", valid ? "VALID_CERTIFICATE" : "INVALID_CERTIFICATE",
    valid ? "VALID_CERTIFICATE" : "INVALID_CERTIFICATE");
}

finish();

function finish() {
  const lines = [];
  for (const check of checks) lines.push(`[verify] ${check.name.padEnd(29)} ${check.display}`);
  for (const check of checks) {
    if (check.verdict === "FAIL" && check.name !== "verdict") lines.push(`[verify] note ${check.name}: ${check.detail}`);
  }
  for (const text of notes) lines.push(`[verify] note ${text}`);
  const verdict = checks.find((entry) => entry.name === "verdict");
  const valid = verdict.verdict === "OK";
  const verdictJson = {
    verified: valid,
    checks: checks.map((entry) => ({ name: entry.name, verdict: entry.verdict, detail: entry.detail })),
    certificate_sha256: certificateSha256,
    root_hash: isObject(certificate) ? String(certificate.root_hash ?? "") : "",
    commit_sha: isObject(certificate) ? String(certificate.commit_sha ?? "") : "",
    tree_sha: isObject(certificate) ? String(certificate.tree_sha ?? "") : "",
    evidence_mode: evidenceMode,
    notes
  };
  for (const line of lines) console.log(line);
  console.log(`[verify] ${valid ? "CERTIFICATE_VALID" : "INVALID_CERTIFICATE"}`);
  const text = `${JSON.stringify(verdictJson, null, 2)}\n`;
  if (options.out !== "") {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(options.out, text, "utf8");
  }
  if (options.json) process.stdout.write(text);
  process.exit(valid ? 0 : 1);
}
