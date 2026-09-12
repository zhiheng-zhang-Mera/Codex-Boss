/**
 * Update-Plan/checkpoint-2.md §7.6 (CP21, OI-01..OI-10) — the Owner intervention
 * truth ledger.
 *
 * The suite proves the count is derived, not declared: an empty ledger is zero, one
 * recorded event is one, a tampered count is refused, a ledger from another session
 * is refused, a caller has no way to hand the audit a number, and every escalation
 * route in the repository is registered with a disposition.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AcceptanceRun, acceptanceArtifacts } from "../helpers/acceptance-report";
import { cleanupFixtures, gitRepo, tempDir } from "../helpers/root-fixtures";
import { assessBlocker } from "../../src/shared/final-acceptance";
import {
  appendOwnerIntervention,
  deriveOwnerInterventions,
  emptyOwnerLedger,
  ledgeredRoutes,
  OWNER_INTERVENTION_ROUTES,
  ownerLedgerHashOf,
  verifyOwnerLedger,
  type OwnerInterventionLedger
} from "../../src/shared/owner-intervention";
import { sessionProblems, type AcceptanceSession } from "../../src/shared/acceptance-evidence";
import { acceptanceDirectory, readSession, startAcceptanceSession, writeAttestation } from "../../electron/engineering/acceptance-session";
import { createBootstrapAuditor } from "../../electron/engineering/bootstrap-completion";
import {
  inspectOwnerLedger,
  initializeOwnerLedger,
  readOwnerLedger,
  recordOwnerIntervention,
  writeOwnerLedger
} from "../../electron/engineering/owner-intervention-ledger";

const run = new AcceptanceRun("CHECKPOINT_21_OWNER_INTERVENTION_LEDGER");
const REPORT_DIR = acceptanceArtifacts();
const SOURCE_FILES = ["src", "electron", "scripts"];

/** Binds a real (temp) certification session for a real git fixture. */
function fixtureSession(prefix: string): { root: string; artifacts: string; session: AcceptanceSession } {
  const repo = gitRepo(prefix);
  const artifacts = acceptanceDirectory(repo.root);
  const outcome = startAcceptanceSession({
    root: repo.root,
    artifacts,
    certify: true,
    clean: true,
    sessionId: `session-${prefix.replace(/[^a-z0-9]/gi, "")}`,
    commit: repo.sha,
    workingTreeStatus: ""
  });
  if (!outcome.ok || !outcome.session) throw new Error(`session fixture failed: ${outcome.reason}`);
  return { root: repo.root, artifacts, session: outcome.session };
}

/** Every source file under the given roots, as repository-relative POSIX paths. */
function sourceFiles(): { file: string; text: string }[] {
  const collected: { file: string; text: string }[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", "dist-electron", ".git"].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(ts|cjs|mjs|js)$/.test(entry.name)) {
        collected.push({
          file: path.relative(process.cwd(), full).split(path.sep).join("/"),
          text: fs.readFileSync(full, "utf8")
        });
      }
    }
  };
  for (const directory of SOURCE_FILES) {
    const full = path.join(process.cwd(), directory);
    if (fs.existsSync(full)) walk(full);
  }
  return collected;
}

describe("checkpoint-2 §7.6 CP21 owner intervention truth ledger", () => {
  it("OI-01 an empty ledger derives zero", async () => {
    await run.scenario("OI-01", "§7.5 derived count", (item) => {
      const ledger = emptyOwnerLedger({ session_id: "session-x", commit_sha: "a".repeat(40) });
      item.check("the ledger starts empty", 0, ledger.events.length);
      item.check("its count agrees", 0, ledger.count);
      item.check("and so does the derived count", 0, deriveOwnerInterventions(ledger));
      item.check("the digest is a sha256", true, /^[0-9a-f]{64}$/.test(ledger.ledger_hash));
      item.check("the digest covers the body", ledger.ledger_hash, ownerLedgerHashOf({ ...ledger, ledger_hash: undefined as unknown as string }));
      item.cite("emptyOwnerLedger");
    });
  });

  it("OI-02 one recorded event derives one", async () => {
    await run.scenario("OI-02", "§7.1 recording", (item) => {
      const fixture = fixtureSession("boss-oi-count-");
      initializeOwnerLedger(fixture.session, fixture.artifacts);
      const event = recordOwnerIntervention(
        { source: "acceptance-run", blocker_class: "HB3_MISSING_EXTERNAL_RESOURCE", reason: "the required external resource does not exist" },
        { artifacts: fixture.artifacts, session: fixture.session }
      );
      item.check("the event was recorded", true, event !== undefined);
      const ledger = readOwnerLedger(fixture.artifacts)!;
      item.check("the ledger has one event", 1, ledger.events.length);
      item.check("the count was derived", 1, ledger.count);
      item.check("the event has a stable id", "OI-0001", event?.id);
      item.check("the event names its source", "acceptance-run", event?.source);
      item.check("the event carries the blocker class", "HB3_MISSING_EXTERNAL_RESOURCE", event?.blocker_class);
      item.check("the ledger verifies", 0, verifyOwnerLedger({ ledger, session: fixture.session }).length);
      item.check("the run's inspection derives one", 1, inspectOwnerLedger(fixture.session, fixture.artifacts).count);
      const second = recordOwnerIntervention({ source: "acceptance-run", reason: "a second request" }, { artifacts: fixture.artifacts, session: fixture.session });
      item.check("a second event is numbered independently", "OI-0002", second?.id);
      item.check("and the count follows the events", 2, readOwnerLedger(fixture.artifacts)?.count);
      item.cite("recordOwnerIntervention");
    });
  });

  it("OI-03 a recorded intervention forbids completion", async () => {
    await run.scenario("OI-03", "§7.5 the count is or is not zero", (item) => {
      const clean = fixtureSession("boss-oi-clean-");
      initializeOwnerLedger(clean.session, clean.artifacts);
      const cleanInspection = inspectOwnerLedger(clean.session, clean.artifacts);
      item.check("a clean run has no events", 0, cleanInspection.count);
      item.check("and no ledger problems", 0, cleanInspection.problems.length);

      const dirty = fixtureSession("boss-oi-dirty-");
      initializeOwnerLedger(dirty.session, dirty.artifacts);
      recordOwnerIntervention({ source: "acceptance-run", reason: "the Owner had to choose a library" }, { artifacts: dirty.artifacts, session: dirty.session });
      const dirtyInspection = inspectOwnerLedger(dirty.session, dirty.artifacts);
      item.check("the run that asked has one event", 1, dirtyInspection.count);
      item.check("so the ledger is not empty", false, dirtyInspection.count === 0);
      item.cite("inspectOwnerLedger");
    });
  });

  it("OI-04 no caller can hand the run a zero count", async () => {
    await run.scenario("OI-04", "§2.5 OWNER_COUNT_DERIVED", (item) => {
      const sources = sourceFiles();
      const production = sources.filter((entry) => !entry.file.startsWith("tests/"));
      const injected = production
        .filter((entry) => /owner_interventions\s*\?:/.test(entry.text)
          || /evaluate\s*\(\s*\{[^}]*owner_interventions/.test(entry.text)
          || /owner_interventions\s*:\s*\d/.test(entry.text))
        .map((entry) => entry.file);
      item.check("no production source accepts or injects an owner count", JSON.stringify(injected), "[]");

      // The runtime proof: a caller that passes a count cannot change the verdict.
      const fixture = fixtureSession("boss-oi-override-");
      initializeOwnerLedger(fixture.session, fixture.artifacts);
      recordOwnerIntervention({ source: "acceptance-run", reason: "the Owner had to decide" }, { artifacts: fixture.artifacts, session: fixture.session });
      const auditor = createBootstrapAuditor({ root: fixture.root, artifacts: fixture.artifacts });
      const overridden = (auditor.evaluate as unknown as (input?: unknown) => ReturnType<typeof auditor.evaluate>)({ owner_interventions: 0 });
      item.check("the caller's zero is ignored", 1, overridden.audit.owner_interventions);
      item.check("and the run is INCOMPLETE", "INCOMPLETE", overridden.audit.decision);
      item.check("the ledger event is what the audit reports", 1, overridden.audit.owner_intervention_ledger.events);

      const request = { source: "run", at: new Date(0).toISOString(), reason: "one", count: 0 };
      const smuggled = appendOwnerIntervention(emptyOwnerLedger(fixture.session), request as unknown as Parameters<typeof appendOwnerIntervention>[1]);
      item.check("and the append path ignores a count in the request", 1, smuggled.count);
      item.cite("OWNER_COUNT_DERIVED");
    });
  });

  it("OI-05 a tampered count is refused", async () => {
    await run.scenario("OI-05", "§7.5 ledger integrity", (item) => {
      const fixture = fixtureSession("boss-oi-tamper-");
      const ledger = appendOwnerIntervention(emptyOwnerLedger(fixture.session), { source: "acceptance-run", at: new Date(0).toISOString(), reason: "one real request" });
      const tampered: OwnerInterventionLedger = { ...ledger, count: 0, ledger_hash: ownerLedgerHashOf({ ...ledger, count: 0 }) };
      const problems = verifyOwnerLedger({ ledger: tampered, session: fixture.session });
      item.check("the forged count is named", true, problems.some((problem) => problem.code === "LEDGER_COUNT_MISMATCH" && problem.detail === "0!=1"));
      const rehash: OwnerInterventionLedger = { ...ledger, count: 0 };
      item.check("and an unrehashed edit is caught too", true, verifyOwnerLedger({ ledger: rehash, session: fixture.session }).some((problem) => problem.code === "LEDGER_HASH_MISMATCH"));
      item.check("the honest ledger verifies", 0, verifyOwnerLedger({ ledger, session: fixture.session }).length);
      item.cite("LEDGER_COUNT_MISMATCH");
    });
  });

  it("OI-06 a ledger from another session is refused", async () => {
    await run.scenario("OI-06", "§2.3 same run", (item) => {
      const a = fixtureSession("boss-oi-session-a-");
      const b = fixtureSession("boss-oi-session-b-");
      const ledger = appendOwnerIntervention(emptyOwnerLedger(a.session), { source: "acceptance-run", at: new Date(0).toISOString(), reason: "asked while certifying A" });
      const problems = verifyOwnerLedger({ ledger, session: b.session });
      item.check("the session mismatch is named", true, problems.some((problem) => problem.code === "LEDGER_SESSION_MISMATCH"));
      const wrongCommit = { ...b.session, commit_sha: "b".repeat(40) };
      item.check("a commit mismatch is named", true, verifyOwnerLedger({ ledger: emptyOwnerLedger(wrongCommit), session: b.session }).some((problem) => problem.code === "LEDGER_COMMIT_MISMATCH"));
      item.check("and a ledger file from another session is quarantined, not merged", true, (() => {
        const ledgerPath = path.join(a.artifacts, "owner-interventions.json");
        writeOwnerLedger(a.artifacts, ledger);
        writeOwnerLedger(b.artifacts, ledger);
        const event = recordOwnerIntervention({ source: "acceptance-run", reason: "asked while certifying B" }, { artifacts: b.artifacts, session: b.session });
        const after = readOwnerLedger(b.artifacts)!;
        const archived = fs.existsSync(path.join(b.artifacts, "history", a.session.session_id, "owner-interventions.json"));
        return event !== undefined && after.session_id === b.session.session_id && after.events.length === 1 && archived && fs.existsSync(ledgerPath);
      })());
      item.cite("LEDGER_SESSION_MISMATCH");
    });
  });

  it("OI-07 a legal hard blocker is still recorded", async () => {
    await run.scenario("OI-07", "§7.2 legitimate blockers count", (item) => {
      const verdict = assessBlocker({ situation: "the account needs MFA before the release can be signed", authority_needed: true });
      item.check("§44 allows the blocker", true, verdict.allowed);
      item.check("and names its class", "HB1_AUTHORITY", verdict.blocker_class);
      const fixture = fixtureSession("boss-oi-blocker-");
      initializeOwnerLedger(fixture.session, fixture.artifacts);
      const event = recordOwnerIntervention(
        { source: "acceptance-run", blocker_class: verdict.blocker_class, reason: verdict.reason, requested_action: "complete the MFA challenge", outcome: "WAITING" },
        { artifacts: fixture.artifacts, session: fixture.session }
      );
      item.check("the legal blocker is recorded anyway", 1, readOwnerLedger(fixture.artifacts)?.events.length);
      item.check("with its class and requested action", "complete the MFA challenge", event?.requested_action);
      item.check("so it cannot be a silent zero", 1, inspectOwnerLedger(fixture.session, fixture.artifacts).count);
      item.cite("assessBlocker");
    });
  });

  it("OI-08 a forbidden autonomous decision has no route to the Owner", async () => {
    await run.scenario("OI-08", "§7.2/§7.4 no bypass", (item) => {
      const forbidden = assessBlocker({ situation: "the CI failure needs a human decision", claimed: "HB1_AUTHORITY" });
      item.check("§45 refuses the forbidden escalation", false, forbidden.allowed);
      item.check("and says Boss must decide it itself", true, forbidden.reason.includes("is Boss's own decision"));
      const fixture = fixtureSession("boss-oi-forbidden-");
      // No assessBlocker verdict, no event: the ledger is untouched by a refused ask.
      initializeOwnerLedger(fixture.session, fixture.artifacts);
      item.check("the ledger stays empty", 0, inspectOwnerLedger(fixture.session, fixture.artifacts).count);
      item.check("and a ledger-less run cannot claim a count", "OWNER_LEDGER_MISSING", inspectOwnerLedger(fixture.session, tempDir("boss-oi-empty-")).problems[0]?.code);
      item.check("recording without a session is refused", undefined, (() => {
        const bare = gitRepo("boss-oi-nosession-");
        return recordOwnerIntervention({ source: "acceptance-run", reason: "no session is active" }, { artifacts: acceptanceDirectory(bare.root) });
      })());
      item.cite("AUTONOMOUS_SITUATIONS");
    });
  });

  it("OI-09 the legacy owner-count parameter no longer exists", async () => {
    await run.scenario("OI-09", "§2.5 API", (item) => {
      const audit = fs.readFileSync(path.join(process.cwd(), "src", "shared", "bootstrap-audit.ts"), "utf8");
      const host = fs.readFileSync(path.join(process.cwd(), "electron", "engineering", "bootstrap-completion.ts"), "utf8");
      const driver = fs.readFileSync(path.join(process.cwd(), "scripts", "acceptance-bootstrap-completion.cjs"), "utf8");
      item.check("the pure audit declares no owner-count input", false, /owner_interventions\s*\?:/.test(audit));
      item.check("the host auditor never names an owner count", false, /owner_interventions/.test(host));
      item.check("the driver passes no owner count", false, /owner_interventions\s*:\s*\d/.test(driver) || /evaluate\(\s*\{/.test(driver));
      item.check("the audit takes the ledger instead", true, /ownerLedger/.test(audit));
      item.check("the host reads the ledger", true, /readOwnerLedger/.test(host));
      item.check("and the driver takes no arguments at all", true, /\.evaluate\(\)/.test(driver));
      item.cite("evaluate()");
    });
  });

  it("OI-10 every escalation route is registered and accounted for", async () => {
    await run.scenario("OI-10", "§7.4 single entry", (item) => {
      const sources = sourceFiles();
      const byFile = new Map(sources.map((entry) => [entry.file, entry.text]));
      const missing = OWNER_INTERVENTION_ROUTES.filter((route) => !byFile.has(route.file)).map((route) => route.file);
      item.check("every registered route exists", JSON.stringify(missing), "[]");
      const rotten = OWNER_INTERVENTION_ROUTES.filter((route) => !(byFile.get(route.file) ?? "").includes(route.marker)).map((route) => `${route.file}:${route.marker}`);
      item.check("every registered route still contains its marker", JSON.stringify(rotten), "[]");
      const ledgeredWithoutCall = ledgeredRoutes().filter((route) => !(byFile.get(route.file) ?? "").includes("recordOwnerIntervention")).map((route) => route.file);
      item.check("every ledgered route calls the central recorder", JSON.stringify(ledgeredWithoutCall), "[]");
      item.check("every route declares a disposition", true, OWNER_INTERVENTION_ROUTES.every((route) => ["LEDGERED", "PRODUCT_HITL", "STOPS_WITHOUT_ASKING", "POST_PRESTART"].includes(route.disposition)));
      item.check("stops-without-asking routes really do not escalate", true, OWNER_INTERVENTION_ROUTES.filter((route) => route.disposition === "STOPS_WITHOUT_ASKING").every((route) => !(byFile.get(route.file) ?? "").includes("recordOwnerIntervention")));

      // Exactly one writer: the ledger module owns the file, and only the
      // registered routes (plus that module and its CLI) name the recorder.
      const writers = sources.filter((entry) => /owner-interventions\.json/.test(entry.text)).map((entry) => entry.file).sort();
      item.check("only the ledger module names the ledger file", JSON.stringify(writers), JSON.stringify(["electron/engineering/owner-intervention-ledger.ts"]));
      const callers = sources
        .filter((entry) => /recordOwnerIntervention\s*\(/.test(entry.text))
        .map((entry) => entry.file)
        .filter((file) => !["src/shared/owner-intervention.ts", "electron/engineering/owner-intervention-ledger.ts", "scripts/acceptance-intervention.cjs", "electron/promotion-gate/promotion-controller.ts"].includes(file));
      item.check("no unregistered module calls the recorder", JSON.stringify(callers), "[]");

      // §44 classes may only be granted by the one authority rule, so a new
      // escalation class cannot appear anywhere without being registered.
      const hardBlockerLiterals = sources
        .filter((entry) => /"(HB1_AUTHORITY|HB2_IRREVERSIBLE_OWNER_DECISION|HB3_MISSING_EXTERNAL_RESOURCE|HB4_ROOT_POLICY)"/.test(entry.text))
        .map((entry) => entry.file)
        .filter((file) => !file.startsWith("tests/"));
      item.check("the Hard Blocker classes are granted in one place only", JSON.stringify(hardBlockerLiterals), JSON.stringify(["src/shared/final-acceptance.ts", "electron/promotion-gate/promotion-controller.ts"]));
      item.check("and the promotion route is registered as ledgered", "LEDGERED", OWNER_INTERVENTION_ROUTES.find((route) => route.id === "promotion-requires-root-owner")?.disposition);
      item.cite("OWNER_INTERVENTION_ROUTES");
    });
  });
});

afterAll(() => {
  const report = run.write(REPORT_DIR, "owner-ledger.json", { checkpoint: "CP21", routes: OWNER_INTERVENTION_ROUTES.length, ledgered: ledgeredRoutes().length });
  cleanupFixtures();
  run.assertAllPass();
  expect((report.totals as { fail: number }).fail).toEqual(0);
});
