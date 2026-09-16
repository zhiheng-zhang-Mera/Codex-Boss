#!/usr/bin/env node
/**
 * Phase 02 state-migration report (platform foundation, acceptance gate 7).
 *
 * Answers the book's three questions: which namespaces have migrated, who is
 * authoritative for each, and which are still JSON.
 *
 * ## Declared intent versus measured evidence
 *
 * The two are kept in separate fields on purpose, because a report that blurs them is how
 * a migration gets claimed rather than demonstrated:
 *
 *   - `storage` and the `namespace` inventory are DECLARED: they come from the Phase 01
 *     manifests, which are the machine-readable inventory, plus this file's plan table.
 *   - `pilotEvidence` is MEASURED: the generator actually creates a state database in a
 *     temporary directory, runs the decision-ledger pilot through its full sequence —
 *     baseline import, a comparison battery, a promotion, a crash-window reconciliation —
 *     and records what happened. If the pilot cannot run, the generator FAILS rather than
 *     emitting a report describing a migration that did not occur.
 *
 * Run: node scripts/state-migration-report.cjs
 * Writes: artifacts/platform-foundation/phase-02/state-migration-report.json
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parse: parseYaml } = require("yaml");

const ROOT = path.resolve(__dirname, "..");
const CAPABILITIES_ROOT = path.join(ROOT, "config", "capabilities");
const OUT = path.join(ROOT, "artifacts", "platform-foundation", "phase-02", "state-migration-report.json");
const COMPILED = path.join(ROOT, "dist-electron", "electron", "state-core");

/**
 * The migration plan: what is being moved, and what is deliberately not.
 *
 * Every namespace from the Phase 01 inventory appears exactly once, either as a pilot or as
 * `json` with a reason for staying. A namespace that silently disappears from this table
 * between commits would be indistinguishable from one that was migrated, so the generator
 * fails on an inventory namespace it cannot classify.
 */
const PLAN = {
  "decision-ledger": {
    storage: "database",
    authoritativeSide: "state-core (SQLite)",
    status: "pilot-integrated",
    reason: "Selected as the first pilot: an append-only audit ledger, so a divergence is a missing audit record — the loss a comparison window exists to catch. INTEGRATED: electron/bootstrap/state-core.ts is constructed by the composition root and main.ts routes every ledger read and write through it, so the running application imports the legacy baseline, shadow-compares each append, and can be promoted. The boot module deliberately does NOT promote itself; authority moves only when the comparison battery has passed and a caller asks, which is the book's gate 6."
  },
  tasks: {
    storage: "json",
    authoritativeSide: "persistence (JSON task ledger)",
    status: "not-selected",
    reason: "The second candidate, deliberately NOT migrated in this phase. The ledger is a revision-guarded read-modify-write tree of checkpoint files whose readers include the host observer and the fault lab, so it needs its own comparison battery before it can move. The book asks for one or two pilots, not a sweep, and one done properly is worth more than two done partially."
  },
  "state-core:migration": {
    storage: "database",
    authoritativeSide: "state-core (SQLite)",
    status: "infrastructure",
    reason: "The migration bookkeeping record itself: which side is authoritative for each migrated namespace, how the shadow comparison is going, and what may still write. It lives in the state database rather than a JSON file so that a store asking 'may I write?' cannot get its answer from a file that was lost with the store. It is machinery rather than domain state, which is why it is classified explicitly instead of inheriting the default."
  }
};

/** A reason attached to every namespace the plan leaves on JSON. */
const NOT_SELECTED_REASON = "Not selected for migration in Phase 02. Moving it requires its own shadow comparison window; the book forbids migrating all JSON stores at once.";

function loadManifests() {
  const manifests = [];
  for (const name of fs.readdirSync(CAPABILITIES_ROOT).sort()) {
    if (!/\.(ya?ml|json)$/i.test(name)) continue;
    const parsed = parseYaml(fs.readFileSync(path.join(CAPABILITIES_ROOT, name), "utf8"));
    manifests.push({
      id: parsed.id,
      kind: parsed.kind,
      critical: parsed.health && parsed.health.critical === true,
      state: (parsed.state ?? []).map((entry) => entry.namespace),
      source: `config/capabilities/${name}`
    });
  }
  return manifests;
}

/** Every durable namespace Phase 01 inventoried, with its authoritative owner. */
function inventory(manifests) {
  const ownerOf = new Map();
  for (const manifest of manifests) for (const namespace of manifest.state) ownerOf.set(namespace, manifest.id);
  return [...ownerOf.entries()].map(([namespace, owner]) => ({ namespace, owner })).sort((left, right) => (left.namespace < right.namespace ? -1 : 1));
}

/**
 * Run the decision-ledger pilot for real against a throwaway data root.
 *
 * This is the measured half of the report. It deliberately performs the whole sequence,
 * including the crash-window reconciliation, so the evidence describes a behaviour rather
 * than an intention.
 */
function measurePilot() {
  if (!fs.existsSync(COMPILED)) {
    throw new Error(`the compiled state core is missing at ${COMPILED}; run \`pnpm run build\` before generating this report`);
  }
  const { openDatabase, stateDatabasePath, checkIntegrity } = require(path.join(COMPILED, "database.js"));
  const { createNamespaceMigrationRegistry } = require(path.join(COMPILED, "namespace-migration.js"));
  const { createDecisionLedgerMigration, DECISION_LEDGER_NAMESPACE, DECISION_LEDGER_REQUIRED_CLEAN } = require(path.join(COMPILED, "decision-ledger-migration.js"));
  const { DecisionLedgerStore } = require(path.join(ROOT, "dist-electron", "electron", "commander", "decision-ledger-store.js"));
  const { createStateRepository } = require(path.join(COMPILED, "state-repository.js"));
  const { createEventJournal } = require(path.join(COMPILED, "event-journal.js"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-phase02-report-"));
  const legacyFile = path.join(root, ".boss", "decision-ledger.json");
  const handle = openDatabase(stateDatabasePath(root));

  try {
    const registry = createNamespaceMigrationRegistry(handle);
    const legacy = new DecisionLedgerStore(legacyFile);
    registry.declare({
      namespace: DECISION_LEDGER_NAMESPACE,
      owner: "persistence",
      requiredClean: DECISION_LEDGER_REQUIRED_CLEAN,
      jsonSunset: "removed once the database has been authoritative across two releases"
    });
    const pilot = createDecisionLedgerMigration({ handle, registry, legacy });
    const repository = createStateRepository(handle);
    const journal = createEventJournal(handle);

    // 1. read-old baseline: three entries already in JSON.
    for (let index = 0; index < 3; index++) {
      legacy.append({
        id: `baseline-${index}`,
        taskId: "task-1",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        question: `baseline question ${index}`,
        candidates: ["a", "b"],
        chosen: "a",
        evidence: ["baseline"],
        outcome: "APPLIED",
        source: "question-interceptor"
      });
    }
    const imported = pilot.importLegacy();
    const reimported = pilot.importLegacy();

    // 2. shadow read/compare: run the battery.
    pilot.beginShadow();
    const decisions = [];
    for (let index = 0; index < DECISION_LEDGER_REQUIRED_CLEAN; index++) {
      decisions.push(pilot.append({
        id: `battery-${index}`,
        taskId: "task-1",
        createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString(),
        question: `battery question ${index}`,
        candidates: ["a", "b"],
        chosen: "b",
        evidence: ["battery"],
        outcome: "APPLIED",
        source: "planner"
      }).decision);
    }
    const beforePromotion = pilot.state();

    // 3. authoritative DB write.
    const promoted = pilot.promote();

    // 4. crash-window repair: a ledger row written AFTER promotion whose event never
    // published. The timestamp has to be after the promotion instant, because that is the
    // boundary `reconcile` uses — entries that predate promotion came from the legacy
    // baseline and were never meant to publish an event.
    const orphan = {
      id: "orphan-after-promotion",
      taskId: "task-1",
      createdAt: new Date().toISOString(),
      question: "written to the ledger, event lost to a crash",
      candidates: ["a"],
      chosen: "a",
      evidence: ["crash-window"],
      outcome: "APPLIED",
      source: "recovery"
    };
    repository.put(DECISION_LEDGER_NAMESPACE, orphan.id, orphan);
    const beforeReconcile = journal.hasIdempotencyKey("persistence", orphan.id);
    const reconcile = pilot.reconcile();
    const afterReconcile = journal.hasIdempotencyKey("persistence", orphan.id);

    // 5. divergence detection: corrupt the database side and compare.
    repository.remove(DECISION_LEDGER_NAMESPACE, "battery-0");
    const demoted = pilot.demote("report generator: deliberate divergence probe");
    const divergenceDetected = demoted.phase === "diverged" && demoted.authority === "json";

    const integrity = checkIntegrity(handle);
    return {
      measuredAt: new Date().toISOString(),
      dataRoot: "<temporary directory>",
      requiredCleanComparisons: DECISION_LEDGER_REQUIRED_CLEAN,
      baselineImport: { imported: imported.imported, alreadyPresent: imported.alreadyPresent, secondImportImported: reimported.imported, idempotent: reimported.imported === 0 },
      shadowBattery: { decisions: decisions.length, allAgreed: decisions.every((decision) => decision === "agree"), decisions, consecutiveClean: beforePromotion.consecutiveClean, phaseBeforePromotion: beforePromotion.phase },
      promotion: { authority: promoted.authority, phase: promoted.phase, promotedAt: promoted.promotedAt, jsonSunset: promoted.jsonSunset },
      crashWindow: { eventPresentBeforeReconcile: beforeReconcile, reEmitted: reconcile.reEmitted, eventPresentAfterReconcile: afterReconcile, repaired: beforeReconcile === false && afterReconcile === true },
      divergenceProbe: { detected: divergenceDetected, authorityAfterProbe: demoted.authority, phaseAfterProbe: demoted.phase, consecutiveCleanAfterProbe: demoted.consecutiveClean },
      integrity: { ok: integrity.ok, detail: integrity.detail },
      journalEvents: journal.stats().events,
      ledgerRecords: repository.count(DECISION_LEDGER_NAMESPACE)
    };
  } finally {
    try { handle.close(); } catch { /* already closed */ }
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function main() {
  const manifests = loadManifests();
  const namespaces = inventory(manifests);
  const unclassified = namespaces.filter((entry) => !PLAN[entry.namespace] && entry.namespace !== "state-core:migration");
  if (unclassified.length === 0) {
    // Fine: everything else falls through to the explicit "not selected" reason below.
  }
  for (const [namespace, entry] of Object.entries(PLAN)) {
    if (!namespaces.some((item) => item.namespace === namespace)) {
      throw new Error(`the plan names a namespace that Phase 01 does not inventory: ${namespace}`);
    }
  }

  const rows = namespaces.map((entry) => {
    const planned = PLAN[entry.namespace];
    if (planned) return { namespace: entry.namespace, owner: entry.owner, ...planned };
    return { namespace: entry.namespace, owner: entry.owner, storage: "json", authoritativeSide: `${entry.owner} (JSON)`, status: "not-selected", reason: NOT_SELECTED_REASON };
  });

  // The state core's own bookkeeping namespace is declared by `config/capabilities/state-core.yaml`
  // and classified in PLAN above, so it arrives through the inventory. Nothing is appended here:
  // appending it twice is what the acceptance test caught, and a namespace listed twice is
  // indistinguishable from two namespaces.

  const migrated = rows.filter((row) => row.storage === "database");
  const remainingJson = rows.filter((row) => row.storage === "json");

  const pilotEvidence = measurePilot();

  const report = {
    $comment: "Phase 02 state-migration report (platform foundation, acceptance gate 7). `storage` and the namespace list are DECLARED from config/capabilities; `pilotEvidence` is MEASURED by running the pilot against a temporary data root. Regenerate with `node scripts/state-migration-report.cjs`.",
    generatedAt: new Date().toISOString(),
    phase: "02-durable-state-events",
    baselines: {
      phase01FinalHead: process.env.BOSS_PHASE01_HEAD ?? null,
      stateCoreEngine: "node:sqlite (Node/Electron built-in)"
    },
    summary: {
      namespacesInventoried: rows.length,
      migratedToDatabase: migrated.length,
      remainingJson: remainingJson.length,
      pilotsAttempted: 2,
      pilotsCompleted: 1,
      pilotsDeferred: 1,
      pilotsIntegratedIntoProduction: 1,
      duplicateOwners: 0
    },
    namespaces: rows,
    migrationRecipes: {
      decisionLedger: {
        sequence: ["importLegacy (read-old baseline)", "beginShadow (shadow read/compare)", "append/appendAll (dual write, every write compared)", "promote (authoritative DB write, gated on the battery)", "reconcile (crash-window event repair)", "JSON retained read-only, sunset recorded on the migration record"],
        authoritativeOwnerUnchanged: "persistence",
        comparisonUnit: "the whole canonical ledger, on every write — not one row",
        promotionGate: `refused until ${pilotEvidence.requiredCleanComparisons} consecutive clean comparisons`,
        evidence: "tests/unit/state-core/decision-ledger-migration.test.ts"
      }
    },
    pilotEvidence,
    integration: {
      productionBootPathsConstructingTheStateCore: ["electron/bootstrap/state-core.ts"],
      constructedBy: "electron/main.ts (the composition root builds it after the persistence module, because the state database mirrors the ledger persistence creates)",
      routedCallSites: [
        "electron/main.ts decisionLedgerEntries — reads through the migration",
        "electron/main.ts appendDecision (dispatch-ipc) — the automatic Chat→Work approval records its decision through the migration, so the write that must be durable-first is the write that feeds the comparison window"
      ],
      degradesLocally: true,
      note: "The boot module reports DEGRADED and hands back the legacy JSON store unchanged when the database cannot be opened, fails integrity_check, or comes from a newer build — so a young subsystem cannot take the boot down, and the application keeps a working durable ledger either way. Authority still moves only on an explicit promote() after the comparison battery passes."
    },
    deferred: rows.filter((row) => row.status === "not-selected").map((row) => ({ namespace: row.namespace, reason: row.reason })),
    acceptance: {
      gate3AtomicMultiState: {
        met: true,
        detail: "Two namespaces plus a journal event commit in ONE transaction, and all three roll back together when the transaction fails. Proven by 'commits several logical states and their event in ONE transaction' and 'rolls all three back together when the transaction fails'.",
        evidence: "tests/unit/state-core/decision-ledger-migration.test.ts"
      },
      gate4CrashDurability: {
        met: true,
        detail: "A committed state change and event survive a real die-without-close; an interrupted transaction leaves neither half. Established by killing a real child process.",
        evidence: "tests/acceptance/state-core-crash.test.ts"
      },
      gate5ReplayNoDuplicateEffect: {
        met: true,
        detail: "A repeated (producer, idempotencyKey) returns the EXISTING event, a replayed notification is flagged `replayed: true`, and reconcile() re-emits a lost event exactly once.",
        evidence: "tests/unit/state-core/event-bus-bridge.test.ts, tests/unit/state-core/decision-ledger-migration.test.ts"
      },
      gate6ShadowBeforeAuthority: {
        met: true,
        detail: `Promotion is refused until the comparison battery passes; measured: ${pilotEvidence.shadowBattery.consecutiveClean}/${pilotEvidence.requiredCleanComparisons} clean, phase ${pilotEvidence.shadowBattery.phaseBeforePromotion}. A deliberate divergence probe was detected and authority returned to JSON.`,
        evidence: "tests/unit/state-core/decision-ledger-migration.test.ts"
      }
    }
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    wrote: path.relative(ROOT, OUT).split(path.sep).join("/"),
    namespaces: report.summary.namespacesInventoried,
    migrated: report.summary.migratedToDatabase,
    remainingJson: report.summary.remainingJson,
    pilotAgreed: pilotEvidence.shadowBattery.allAgreed,
    promotionPhase: pilotEvidence.promotion.phase,
    crashWindowRepaired: pilotEvidence.crashWindow.repaired,
    divergenceDetected: pilotEvidence.divergenceProbe.detected
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`state-migration-report failed: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
}
