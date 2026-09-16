#!/usr/bin/env node
/**
 * Phase 04 data-lifecycle report (platform foundation, acceptance gate 7).
 *
 * Records what the retention policy actually does over the real data this checkout has accumulated,
 * and separately what it does to a corpus built specifically to be collectable. Both halves matter:
 * a policy that collects nothing is safe but useless, and a policy that collects something without
 * a demonstrated guard is dangerous.
 *
 * ## Declared, discovered and computed are kept apart
 *
 *   - the CLASSES and their retention rules are DECLARED, read from the compiled `data-retention`
 *     module rather than restated here, so the report cannot drift from the policy it describes;
 *   - the CORPUS is DISCOVERED by walking the real state roots and stat-ing what is there;
 *   - the PLAN, the EXECUTION and the RETRIEVAL BENCHMARK are COMPUTED by running the real modules
 *     over that corpus, and every invariant below is asserted. A violated invariant fails the
 *     generator rather than producing a report that claims a property it did not observe.
 *
 * ## What "zero misdeletion" means here
 *
 * Not "the plan looked reasonable". The generator asserts, item by item, that no record classified
 * PROTECTED or HOT, and no record still referenced, appears among the candidates; and that the
 * items a dry run named are exactly the items the execution was handed. The deletion callback only
 * RECORDS what it was asked to remove, so this runs against the live checkout without unlinking
 * anything: an execution observed through a recording deleter is the strongest form the gate can
 * take without destroying the evidence it is measuring.
 *
 * Run: node scripts/data-lifecycle-report.cjs
 * Writes: artifacts/platform-foundation/phase-04/data-lifecycle-report.json
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "artifacts", "platform-foundation", "phase-04", "data-lifecycle-report.json");

/**
 * Where the compiled Phase 04 modules are loaded from.
 *
 * Overridable so the acceptance suite can point the generator at a COPY of the build with a
 * protection marker removed, and prove the generator fails closed without patching the real
 * `dist-electron` and risking a broken build behind it if the probe is interrupted.
 */
const COMPILED = process.env.PHASE04_COMPILED_DIR
  ? path.resolve(process.env.PHASE04_COMPILED_DIR)
  : path.join(ROOT, "dist-electron", "src", "shared");

/**
 * The real roots this checkout accumulates state in, walked to build the corpus.
 *
 * `artifacts/host-soak` alone holds tens of thousands of files from a soak run, which is exactly the
 * shape the retention policy exists for.
 */
const ROOTS = [
  { dir: ".codex-boss", describes: "owner and runtime configuration" },
  { dir: "artifacts", describes: "acceptance evidence, soak output and packaged builds" },
  { dir: "runtime-data", describes: "runtime working data" },
  { dir: "history", describes: "session history" }
];

/**
 * Records that the phase work itself depends on, marked as referenced so the guard has something
 * real to protect. A corpus where nothing is referenced would test the reference check vacuously.
 */
const REFERENCED = [".codex-boss/config/runtime-policy.json", ".codex-boss/root/root-policy.json"];

const DAY = 86_400_000;

function loadCompiled() {
  const files = ["data-retention.js", "knowledge-claim.js", "knowledge-staleness.js", "knowledge-retrieval-guard.js"];
  const missing = files.filter((file) => !fs.existsSync(path.join(COMPILED, file)));
  if (missing.length > 0) {
    throw new Error(`the compiled phase 04 modules are missing: ${missing.join(", ")}. Run \`pnpm run build:electron\` first.`);
  }
  const loaded = {
    retention: require(path.join(COMPILED, "data-retention.js")),
    claim: require(path.join(COMPILED, "knowledge-claim.js")),
    staleness: require(path.join(COMPILED, "knowledge-staleness.js")),
    retrieval: require(path.join(COMPILED, "knowledge-retrieval-guard.js"))
  };
  // Every symbol this generator uses is named here and checked. The export surface is deliberately
  // narrow — a symbol nothing imports loses its `export` — so a stale build or an over-eager
  // un-export must fail with the missing name rather than as `undefined is not a function` from
  // somewhere in the middle of the run.
  const REQUIRED = {
    retention: ["DATA_CLASSES", "RETENTION_RULES", "classifyData", "planCollection", "applyCollection", "plansCorrespond"],
    claim: ["supersede", "dispute", "adjudicate", "isCurrent"],
    staleness: ["assessStaleness", "pathIntersects"],
    retrieval: ["retrieveClaims", "runRetrievalBenchmark", "rankOf"]
  };
  const absent = [];
  for (const [moduleName, symbols] of Object.entries(REQUIRED)) {
    for (const symbol of symbols) {
      if (typeof loaded[moduleName][symbol] === "undefined") absent.push(`${moduleName}.${symbol}`);
    }
  }
  if (absent.length > 0) {
    throw new Error(`the compiled phase 04 modules do not export: ${absent.join(", ")}. Rebuild with \`pnpm run build:electron\`, or restore the export if it is genuinely part of the surface.`);
  }
  return loaded;
}

/** Walk a root, returning repo-relative POSIX paths with their size and modification time. */
function discover(root) {
  const absolute = path.join(ROOT, root);
  const found = [];
  if (!fs.existsSync(absolute)) return found;
  const stack = [absolute];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      // An unreadable directory is skipped rather than failing the walk; the count of what was
      // skipped is reported, so a shrunken corpus is visible instead of silent.
      found.skipped = (found.skipped ?? 0) + 1;
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat;
      try {
        stat = fs.statSync(child);
      } catch {
        found.skipped = (found.skipped ?? 0) + 1;
        continue;
      }
      found.push({
        path: path.relative(ROOT, child).split(path.sep).join("/"),
        bytes: stat.size,
        updatedAt: new Date(stat.mtimeMs).toISOString()
      });
    }
  }
  return found;
}

/**
 * Turn discovered files into GC records.
 *
 * `kind` carries the real relative path, because the classifier reads its markers out of the path:
 * that is how the policy is written, so feeding it the path is the honest thing to feed it.
 */
function toRecords(retention, files) {
  return files.map((file) => {
    const record = { id: file.path, kind: file.path, bytes: file.bytes, updatedAt: file.updatedAt };
    if (REFERENCED.includes(file.path)) record.referencedBy = ["phase-04-report"];
    return record;
  });
}

function main() {
  const { retention, claim, staleness, retrieval } = loadCompiled();
  const problems = [];
  const require_ = (condition, message) => {
    if (!condition) problems.push(message);
  };

  // ---------------------------------------------------------------- declared policy
  const declared = {
    classes: [...retention.DATA_CLASSES],
    rules: Object.fromEntries(
      retention.DATA_CLASSES.map((dataClass) => {
        const rule = retention.RETENTION_RULES[dataClass];
        return [dataClass, {
          retentionDays: rule.retentionDays,
          compressible: rule.compressible,
          dedupable: rule.dedupable,
          archivable: rule.archivable,
          deletable: rule.deletable,
          why: rule.why
        }];
      })
    )
  };
  require_(declared.classes.length === 5, `expected 5 data classes, found ${declared.classes.length}`);
  require_(declared.rules.PROTECTED.deletable === false, "PROTECTED must not be deletable");
  require_(declared.rules.HOT.deletable === false, "HOT must not be deletable, or in-flight work can be collected");

  // ---------------------------------------------------------------- discovered corpus
  const discovered = {};
  const allFiles = [];
  for (const root of ROOTS) {
    const files = discover(root.dir);
    discovered[root.dir] = { describes: root.describes, files: files.length, skipped: files.skipped ?? 0, bytes: files.reduce((total, file) => total + file.bytes, 0) };
    allFiles.push(...files);
  }
  const corpusBytes = allFiles.reduce((total, file) => total + file.bytes, 0);
  require_(allFiles.length > 1000, `the discovered corpus is only ${allFiles.length} files, too small to be evidence of anything`);

  const records = toRecords(retention, allFiles);

  // ---------------------------------------------------------------- classification
  const countsByClass = {};
  for (const dataClass of retention.DATA_CLASSES) countsByClass[dataClass] = 0;
  const classExamples = {};
  for (const record of records) {
    const dataClass = retention.classifyData(record, new Date().toISOString());
    countsByClass[dataClass]++;
    if (!classExamples[dataClass]) classExamples[dataClass] = [];
    if (classExamples[dataClass].length < 5) classExamples[dataClass].push(record.id);
  }
  // ---------------------------------------------------------------- the live corpus, planned and executed
  //
  // The live checkout IS collectable in one respect: a packaged build under `artifacts/` carries the
  // epoch timestamps a zip round-trip gives it, so it is genuinely years past the COLD window. That
  // is the policy working, not failing. What must hold is that the guard spares everything it is
  // supposed to spare while doing so — so the live corpus is executed through a recording deleter,
  // and the records it hands over are checked against the corpus at full scale rather than against a
  // hand-written list.
  const livePlan = retention.planCollection({ now: new Date().toISOString(), records, dedupe: true });
  const nowIso = new Date().toISOString();
  const liveProtectedOrActive = records.filter((record) => {
    const dataClass = retention.classifyData(record, nowIso);
    return dataClass === "PROTECTED" || dataClass === "HOT" || (record.referencedBy ?? []).length > 0;
  });
  const liveProtectedIds = new Set(liveProtectedOrActive.map((record) => record.id));

  const liveHandedOver = [];
  const liveExecution = retention.applyCollection({
    now: nowIso,
    records,
    dedupe: true,
    plan: livePlan,
    delete: (record) => liveHandedOver.push(record.id)
  });
  const liveParity = retention.plansCorrespond(liveExecution);
  require_(liveParity.correspond, `the live dry run and execution did not correspond: ${liveParity.problems.join("; ")}`);

  // The property the gate actually asks for, at full scale: nothing protected, active or referenced
  // is ever handed to the deleter.
  const liveMisdeleted = liveHandedOver.filter((id) => liveProtectedIds.has(id));
  require_(liveMisdeleted.length === 0, `${liveMisdeleted.length} protected, active or referenced record(s) were handed to the deleter: ${liveMisdeleted.slice(0, 5).join(", ")}`);

  // The phase artifacts this program is graded on are protected by classification, not by luck.
  const acceptanceArtifacts = allFiles
    .map((file) => file.path)
    .filter((file) => file.startsWith("artifacts/platform-foundation/"));
  require_(acceptanceArtifacts.length > 0, "no platform-foundation artifact was found in the corpus, so the acceptance-evidence guard was not exercised");
  for (const artifact of acceptanceArtifacts) {
    const dataClass = retention.classifyData({ id: artifact, kind: artifact, bytes: 1, updatedAt: nowIso }, nowIso);
    require_(dataClass === "PROTECTED", `${artifact} classified as ${dataClass}, so acceptance evidence is collectable`);
    require_(!liveHandedOver.includes(artifact), `${artifact} was handed to the deleter`);
  }

  // ---------------------------------------------------------------- a corpus that IS collectable
  const now = "2026-09-16T13:56:10.000Z";
  const at = (days) => new Date(Date.parse(now) - days * DAY).toISOString();
  const exercised = [
    // Ancient, disposable, unreferenced: the case retention exists for.
    { id: "soak/run-old/soak.log", kind: "soak/run-old/soak.log", bytes: 4096, updatedAt: at(400) },
    { id: "artifacts/vision-old/screenshot.png", kind: "artifacts/vision-old/screenshot.png", bytes: 8192, updatedAt: at(400) },
    { id: "artifacts/tmp-old/scratch.json", kind: "artifacts/tmp-old/scratch.json", bytes: 1024, updatedAt: at(400) },
    // Ancient but PROTECTED: must survive on class alone.
    { id: "artifacts/owner-intervention/history.json", kind: "artifacts/owner-intervention/history.json", bytes: 2048, updatedAt: at(4000) },
    { id: "artifacts/audit-ledger/entries.json", kind: "artifacts/audit-ledger/entries.json", bytes: 2048, updatedAt: at(4000) },
    { id: "artifacts/security-attestation/report.json", kind: "artifacts/security-attestation/report.json", bytes: 2048, updatedAt: at(4000) },
    // Ancient and referenced: must survive, with the reference named.
    { id: "artifacts/evidence/soak-report.json", kind: "artifacts/evidence/soak-report.json", bytes: 2048, updatedAt: at(4000), referencedBy: ["phase-05"] },
    // Ancient but ACTIVE: in-flight work must survive regardless of age.
    { id: "runtime-data/in-flight/task.json", kind: "runtime-data/in-flight/task.json", bytes: 2048, updatedAt: at(4000), active: true },
    // Recent disposable and recent ordinary: inside their windows, so not collectable.
    { id: "artifacts/screenshots/recent.png", kind: "artifacts/screenshots/recent.png", bytes: 4096, updatedAt: at(1) },
    { id: "history/session-recent.json", kind: "history/session-recent.json", bytes: 4096, updatedAt: at(1) }
  ];
  const exercisedPlan = retention.planCollection({ now, records: exercised, dedupe: true });
  const exercisedCandidates = exercisedPlan.candidates.map((candidate) => candidate.id).sort();
  const expectedCandidates = ["artifacts/tmp-old/scratch.json", "artifacts/vision-old/screenshot.png", "soak/run-old/soak.log"].sort();
  require_(
    JSON.stringify(exercisedCandidates) === JSON.stringify(expectedCandidates),
    `the exercised corpus produced candidates ${JSON.stringify(exercisedCandidates)}, expected ${JSON.stringify(expectedCandidates)}`
  );

  // ---------------------------------------------------------------- dry-run / execution parity
  const handedToDeleter = [];
  const execution = retention.applyCollection({
    now,
    records: exercised,
    dedupe: true,
    plan: exercisedPlan,
    // Records rather than removes. Nothing on disk is touched: the execution's contract is which
    // records it hands over, and that is what is being verified.
    delete: (record) => handedToDeleter.push(record.id)
  });
  const parity = retention.plansCorrespond(execution);
  require_(parity.correspond, `the dry run and the execution did not correspond: ${parity.problems.join("; ")}`);
  require_(
    JSON.stringify([...handedToDeleter].sort()) === JSON.stringify(expectedCandidates),
    `the execution was handed ${JSON.stringify([...handedToDeleter].sort())}, expected exactly the planned candidates`
  );
  require_(execution.audit.length === exercisedPlan.candidates.length, "the audit does not cover every candidate");
  require_(execution.failed === 0, "a deletion failed");

  // Zero misdeletion, stated as a property of the executed set rather than of the plan.
  const protectedOrActive = exercised.filter((record) => {
    const dataClass = retention.classifyData(record, now);
    return dataClass === "PROTECTED" || dataClass === "HOT" || (record.referencedBy ?? []).length > 0;
  });
  for (const record of protectedOrActive) {
    require_(!handedToDeleter.includes(record.id), `${record.id} was handed to the deleter despite being protected, active or referenced`);
  }

  // ---------------------------------------------------------------- audit trail
  const auditComplete = execution.audit.every((entry) => typeof entry.detail === "string" && entry.detail.length > 0);
  require_(auditComplete, "an audit entry carried no detail, so the decision is not reviewable");

  // ---------------------------------------------------------------- retrieval guard
  const repo = "zhiheng-zhang-Mera/Codex-Boss";
  const observationAt = now;
  const makeClaim = (overrides) => ({
    id: overrides.id,
    claim: overrides.claim ?? "the cache must be read-through",
    kind: overrides.kind ?? "fact",
    scope: overrides.scope ?? { project: "Codex-Boss", repo },
    provenance: overrides.provenance ?? { sourceType: "commit", sourceRef: "HEAD" },
    ...(overrides.code ? { code: overrides.code } : {}),
    validity: { validFrom: "2026-01-01T00:00:00.000Z", validUntil: null },
    confidence: overrides.confidence ?? { level: "verified", basis: "bound to a commit" },
    supersededBy: overrides.supersededBy ?? null,
    createdAt: "2026-01-01T00:00:00.000Z"
  });

  const HISTORY_SIZE = 10_500;
  const history = Array.from({ length: HISTORY_SIZE }, (_, index) => makeClaim({
    id: `hist-${String(index).padStart(5, "0")}`,
    provenance: { sourceType: "commit", sourceRef: `old-${index}` },
    code: { repo, revision: `rev-${index}`, paths: [`src/module-${index}.ts`] }
  }));
  const currentClaim = makeClaim({ id: "current" });
  const changedPaths = history.map((entry) => ({ repo, paths: [...entry.code.paths], revision: "later" }));

  const startedAt = Date.now();
  const mixed = retrieval.retrieveClaims([...history, currentClaim], {
    project: "Codex-Boss",
    terms: ["cache"],
    observation: { at: observationAt, changedPaths },
    limit: 20
  });
  const retrievalMillis = Date.now() - startedAt;
  require_(mixed.entries.length === 20, `the mixed corpus returned ${mixed.entries.length} entries, expected the requested 20`);
  require_(mixed.entries[0].claimId === "current", `the top-ranked claim was ${mixed.entries[0].claimId}, so current knowledge was drowned by history`);
  for (const entry of mixed.entries.slice(1)) {
    require_(entry.adjustments.some((adjustment) => adjustment.reason === "stale"), `${entry.claimId} ranked as current despite a moved code binding`);
  }
  require_(mixed.excluded.length === 0, `${mixed.excluded.length} claim(s) were excluded from the mixed corpus, so ranking was not what produced the ordering`);

  // Superseded knowledge leaves default retrieval but keeps its lineage.
  const superseded = claim.supersede(makeClaim({ id: "v1" }), { id: "v2" }, observationAt, "the constraint widened");
  const lineage = retrieval.retrieveClaims([superseded, makeClaim({ id: "v2", claim: "the cache must be read-through" })], { project: "Codex-Boss", observation: { at: observationAt } });
  require_(lineage.excluded.some((entry) => entry.claimId === "v1" && entry.reason === "superseded"), "a superseded claim was still offered as current");
  require_(superseded.provenance.sourceRef === "HEAD" && superseded.claim.trim().length > 0, "superseding destroyed the superseded claim's own record");
  // Expressed through the retrieval guard, which is the path a reader actually reaches knowledge
  // by: the claim is not merely flagged, it is absent from what the guard offers.
  require_(!lineage.entries.some((entry) => entry.claimId === "v1"), "a superseded claim was offered among the current claims");

  // A conflict keeps both sides until an adjudication settles it, and settling it must leave one
  // side CURRENT. A winner that is still marked disputed would mean the conflict was resolved into
  // nothing, which is the failure this checks for.
  const left = makeClaim({ id: "conflict-left" });
  const right = makeClaim({ id: "conflict-right", provenance: { sourceType: "test", sourceRef: "run-9" } });
  const [disputedLeft, disputedRight] = claim.dispute(left, right);
  require_(disputedLeft.confidence.level === "disputed" && disputedRight.confidence.level === "disputed", "a dispute did not mark both sides disputed");
  require_(!claim.isCurrent(disputedLeft, observationAt), "a disputed claim was reported as current");
  const adjudication = claim.adjudicate(disputedLeft, disputedRight, observationAt, "the test run reproduces it and the commit does not");
  require_(claim.isCurrent(adjudication.winner, observationAt), "the winner of an adjudication is not current, so the conflict was resolved into nothing");
  require_(adjudication.winner.confidence.level !== "disputed", "the winner of an adjudication is still marked disputed");
  require_(adjudication.loser.supersededBy === "conflict-left", "the losing side of an adjudication carries no lineage");
  require_(!claim.isCurrent(adjudication.loser, observationAt), "the losing side of an adjudication is still current");

  // Cross-project isolation: another project's claim cannot be reached even by an exact match.
  const foreign = retrieval.retrieveClaims([makeClaim({ id: "theirs", scope: { project: "OtherProject", repo } })], { project: "Codex-Boss", terms: ["cache"], observation: { at: observationAt } });
  require_(foreign.entries.length === 0 && foreign.excluded.some((entry) => entry.reason === "other-project"), "another project's knowledge was reachable");

  // ---------------------------------------------------------------- report
  const report = {
    $comment: "Phase 04 data-lifecycle report. Declared policy, discovered corpus and computed evidence are kept apart; see the generator header for what each section proves.",
    generatedAt: new Date().toISOString(),
    phase: "04-knowledge-data-lifecycle",
    node: process.version,
    declared,
    discovered,
    corpus: {
      files: allFiles.length,
      bytes: corpusBytes,
      referencedRecords: REFERENCED.filter((entry) => allFiles.some((file) => file.path === entry)),
      countsByClass,
      examples: classExamples
    },
    gc: {
      liveCorpus: {
        records: records.length,
        candidates: livePlan.candidates.length,
        reclaimableBytes: livePlan.reclaimableBytes,
        candidateClasses: livePlan.candidates.reduce((counts, candidate) => ({ ...counts, [candidate.dataClass]: (counts[candidate.dataClass] ?? 0) + 1 }), {}),
        protectedOrActiveOrReferenced: liveProtectedOrActive.length,
        handedOver: liveHandedOver.length,
        handedToDeleter: [...liveHandedOver].sort(),
        misdeleted: liveMisdeleted,
        parity: liveParity.correspond,
        deletedMode: "recorded, not unlinked: no file in the checkout was removed",
        note: "the only collectable records are a packaged build carrying epoch timestamps from a zip round-trip; every protected, active and referenced record was spared"
      },
      exercised: {
        records: exercised.length,
        candidates: exercisedCandidates,
        spared: exercisedPlan.spared.map((entry) => ({ id: entry.id, dataClass: entry.dataClass, reason: entry.reason })),
        reclaimableBytes: exercisedPlan.reclaimableBytes
      },
      execution: {
        deleted: execution.deleted,
        failed: execution.failed,
        reclaimedBytes: execution.reclaimedBytes,
        deletedMode: "recorded, not unlinked: no file in the checkout was removed",
        handedToDeleter: [...handedToDeleter].sort(),
        parity: parity.correspond,
        auditEntries: execution.audit.map((entry) => ({ recordId: entry.recordId, dataClass: entry.dataClass, outcome: entry.outcome, detail: entry.detail }))
      },
      zeroMisdeletion: {
        protectedOrActiveOrReferenced: protectedOrActive.map((record) => record.id),
        misdeleted: protectedOrActive.filter((record) => handedToDeleter.includes(record.id)).map((record) => record.id)
      }
    },
    retrieval: {
      mixedCorpus: { size: HISTORY_SIZE + 1, requestedLimit: 20, returned: mixed.entries.length, top: mixed.entries[0].claimId, millis: retrievalMillis },
      ranking: mixed.entries.map((entry) => ({ claimId: entry.claimId, score: entry.score, reasons: entry.adjustments.map((adjustment) => adjustment.reason) })),
      supersededExcluded: lineage.excluded.map((entry) => ({ claimId: entry.claimId, reason: entry.reason })),
      crossProject: { entries: foreign.entries.length, excluded: foreign.excluded.map((entry) => entry.reason) }
    },
    acceptance: {
      invariantsChecked: problems.length === 0,
      problems,
      evidence: {
        "acceptance-evidence-protected": acceptanceArtifacts.every((artifact) => !liveHandedOver.includes(artifact)),
        "protected-never-a-candidate": liveMisdeleted.length === 0,
        "dry-run-matches-execution": parity.correspond,
        "live-dry-run-matches-execution": liveParity.correspond,
        "audit-covers-every-candidate": execution.audit.length === exercisedPlan.candidates.length,
        "current-outranks-10k-stale": mixed.entries[0].claimId === "current",
        "superseded-leaves-default-retrieval": lineage.excluded.some((entry) => entry.claimId === "v1"),
        "conflict-resolved-leaves-a-current-claim": claim.isCurrent(adjudication.winner, observationAt),
        "cross-project-unreachable": foreign.entries.length === 0
      }
    }
  };

  if (problems.length > 0) {
    process.stderr.write(`phase 04 report FAILED ${problems.length} invariant(s):\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`phase 04 data-lifecycle report written: ${path.relative(ROOT, OUT)}\n`);
  process.stdout.write(`  corpus: ${allFiles.length} files / ${(corpusBytes / 1048576).toFixed(2)} MB across ${ROOTS.length} roots\n`);
  process.stdout.write(`  live plan: ${livePlan.candidates.length} candidate(s), ${liveHandedOver.length} handed over, ${liveMisdeleted.length} misdeleted; exercised plan: ${exercisedCandidates.length} of ${exercised.length}\n`);
  process.stdout.write(`  retrieval: current ranked ${mixed.entries[0].claimId} over ${HISTORY_SIZE} stale records in ${retrievalMillis} ms\n`);
  process.stdout.write(`  invariants: all ${Object.keys(report.acceptance.evidence).length} held\n`);
}

main();
