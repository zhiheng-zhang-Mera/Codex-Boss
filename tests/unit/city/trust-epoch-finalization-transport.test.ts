import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * Root Trust finalization — the transport/handoff boundary, and the terminal semantics it fixes.
 *
 * THE FAILURE THIS REPAIR EXISTS FOR
 *   The finalization workflow used to end with `gh pr create`. Repository policy does not permit the Actions
 *   `GITHUB_TOKEN` to create pull requests, so the step failed — and it failed the same way for two consecutive
 *   epochs:
 *
 *       epoch 26:  ceremony PASS, --advance PASS, --check PASS, branch pushed PASS, gh pr create FAIL
 *       epoch 27:  ceremony PASS, --advance PASS, --check PASS, branch pushed PASS, gh pr create FAIL
 *
 *   In both cases the epoch was correctly produced and anchored and the workflow was reported FAILED. The defect is
 *   semantic before it is operational: the workflow's terminal state described its TRANSPORT rather than its
 *   CEREMONY, so no reader could tell "the epoch is wrong" from "the epoch is right and nobody was told".
 *
 * THE CORRECTED SHAPE, WHICH THESE TESTS PIN
 *
 *       produce + verify (--check) + push + hand off   ->  SUCCESS  (EPOCH_BRANCH_READY)
 *       nothing to migrate                             ->  SUCCESS  (NO_MIGRATION, nothing written)
 *       branch already exactly right                   ->  SUCCESS  (EPOCH_BRANCH_ALREADY_READY, no re-advance)
 *       branch exists and disagrees                    ->  FAILURE  (EPOCH_BRANCH_CONFLICT, fail closed)
 *
 *   PR transport belongs to the Codex-Boss App machine identity, which is the repository's existing machine
 *   transport. **Authority is reduced, not moved**: the workflow keeps `contents: write` and loses
 *   `pull-requests: write`; no Owner credential, App private key or broader permission appears anywhere.
 *
 * WHAT THESE TESTS CANNOT PROVE, STATED SO THEY ARE NOT OVER-CLAIMED
 *   The live end-to-end run of the repaired workflow is a dispatched, Owner-approved, protected-environment
 *   ceremony — it cannot be executed from a unit test and is not claimed here. These tests establish the STATIC
 *   properties of the prepared workflow and the BEHAVIOUR of the pure decision module that the workflow calls.
 *   The live proof is the epoch-28 run, recorded in the ledger when it happens.
 */

const PROJECT = process.cwd();
const WORKFLOW = ".github/workflows/trust-epoch-finalization.yml";
const HANDOFF_MODULE = "scripts/trust-epoch-finalization-handoff.cjs";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handoff = require(path.join(PROJECT, HANDOFF_MODULE)) as {
  STATE: Record<string, string>;
  SUCCESS_STATES: string[];
  HANDOFF_SCHEMA: string;
  isSuccessState: (state: string) => boolean;
  compareEpochRecord: (expected: unknown, existing: unknown) => { comparable: boolean; matching: boolean; differences: string[] };
  decideTerminalState: (input: unknown) => { state: string; success: boolean; wrote_anything: boolean; re_advanced?: boolean; message: string };
  buildHandoff: (input: unknown) => Record<string, unknown>;
  validateHandoff: (value: unknown) => { ok: boolean; problems: string[] };
};

function workflowRaw(): string {
  return fs.readFileSync(path.join(PROJECT, WORKFLOW), "utf8");
}

/** Every non-comment line: what the workflow EXECUTES, not what it explains. */
function executableLines(text: string): string {
  return text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join("\n");
}

type Workflow = {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, { environment?: string; "runs-on"?: string; if?: unknown; steps?: Array<{ name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> }> }>;
};

function parsedWorkflow(): Workflow {
  return parseYaml(workflowRaw()) as Workflow;
}

function finalizeJob() {
  const job = parsedWorkflow().jobs?.finalize;
  if (!job) throw new Error(`the finalize job is absent from ${WORKFLOW}`);
  return job;
}

/** The epoch record shape the decision module compares. */
const epochRecord = (over: Record<string, unknown> = {}) => ({
  trust_epoch: 28,
  root_contract_version: "boss-root-trust-28",
  root_surface_hash: "a".repeat(64),
  parent_epoch_hash: "b".repeat(64),
  epoch_hash: "c".repeat(64),
  ...over,
});

const handoffInput = (over: Record<string, unknown> = {}) => ({
  repository: "zhiheng-zhang-Mera/Codex-Boss",
  finalizationRunId: 123456789,
  baseBranch: "main",
  baseSha: "d".repeat(40),
  epoch: 28,
  epochBranch: "trust-epoch/boss-root-trust-28",
  epochCommit: "e".repeat(40),
  rootSurfaceHash: "a".repeat(64),
  epochHash: "c".repeat(64),
  prRequired: true,
  result: { state: handoff.STATE.EPOCH_BRANCH_READY, success: true, message: "ready" },
  ...over,
});

// =============================================================================================
// T1..T9, T13..T15 — the prepared workflow's static contract
// =============================================================================================

describe("Trust finalization transport hardening: the workflow's static contract", () => {
  it("T1 permissions are contents:write only, and T2 pull-requests:write is gone", () => {
    const perms = parsedWorkflow().permissions ?? {};
    expect(perms.contents, "the workflow no longer has contents: write, so it cannot push the epoch branch").toBe("write");
    // THE WHOLE POINT OF THE REPAIR: the workflow no longer asks for the authority it cannot use. The GITHUB_TOKEN
    // may not create pull requests in this repository, so requesting it was authority that existed only to fail.
    expect(perms, "the workflow still requests pull-requests: write").not.toHaveProperty("pull-requests");
    expect(Object.keys(perms).sort(), `the workflow requests more than contents: write: ${JSON.stringify(perms)}`).toEqual(["contents"]);
  });

  it("T3 the workflow no longer runs `gh pr create`, and T14 never escalates a credential", () => {
    const lines = executableLines(workflowRaw());
    expect(lines, "the workflow still calls `gh pr create`").not.toMatch(/gh\s+pr\s+create/);
    // The PR step's token plumbing must be gone with it.
    expect(lines, "the workflow still exports GH_TOKEN for PR transport").not.toMatch(/GH_TOKEN/);
    // And no credential may be introduced to replace it: no Owner PAT, no App key, no wider scope.
    for (const forbidden of ["OWNER_PAT", "owner_pat", "PRIVATE KEY", "APP_PRIVATE_KEY", "pull_request_target", "administration: write", "secrets.OWNER"]) {
      expect(lines, `the workflow references ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("T4 the protected Owner environment is preserved", () => {
    expect(finalizeJob().environment, "the finalization job no longer targets the protected Owner environment").toBe("boss-root-trust-owner");
    // The environment is the external authority gate: a job targeting an environment with required reviewers does
    // not start until the named reviewer approves it. Losing this would make the ceremony machine-authorizable.
    expect(executableLines(workflowRaw())).toContain("environment: boss-root-trust-owner");
  });

  it("T5 the main-only refusal is preserved and fails closed", () => {
    const lines = executableLines(workflowRaw());
    expect(lines, "the refs/heads/main refusal is gone").toContain("refs/heads/main");
    expect(lines, "the refusal no longer fails closed with its own code").toContain("TRUST_EPOCH_FINALIZATION_REQUIRES_MAIN");
    // It must still be dispatch-only: a push, pull_request or schedule trigger would let an autonomous actor reach
    // the ceremony by landing code.
    const triggers = (parsedWorkflow().on ?? {}) as Record<string, unknown>;
    expect(Object.keys(triggers), `the workflow gained a trigger: ${Object.keys(triggers).join(",")}`).toEqual(["workflow_dispatch"]);
  });

  it("T6 --advance is followed by --check, and T7 the branch push is preserved", () => {
    const lines = executableLines(workflowRaw());
    const advanceAt = lines.indexOf("acceptance-evolution-bless.cjs --advance");
    const checkAt = lines.indexOf("acceptance-evolution-bless.cjs --check");
    expect(advanceAt, "--advance is gone; the ceremony cannot advance an epoch").toBeGreaterThanOrEqual(0);
    expect(checkAt, "--check is gone; a migration that did not anchor the surface could be reported as one that did").toBeGreaterThanOrEqual(0);
    // Order matters: the check must verify the state the advance produced.
    expect(checkAt, "--check no longer follows --advance").toBeGreaterThan(advanceAt);
    expect(lines, "the epoch branch is no longer pushed").toMatch(/git push[^\n]*origin/);
    // Only the epoch record and the proposal are staged -- and the ignored artifact must NOT be listed (below).
    expect(lines, "the commit no longer stages the epoch record").toContain("trust-policy/trust-epoch.json");
    expect(lines, "the workflow pushes with --force").not.toMatch(/git push[^\n]*--force/);
  });

  it("T8 the workflow never pushes main directly", () => {
    const lines = executableLines(workflowRaw());
    // A direct main push would bypass the Owner's merge, which the header states is the final authority act.
    expect(lines, "the workflow pushes to main").not.toMatch(/git push[^\n]*\bmain\b/);
    // And the commit step must create its own branch rather than committing on the checked-out ref.
    expect(lines, "the epoch commit no longer creates a branch").toMatch(/git checkout -b/);
  });

  it("T9 the handoff is produced, and the ignored artifact is no longer staged", () => {
    const lines = executableLines(workflowRaw());
    // The machine-readable handoff is what replaces PR transport: without it the App has nothing to consume.
    expect(lines, "the workflow does not produce the epoch PR handoff").toMatch(/epoch-pr-handoff\.json/);
    // THE I-14 DEFECT, fixed as part of this boundary: `artifacts/**` is gitignored, so `git add` on the proposal
    // path refuses the pathspec. Depending on the shell's native-command error preference that either fails the
    // step or is merely noisy -- a governance step whose success depends on a shell preference. The artifact
    // survives as a workflow upload; it must not be staged.
    expect(lines, "the commit step still stages the gitignored proposal artifact").not.toMatch(/git add[^\n]*artifacts\//);
  });

  it("T13 the artifact upload stays bounded", () => {
    const upload = (finalizeJob().steps ?? []).find((step) => String(step.uses ?? "").startsWith("actions/upload-artifact"));
    expect(upload, "the finalization evidence upload is gone").toBeTruthy();
    const paths = String((upload?.with as Record<string, unknown> | undefined)?.path ?? "");
    const entries = paths.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    expect(entries.length, "the upload declares no path").toBeGreaterThan(0);
    for (const entry of entries) {
      // A whole corpus root or a recursive glob into one is the forbidden thing; a NAMED generated file is what
      // is wanted. Nothing here may ship a working tree or a credential store.
      expect(entry, `the upload ships a corpus root: ${entry}`).not.toMatch(/^(artifacts|runtime-data|history|\.codex-boss|\*|\.)\/?$|^(artifacts|runtime-data|history|\.codex-boss)\/\*/);
      expect(entry, `the upload entry is not a narrow generated artifact: ${entry}`).toMatch(/\.(json|md)$/);
    }
  });

  it("T15 the repository's policy remains restrictive: the workflow is still not a bypass path", () => {
    // The repair reduces what the workflow may do. It must not have traded a failing transport step for a broader
    // permission, a privileged trigger, or a path that reaches repository administration.
    const lines = executableLines(workflowRaw());
    for (const forbidden of ["workflow_run:", "pull_request_target:", "schedule:", "/rulesets", "/branches/main/protection", "--admin"]) {
      expect(lines, `the workflow gained a privileged surface: ${forbidden}`).not.toContain(forbidden);
    }
    // And it is not Root Trust Surface itself, so changing it does not move the epoch aggregate -- which is why
    // this hardening can land without a re-finalization.
    const surface = JSON.parse(fs.readFileSync(path.join(PROJECT, "trust-policy", "root-trust-surface.json"), "utf8")) as { declared: { paths: string[] } };
    const inSurface = surface.declared.paths.some((p) => p === WORKFLOW);
    expect(inSurface, "the finalization workflow became Root Trust Surface; the hardening premise changed").toBe(false);
  });

  it("T16 the already-ready path compares against the PROPOSED record, never the committed one", () => {
    // THE SECOND HALF OF THE IDEMPOTENCY DEFECT. Deciding the terminal state from the COMMITTED record cannot work:
    // the committed epoch is the stale one by definition -- that is why a migration was needed at all -- so a branch
    // carrying exactly the proposed record would be compared against a record that disagrees with it and reported as
    // EPOCH_BRANCH_CONFLICT. The idempotent success would be unreachable and a rerun would fail forever.
    const lines = executableLines(workflowRaw());
    expect(lines, "the handoff no longer receives the proposed record").toContain("$expectedPath = \"$env:RUNNER_TEMP/expected-epoch.json\"");
    // THE DECISIVE CHECK, and it is on the handoff step's OWN argument rather than on a quoted spelling of the bad
    // one. `--expected-record "trust-policy/trust-epoch.json"` can be written with either quote character, so a
    // check for one spelling of the defect would miss the defect. What must hold is the VALUE: the handoff compares
    // against the record this run proposed, never against the committed tree.
    const handoffStep = (finalizeJob().steps ?? []).find((step) => String(step.name ?? "").includes("write the PR handoff"));
    expect(handoffStep, "the terminal handoff step is gone").toBeTruthy();
    const handoffRun = String(handoffStep?.run ?? "");
    expect(handoffRun, "the handoff step is not present in the parsed workflow").not.toBe("");
    const expectedArg = /--expected-record\s+(\S+)/.exec(handoffRun);
    expect(expectedArg, "the handoff no longer passes --expected-record at all").toBeTruthy();
    // The VALUE must be this run's proposed record. The commit step legitimately names the committed record --
    // that is the file it stages -- which is exactly why the check belongs to this step's argument and not to a
    // file-wide search for the path.
    expect(expectedArg?.[1], "the handoff compares against the committed record, so a matching already-ready branch would be misreported as a conflict").toBe('"$expectedPath"');
    // The proposed record must also be SEEDED from the branch on the already-ready path, or its epoch hash stays
    // null and a null hash compares unequal to the real one -- the same inverted verdict by a different route.
    expect(lines, "the already-ready path does not seed the expected epoch hash from the branch").toMatch(/\$expected\.epoch_hash = \$existingRecord\.epoch_hash/);

    // And the decision must still discriminate: a branch that genuinely disagrees is still a conflict, so the
    // seeding above cannot have made every branch match.
    const agreed = handoff.decideTerminalState({ needsMigration: true, branchExists: true, expectedRecord: epochRecord(), existingRecord: epochRecord(), candidateEpoch: 28 });
    const disagreed = handoff.decideTerminalState({ needsMigration: true, branchExists: true, expectedRecord: epochRecord(), existingRecord: epochRecord({ root_surface_hash: "9".repeat(64) }), candidateEpoch: 28 });
    expect(agreed.state, "a branch matching the proposed record is no longer idempotently ready").toBe(handoff.STATE.EPOCH_BRANCH_ALREADY_READY);
    expect(disagreed.state, "a branch disagreeing with the proposed record is no longer refused").toBe(handoff.STATE.EPOCH_BRANCH_CONFLICT);
  });

  it("T17 the run that reuses a ready branch still names the commit and hash it publishes", () => {
    // THE FIRST HALF OF THE SAME DEFECT. EPOCH_COMMIT is written by the commit step, which is skipped when the
    // branch already exists -- so on that path the handoff named no commit and its own validator refused it. A
    // request the App cannot act on is not a handoff, so the idempotent success path has to resolve both facts from
    // the branch it is reusing.
    const lines = executableLines(workflowRaw());
    expect(lines, "the handoff step no longer falls back to the branch's own commit").toMatch(/git rev-parse FETCH_HEAD/);
    expect(lines, "the handoff step no longer passes the epoch hash it publishes").toContain('--epoch-hash "$epochHash"');
    // It must PASS the commit, not merely compute it: relying on the EPOCH_COMMIT environment variable alone would
    // work on the producing path (whose commit step exports it) and silently publish nothing on the reuse path,
    // which is the path this test exists for.
    const reuseStep = (finalizeJob().steps ?? []).find((step) => String(step.name ?? "").includes("write the PR handoff"));
    const reuseRun = String(reuseStep?.run ?? "");
    expect(reuseRun, "the handoff step no longer passes the commit it resolved").toContain('--epoch-commit "$epochCommit"');

    // The behaviour, not just the wording: given the branch's record and commit, the CLI reports a success that
    // names a real commit and a real hash. This is the case that used to exit 1.
    const record = {
      record: { trust_epoch: 28, root_contract_version: "boss-root-trust-28", root_surface_hash: "a".repeat(64), parent_epoch_hash: "b".repeat(64), epoch_hash: "c".repeat(64) },
      epoch_hash: "c".repeat(64),
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-finalize-reuse-"));
    const expectedFile = path.join(dir, "expected.json");
    const existingFile = path.join(dir, "existing.json");
    fs.writeFileSync(expectedFile, JSON.stringify(record), "utf8");
    fs.writeFileSync(existingFile, JSON.stringify(record), "utf8");
    const out = path.join(dir, "epoch-pr-handoff.json");
    const result = spawnSync(process.execPath, [
      "scripts/trust-epoch-finalize-handoff.cjs",
      "--repository", "zhiheng-zhang-Mera/Codex-Boss", "--run-id", "123456789",
      "--base-sha", "d".repeat(40), "--candidate-epoch", "28",
      "--branch", "trust-epoch/boss-root-trust-28", "--root-surface-hash", "a".repeat(64),
      "--expected-record", expectedFile, "--existing-record", existingFile,
      "--epoch-commit", "e".repeat(40), "--epoch-hash", "c".repeat(64),
      "--out", out,
    ], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    expect(result.status, `reusing an already-ready branch must succeed, not fail its own validation: ${result.stderr}`).toBe(0);
    const built = JSON.parse(fs.readFileSync(out, "utf8")) as { state: string; epoch_commit: string; epoch_hash: string; pr_required: boolean };
    expect(built.state).toBe(handoff.STATE.EPOCH_BRANCH_ALREADY_READY);
    expect(built.epoch_commit, "the reused branch's handoff names no commit, so the App cannot open a PR against it").toBe("e".repeat(40));
    expect(built.epoch_hash).toBe("c".repeat(64));
    expect(built.pr_required, "a reused ready branch must still be handed off for merging").toBe(true);
  });

  it("T18 the no-migration path names its terminal state instead of falling through silent", () => {
    // Without this the workflow's own correct no-op ends with no FINALIZATION_RESULT, and a reader cannot tell
    // "already anchored" from "did nothing because it fell through".
    const lines = executableLines(workflowRaw());
    expect(lines, "the no-migration step no longer names its terminal state").toContain('"FINALIZATION_RESULT=NO_MIGRATION"');
    // The three success states must each be reachable and each name exactly one result.
    const results = lines.match(/FINALIZATION_RESULT=\$?\(?\$?\w*\)?\S*/g) ?? [];
    expect(results.length, `the workflow does not name a terminal result on every success path: ${JSON.stringify(results)}`).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================================
// T10..T12 — the terminal decision, exercised as a pure function
// =============================================================================================

describe("Trust finalization terminal semantics: no-migration, idempotency, conflict", () => {
  it("T10 no migration is a SUCCESS and writes nothing", () => {
    const decision = handoff.decideTerminalState({ needsMigration: false, branchExists: false });
    expect(decision.state).toBe(handoff.STATE.NO_MIGRATION);
    // A workflow that FAILS because the repository was already correct teaches operators to re-run it until it
    // does something, which is the opposite of what a trust gate should teach.
    expect(decision.success, "a correctly-anchored repository is not a failure").toBe(true);
    expect(decision.wrote_anything, "the no-migration path wrote something").toBe(false);
    expect(handoff.isSuccessState(decision.state)).toBe(true);
  });

  it("T11 a matching pre-existing branch is an IDEMPOTENT SUCCESS with no re-advance", () => {
    const record = epochRecord();
    const decision = handoff.decideTerminalState({ needsMigration: true, branchExists: true, expectedRecord: record, existingRecord: { ...record }, candidateEpoch: 28 });
    expect(decision.state).toBe(handoff.STATE.EPOCH_BRANCH_ALREADY_READY);
    expect(decision.success).toBe(true);
    expect(decision.wrote_anything).toBe(false);
    // The critical property: a rerun after the branch was already pushed must NOT advance again. Advancing twice
    // would either be a silent no-op or produce a different record over an Owner-authorised one.
    expect(decision.re_advanced, "a rerun re-advanced the epoch").toBe(false);
  });

  it("T12 a conflicting pre-existing branch FAILS CLOSED and names the disagreement", () => {
    const decision = handoff.decideTerminalState({
      needsMigration: true,
      branchExists: true,
      expectedRecord: epochRecord({ epoch_hash: "1".repeat(64) }),
      existingRecord: epochRecord({ epoch_hash: "2".repeat(64) }),
      candidateEpoch: 28,
    });
    expect(decision.state).toBe(handoff.STATE.EPOCH_BRANCH_CONFLICT);
    expect(decision.success, "a conflicting epoch branch was treated as success").toBe(false);
    expect(decision.wrote_anything, "the conflict path wrote something").toBe(false);
    expect(handoff.isSuccessState(decision.state)).toBe(false);
    // It must say WHAT disagrees: "conflict" alone is not a reviewable statement, and the whole reason to fail
    // closed here is that an Owner-authorised epoch branch must never be overwritten or force-pushed.
    const comparison = handoff.compareEpochRecord(epochRecord({ epoch_hash: "1".repeat(64) }), epochRecord({ epoch_hash: "2".repeat(64) }));
    expect(comparison.matching).toBe(false);
    expect(comparison.differences.join(" ")).toMatch(/epoch_hash/);
  });

  it("T12b an unreadable existing record is a conflict, not a coincidence", () => {
    // "I could not read it" must never resolve to "it matches".
    for (const existing of [null, undefined, {}, "not-an-object"]) {
      const decision = handoff.decideTerminalState({ needsMigration: true, branchExists: true, expectedRecord: epochRecord(), existingRecord: existing, candidateEpoch: 28 });
      expect(decision.state, `an unreadable record (${JSON.stringify(existing)}) was accepted`).toBe(handoff.STATE.EPOCH_BRANCH_CONFLICT);
      expect(decision.success).toBe(false);
    }
  });

  it("T11b the fresh-branch path reports that it wrote, and the three success states are exactly three", () => {
    const fresh = handoff.decideTerminalState({ needsMigration: true, branchExists: false, candidateEpoch: 28 });
    expect(fresh.state).toBe(handoff.STATE.EPOCH_BRANCH_READY);
    expect(fresh.success).toBe(true);
    expect(fresh.wrote_anything).toBe(true);
    // A success state that is not a success, or a failure that is one, would make every caller's exit code wrong.
    expect(handoff.SUCCESS_STATES.slice().sort()).toEqual([handoff.STATE.EPOCH_BRANCH_ALREADY_READY, handoff.STATE.EPOCH_BRANCH_READY, handoff.STATE.NO_MIGRATION].sort());
    expect(handoff.isSuccessState(handoff.STATE.EPOCH_BRANCH_CONFLICT)).toBe(false);
  });
});

// =============================================================================================
// The handoff manifest — schema, binding, and credential refusal
// =============================================================================================

describe("Trust finalization handoff manifest: schema, binding, and credential refusal", () => {
  it("a well-formed handoff validates and binds to its run, base, epoch, branch and commit", () => {
    const built = handoff.buildHandoff(handoffInput());
    const result = handoff.validateHandoff(built);
    expect(result.problems, `a built handoff failed its own validator: ${result.problems.join("; ")}`).toEqual([]);
    expect(result.ok).toBe(true);
    expect(built.schema).toBe(handoff.HANDOFF_SCHEMA);
    expect(built.state).toBe(handoff.STATE.EPOCH_BRANCH_READY);
    expect(built.finalization_run_id).toBe("123456789");
    expect(built.base_branch).toBe("main");
    expect(built.base_sha).toBe("d".repeat(40));
    expect(built.epoch).toBe(28);
    expect(built.epoch_branch).toBe("trust-epoch/boss-root-trust-28");
    expect(built.epoch_commit).toBe("e".repeat(40));
    expect(built.pr_required).toBe(true);
    expect(built.pr_creator).toBe("codex-boss-machine-identity");
  });

  it("the handoff states that it is a REQUEST, and that the workflow holds no PR authority", () => {
    const built = handoff.buildHandoff(handoffInput()) as { authority: Record<string, unknown>; pr_creator: string };
    // The artifact must be self-describing about authority: a consumer should not have to infer from absence that
    // the workflow cannot create the PR, or that the Owner still has to merge.
    expect(built.authority.workflow_may_create_pull_requests).toBe(false);
    expect(built.authority.owner_merge_required).toBe(true);
    expect(built.authority.owner_credential_in_artifact).toBe(false);
    expect(built.authority.workflow_permissions).toEqual({ contents: "write" });
    // A NAME, not a credential: the App's private key lives in the platform vault and never in a generated file.
    expect(built.pr_creator).not.toMatch(/gh[pousr]_|BEGIN|token/i);
  });

  it("the handoff refuses to carry credential material, wherever it is hidden", () => {
    const base = handoff.buildHandoff(handoffInput());
    const shapes = [
      { label: "a PEM private key", mutate: (h: Record<string, unknown>) => ({ ...h, note: "-----BEGIN RSA PRIVATE KEY-----\nMIIE..." }) },
      { label: "a GitHub token", mutate: (h: Record<string, unknown>) => ({ ...h, token: `ghp_${"A".repeat(30)}` }) },
      { label: "an authorization header", mutate: (h: Record<string, unknown>) => ({ ...h, headers: "Authorization: Bearer abc" }) },
      { label: "a private key field", mutate: (h: Record<string, unknown>) => ({ ...h, app_private_key: "abc" }) },
    ];
    for (const { label, mutate } of shapes) {
      const result = handoff.validateHandoff(mutate(base));
      expect(result.ok, `the handoff accepted ${label}`).toBe(false);
      expect(result.problems.join(" "), `the refusal did not name ${label}`).toMatch(/credential|private key|token|authorization/i);
    }
  });

  it("the handoff refuses a broken binding rather than passing a partially-formed request", () => {
    const base = handoff.buildHandoff(handoffInput());
    const cases: Array<{ label: string; mutate: (h: Record<string, unknown>) => Record<string, unknown>; expect: RegExp }> = [
      { label: "missing epoch_commit", mutate: ({ epoch_commit, ...rest }) => rest, expect: /epoch_commit/ },
      { label: "a short epoch commit", mutate: (h) => ({ ...h, epoch_commit: "abc" }), expect: /git object id/ },
      { label: "a malformed surface hash", mutate: (h) => ({ ...h, root_surface_hash: "nope" }), expect: /sha256/ },
      { label: "a branch that disagrees with the epoch", mutate: (h) => ({ ...h, epoch: 29 }), expect: /disagrees|does not match/ },
      { label: "an unknown state", mutate: (h) => ({ ...h, state: "MAYBE_READY" }), expect: /not one of/ },
      { label: "a wrong schema", mutate: (h) => ({ ...h, schema: "other/1" }), expect: /schema/ },
    ];
    for (const { label, mutate, expect: pattern } of cases) {
      const result = handoff.validateHandoff(mutate(base));
      expect(result.ok, `the handoff accepted ${label}`).toBe(false);
      expect(result.problems.join(" "), `${label} was rejected for the wrong reason`).toMatch(pattern);
    }
  });

  it("the module is inert: it decides from its arguments and touches nothing", () => {
    // A pure decision module is the reason T10..T12 can be tested at all without a runner. If it ever grew a
    // filesystem or network side effect, these cases would stop being evidence about the decision.
    const source = fs.readFileSync(path.join(PROJECT, HANDOFF_MODULE), "utf8");
    const body = source.slice(source.indexOf("module.exports"));
    for (const forbidden of ["readFileSync", "writeFileSync", "execFileSync", "spawnSync", "fetch(", "process.exit"]) {
      const beforeExports = source.slice(0, source.indexOf("module.exports"));
      expect(beforeExports, `the decision module performs a side effect: ${forbidden}`).not.toContain(forbidden);
    }
    expect(body).toContain("decideTerminalState");
    // ...and it is loadable by a plain Node process, like every other scripts/*.cjs.
    const probe = spawnSync(process.execPath, ["-e", `const m=require(${JSON.stringify(path.join(PROJECT, HANDOFF_MODULE))}); if(!m.decideTerminalState) process.exit(1);`], { encoding: "utf8", timeout: 60000 });
    expect(probe.status, `the module could not be loaded by plain node: ${probe.stderr}`).toBe(0);
  });

  it("the handoff is state-aware: only a run that PRODUCED the branch must name a commit and an epoch hash", () => {
    // A no-migration run and a rerun onto an already-ready branch produce no new commit and no new epoch hash, so
    // demanding one would force the program to invent a value -- which is the one thing a governance artifact must
    // never do. The produce-state must still carry real ones.
    const noMigration = handoff.buildHandoff(handoffInput({
      epochCommit: "", epochHash: null, prRequired: false,
      result: { state: handoff.STATE.NO_MIGRATION, success: true, message: "nothing to migrate" },
    }));
    const noMigrationCheck = handoff.validateHandoff(noMigration);
    expect(noMigrationCheck.problems, `a no-migration handoff was rejected: ${noMigrationCheck.problems.join("; ")}`).toEqual([]);

    expect(handoff.validateHandoff(handoff.buildHandoff(handoffInput())).ok).toBe(true);

    // ...but a PRODUCED branch that names no commit is a request the App cannot act on, and must be refused.
    const refused = handoff.validateHandoff(handoff.buildHandoff(handoffInput({ epochCommit: "" })));
    expect(refused.ok, "a ready handoff with no commit was accepted").toBe(false);
    expect(refused.problems.join(" ")).toMatch(/epoch_commit/);
  });
});

// =============================================================================================
// The command line the workflow actually calls
// =============================================================================================

describe("Trust finalization handoff CLI: the exit codes the workflow depends on", () => {
  const CLI = "scripts/trust-epoch-finalize-handoff.cjs";
  const record = (over: Record<string, unknown> = {}) => ({
    record: { trust_epoch: 28, root_contract_version: "boss-root-trust-28", root_surface_hash: "a".repeat(64), parent_epoch_hash: "b".repeat(64), epoch_hash: "c".repeat(64) },
    epoch_hash: "c".repeat(64),
    ...over,
  });

  function writeRecord(name: string, value: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-finalize-rec-"));
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(value), "utf8");
    return file;
  }

  function runCli(extraArgs: string[], env: Record<string, string> = {}): { status: number | null; state: string; prRequired: boolean; stderr: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-finalize-cli-"));
    const out = path.join(dir, "epoch-pr-handoff.json");
    const result = spawnSync(process.execPath, [
      CLI, "--repository", "zhiheng-zhang-Mera/Codex-Boss", "--run-id", "123456789",
      "--base-sha", "d".repeat(40), "--candidate-epoch", "28",
      "--branch", "trust-epoch/boss-root-trust-28", "--root-surface-hash", "a".repeat(64),
      "--out", out, ...extraArgs,
    ], { cwd: PROJECT, encoding: "utf8", timeout: 120000, env: { ...process.env, ...env } });
    const decision = JSON.parse(fs.readFileSync(path.join(dir, "epoch-pr-decision.json"), "utf8")) as { state: string };
    const handoffJson = JSON.parse(fs.readFileSync(out, "utf8")) as { pr_required: boolean };
    return { status: result.status, state: decision.state, prRequired: handoffJson.pr_required, stderr: String(result.stderr ?? "") };
  }

  it("NO_MIGRATION exits 0 and requires no PR", () => {
    const run = runCli(["--no-migration"]);
    // A workflow that FAILS because the repository was already correct teaches operators to re-run it until it does
    // something, which is the opposite of what a trust gate should teach.
    expect(run.status, `a correctly-anchored repository must not fail the workflow: ${run.stderr}`).toBe(0);
    expect(run.state).toBe(handoff.STATE.NO_MIGRATION);
    expect(run.prRequired).toBe(false);
  });

  it("EPOCH_BRANCH_READY exits 0 and requires the PR handoff", () => {
    const run = runCli(["--expected-record", writeRecord("expected.json", record())], { EPOCH_COMMIT: "f".repeat(40) });
    expect(run.status, `the produced-branch path must succeed: ${run.stderr}`).toBe(0);
    expect(run.state).toBe(handoff.STATE.EPOCH_BRANCH_READY);
    expect(run.prRequired, "the produced branch must be handed off for a PR").toBe(true);
  });

  it("a produced branch with no commit is refused rather than handed off", () => {
    const run = runCli(["--expected-record", writeRecord("expected.json", record())]);
    expect(run.status, "a ready handoff with no commit was accepted").toBe(1);
    expect(run.stderr).toMatch(/epoch_commit/);
  });

  it("EPOCH_BRANCH_ALREADY_READY exits 0 without re-advancing, and a conflict exits 1", () => {
    const already = runCli(["--expected-record", writeRecord("e.json", record()), "--existing-record", writeRecord("x.json", record())]);
    expect(already.status, `a matching pre-existing branch must be an idempotent success: ${already.stderr}`).toBe(0);
    expect(already.state).toBe(handoff.STATE.EPOCH_BRANCH_ALREADY_READY);

    const conflicting = runCli([
      "--expected-record", writeRecord("e.json", record()),
      "--existing-record", writeRecord("x.json", record({ record: { trust_epoch: 28, root_contract_version: "boss-root-trust-28", root_surface_hash: "a".repeat(64), parent_epoch_hash: "b".repeat(64), epoch_hash: "9".repeat(64) }, epoch_hash: "9".repeat(64) })),
    ]);
    expect(conflicting.status, "a conflicting epoch branch must fail closed").toBe(1);
    expect(conflicting.state).toBe(handoff.STATE.EPOCH_BRANCH_CONFLICT);
    // A refused branch is NEVER handed off for merging.
    expect(conflicting.prRequired, "a conflicting branch was handed off for a PR").toBe(false);
  });

  it("an unreadable existing record is a conflict, not a coincidence", () => {
    const run = runCli(["--expected-record", writeRecord("e.json", record()), "--existing-record", path.join(os.tmpdir(), "definitely-absent-epoch.json")]);
    expect(run.status).toBe(1);
    expect(run.state).toBe(handoff.STATE.EPOCH_BRANCH_CONFLICT);
  });
});

// =============================================================================================
// The consumer: the handoff must be actionable by the App identity, and by nothing else
// =============================================================================================

describe("Trust finalization handoff consumer: the App transport can act on it, and the workflow cannot", () => {
  /**
   * The repair moves PR transport from the Actions `GITHUB_TOKEN` to the Codex-Boss App identity. That is only a
   * repair if the App's production path can actually consume what the workflow writes, so this section binds the
   * two sides: the handoff's fields against the gateway's own method signature, and the dropped permission against
   * the guardian decision the App relies on.
   *
   * It is static on purpose. The live App PR is opened during the epoch-28 ceremony and is recorded then; a unit
   * test that minted an installation token and opened a real pull request would be a network side effect in the
   * ordinary tier, which is the class of defect this same mission already had to repair once.
   */
  const GATEWAY_SOURCE = "electron/github/github-gateway.ts";

  it("the gateway exposes a pull-request path, and the handoff names exactly the fields it takes", () => {
    const source = fs.readFileSync(path.join(PROJECT, GATEWAY_SOURCE), "utf8");
    // The signature the consumer must satisfy: { head, base, title, body }.
    const signature = source.match(/createPullRequest\([^)]*\)\s*:\s*Promise<[^>]*>/);
    expect(signature, "the gateway no longer exposes createPullRequest").toBeTruthy();
    for (const field of ["head", "base", "title", "body"]) {
      expect(String(signature?.[0]), `the gateway's createPullRequest no longer takes ${field}`).toContain(field);
    }
    // The handoff carries every input that path needs: head from epoch_branch, base from base_branch. Title and body
    // are derived from the epoch, which the handoff also carries.
    const built = handoff.buildHandoff(handoffInput()) as Record<string, unknown>;
    expect(built.epoch_branch, "the handoff does not name the head branch the App must push").toBe("trust-epoch/boss-root-trust-28");
    expect(built.base_branch, "the handoff does not name the base branch").toBe("main");
    expect(typeof built.epoch, "the handoff does not carry the epoch the PR title derives from").toBe("number");
  });

  it("the App identity is the transport the handoff names, and it is a NAME rather than a credential", () => {
    // BOSS_GITHUB_LOGICAL_IDENTITY is the repository's own declaration of its machine identity. The handoff's
    // pr_creator must identify that machine path, and must never be a token, key or actor the workflow could use.
    const machine = require(path.join(PROJECT, "dist-electron", "src", "shared", "github-machine.js")) as { BOSS_GITHUB_LOGICAL_IDENTITY: string };
    expect(machine.BOSS_GITHUB_LOGICAL_IDENTITY, "the machine logical identity changed").toBe("Codex-Boss");
    const built = handoff.buildHandoff(handoffInput()) as { pr_creator: string };
    expect(built.pr_creator, "the handoff names a creator that is not the machine-identity path").toBe("codex-boss-machine-identity");
    expect(built.pr_creator).not.toMatch(/github-actions|GITHUB_TOKEN|ghs_|ghp_/i);
  });

  it("the guardian still ALLOWS the App to create pull requests, so the delegated path is not a dead end", () => {
    // If the guardian denied pull_request.create, the repair would have moved transport to a path that cannot act,
    // and the epoch would again end with a produced branch and no PR. This asserts the delegated path is live.
    const policy = require(path.join(PROJECT, "dist-electron", "electron", "github", "github-guardian-policy.js")) as {
      decideGitHubOperation: (operation: string) => { decision: string; reason: string };
    };
    const decision = policy.decideGitHubOperation("pull_request.create");
    expect(decision.decision, `the App's pull-request path is not ALLOW: ${decision.reason}`).toBe("ALLOW");
    // ...and the path the workflow must NEVER take is the one it lost: it holds no pull-request authority at all.
    const perms = parsedWorkflow().permissions ?? {};
    expect(perms).not.toHaveProperty("pull-requests");
  });

  it("the handoff is refused when the epoch branch and the epoch disagree, so the App cannot open a PR on the wrong head", () => {
    // The consumer keys the PR head off epoch_branch. If the two fields drifted apart, the App would open a pull
    // request against a branch that does not match the epoch being finalized.
    const drifted = handoff.buildHandoff(handoffInput({ epochBranch: "trust-epoch/boss-root-trust-27" }));
    const result = handoff.validateHandoff(drifted);
    expect(result.ok, "a handoff whose branch disagrees with its epoch was accepted").toBe(false);
    expect(result.problems.join(" ")).toMatch(/disagrees|does not match/);
  });
});
