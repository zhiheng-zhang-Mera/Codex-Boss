#!/usr/bin/env node
/**
 * Generate `config/test-catalogue.json` (Phase 05, Task B).
 *
 * ## Why a generator, and why a `--check` mode
 *
 * The catalogue must account for EVERY test file: a file that no entry names is invisible to the
 * impact selector, so a change to what it guards would select nothing. Hand-maintaining 205 entries
 * would rot silently, so the catalogue is generated from evidence and then READ:
 *
 *   - `covers` for the 148 suites that import a capability's modules is DERIVED from those imports;
 *   - the remaining 57 are assigned by the curated table below, each with the capability whose code
 *     they actually exercise;
 *   - `tier` follows the directory the suite lives in, which is also what the vitest tier configs
 *     already key on.
 *
 * `--check` re-derives everything and fails if the committed file differs, so the catalogue cannot
 * drift from the tree without the build saying so.
 *
 * Run: node scripts/generate-test-catalogue.cjs [--check]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "config", "test-catalogue.json");

/**
 * Normalise line terminators to LF, changing nothing else.
 *
 * `--check` compares the committed file with the serialisation this script would write, and this script
 * writes LF. On a checkout with `core.autocrlf=true` git leaves CRLF in the working tree, so the bytes
 * differ while the CONTENT is identical, and the check used to report drift that did not exist. Measured
 * at the Phase 08 sealed head: committed blob 38 955 bytes / 1 838 LF, working file 40 793 bytes /
 * 1 838 CRLF, delta exactly one byte per line, identical after this normalisation.
 *
 * It touches ONLY the line terminator, so the comparison stays an exact content comparison: a missing,
 * extra, reordered or altered suite, and any intra-line whitespace change, all still differ and still fail.
 */
function normaliseEol(text) {
  return text.replaceAll("\r\n", "\n");
}

/**
 * Prove the `--check` comparison behaves. Run: `node scripts/generate-test-catalogue.cjs --self-check`
 *
 * Exits non-zero on any failure, so this is a real check and not a printout. It lives here rather than in
 * a test file because a new test file is itself a catalogue entry, and enlarging the catalogue to test the
 * catalogue's own check is the wrong trade.
 *
 * Each case pins the NARROWNESS of the normalisation: a CRLF checkout must pass, and nothing else may.
 */
function selfCheck() {
  const canonical = `${JSON.stringify({ $comment: "…", suites: [{ file: "tests/unit/a.test.ts", tier: "unit", covers: ["runtime"] }] }, null, 2)}\n`;
  const asCrlf = (text) => text.replaceAll("\n", "\r\n");
  const passesCheck = (candidate) => normaliseEol(candidate) === normaliseEol(canonical);
  const cases = [
    ["identical catalogue in LF passes", passesCheck(canonical), true],
    ["identical catalogue in CRLF passes", passesCheck(asCrlf(canonical)), true],
    ["a changed field fails", passesCheck(canonical.replace('"runtime"', '"promotion"')), false],
    ["a missing suite fails", passesCheck(`${JSON.stringify({ $comment: "…", suites: [] }, null, 2)}\n`), false],
    ["an extra suite fails", passesCheck(canonical.replace('"suites": [', '"suites": [{ "file": "tests/unit/b.test.ts" },')), false],
    ["reordered suites fail", passesCheck(canonical.replace('[', '[\n').replace('{ "file": "tests/unit/a.test.ts", tier: "unit", covers: ["runtime"] }', '')), false],
    ["intra-line whitespace fails", passesCheck(canonical.replace('"tier": "unit"', '"tier":  "unit"')), false]
  ];
  const failures = cases.filter(([, actual, want]) => actual !== want);
  for (const [name, actual, want] of cases) {
    process.stderr.write(`  ${actual === want ? "ok  " : "FAIL"} ${name}${actual === want ? "" : ` (got ${actual}, want ${want})`}\n`);
  }
  process.stderr.write(failures.length === 0 ? "  catalogue check self-test: all cases passed\n" : `  catalogue check self-test: ${failures.length} case(s) failed\n`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

/**
 * Suites whose imports do not reach a capability's modules, mapped by what they actually exercise.
 *
 * Every entry here is a claim about which capability's behaviour the suite is evidence for. The
 * `alwaysRun` flag marks the suites that guard the platform machinery ITSELF — the architecture
 * contract, the selector, and the test taxonomy — because a change anywhere can invalidate them and
 * their whole purpose is to notice exactly that.
 */
const CURATED = {
  // --- the platform contract: guards the foundation, not one capability's behaviour.
  "tests/unit/platform/dependency-graph.test.ts": { covers: ["runtime"], obligation: "capability dependency graph is acyclic and its impact radius is complete", alwaysRun: true },
  "tests/unit/platform/capability-manifest.test.ts": { covers: ["runtime"], obligation: "a capability manifest is validated before it can join the graph", alwaysRun: true },
  "tests/unit/platform/state-ownership.test.ts": { covers: ["runtime"], obligation: "one authoritative owner per durable namespace", alwaysRun: true },
  "tests/unit/platform/architecture-ratchet.test.ts": { covers: ["runtime"], obligation: "the architecture ratchet measures the real tree", alwaysRun: true },
  // Phase 0 (Capability City): the real-source observatory guards the MEASUREMENT layer every other
  // architecture claim rests on, so it is always-run like the ratchet it is compared against. The suite
  // drives the shipped command rather than a copy of it, and its specification is
  // docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md.
  "tests/unit/city/architecture-observatory.test.ts": { covers: ["runtime"], obligation: "the real-source observatory scans Git-tracked source independently of the manifest declarations, retains every resolved internal edge including edges onto UNDECLARED targets, keeps the persistence to runtime-intelligence live-capture dependency observable, is deterministic across runs, and passes all six required falsification classes OBS-01..OBS-06", alwaysRun: true },
  // Phase 1A: prospective enforcement. Always-run for the same reason as the ratchet and the observatory — every
  // other suite's green depends on the measurement and policy layer underneath it being honest.
  "tests/unit/city/architecture-enforcement.test.ts": { covers: ["runtime"], obligation: "prospective enforcement grandfathers inherited relations by identity while refusing new undeclared debt: ENF-01..ENF-18 cover grandfathering, debt reduction, reintroduction-is-new, new undeclared source and endpoints, same-capability and cross-capability authorization, ownership conflict, sensor incompleteness failing closed, non-source-asset classification, shadow and enforce sharing one evaluator, deterministic ordering, byte-identical baseline regeneration, count-compensation refusal, and engine errors failing closed in both modes", alwaysRun: true },
  // Phase 1B-A: the governance foundation. The baseline authorisation suite is always-run for the same reason
  // the ratchet and the enforcement suites are — it decides whether the baseline those suites enforce against is
  // allowed to govern at all, and a laundering path it failed to close would make every other green meaningless.
  "tests/unit/city/architecture-baseline-authorization.test.ts": { covers: ["runtime"], obligation: "a baseline governs only when an Owner-authorised series entry names its exact (version, parent, hash) triple: the A1..A8 laundering attacks — unauthorised regeneration, hand-edited hash, absent series entry, version reuse, skipped version, wrong parent, reintroduced or forgotten retirement, expanded NOT_YET_ENFORCED and count compensation — are each refused with their own machine code, an unauthorised injected baseline fails closed in BOTH modes, the governing check cannot be redirected to a caller-supplied series, a placeholder reason cannot produce a baseline, candidate output governs nothing, and the tracked baseline is byte-identical after the suite runs", alwaysRun: true },
  // Phase 1B-A: the boundary half. Always-run because it is the check that the judge is Owner-bound in BOTH the
  // compiled manifest and the real .github/CODEOWNERS, and that the boundary did not swallow the repository.
  "tests/unit/city/architecture-governance-boundary.test.ts": { covers: ["runtime"], obligation: "the architecture judge, its two committed baselines and its authorising series are Owner-Authority in the trust classifier, in the compiled protected-surface manifest and in the real .github/CODEOWNERS parsed with GitHub matching semantics; each is inside the Root Trust Surface and moves the epoch aggregate when one byte changes; an ordinary product file neither moves the aggregate nor requires Owner review; and the machine may DERIVE the next epoch (parent-linked, anchoring the extended surface) while writing nothing", alwaysRun: true },
  // Phase 1B-B: the hosted shadow deployment. Always-run for the same reason the other city suites are — it is
  // the only mechanical check that the `architecture` check identity exists on both events, that the hosted gate
  // is NOT required, and that the shadow job fails closed on broken machinery while staying report-only for
  // policy. A rename or a filter here would silently remove the check the ruleset will later name.
  "tests/unit/city/architecture-hosted-shadow.test.ts": { covers: ["runtime"], obligation: "the hosted `architecture` job is visible and cannot disappear (H1..H7: the exact check identity, no paths filter, no branches filter, no conditional, both push and pull_request, the mandated checks in the specified order, no baseline widening, a narrow evidence artifact that excludes every corpus root, and no required-architecture context in the ruleset), shadow is not ignore-errors (S1..S6: an unauthorised baseline series, a baseline that does not re-derive from the tree, an engine error and an incomplete sensor each FAIL the job while an ordinary policy violation is merely reported and exits 0, proven against the discriminator that the engine's own shadow mode would have exited 0 on the same input), and parity is by finding identity rather than count (P1..P3: one normalized schema, an order-independent deterministic semantic digest, and a count-preserving subject mutation that a count-based comparison would have called a pass), together with a negative control that the legacy ratchet stays required in the quality job, that no ordinary job became dependent on the new one, and that no epoch was advanced", alwaysRun: true },
  // Phase 1B stage S2: hosted enforce, visible and still NOT required. Always-run because it is the mechanical
  // guard for the three properties S2 activation depends on — the check stays non-required, shadow is not
  // replaced by enforce, and the two modes provably share one finding identity (ENF-12).
  "tests/unit/city/architecture-s2-hosted-enforce.test.ts": { covers: ["runtime"], obligation: "S2 adds the real governing enforce evaluation to the hosted `architecture` job without making it required: the job keeps no needs/if/paths/branches, no ordinary job gates on it, no `continue-on-error` or `always()` can hide an enforce failure, and the legacy ratchet stays in the required quality job; shadow is provably NOT replaced (the shadow step, the hosted runner and both baseline checks survive beside the new enforce step, which writes to its own output directory so the modes cannot overwrite each other and the parity comparison cannot compare a file with itself); and the ENF-12 identity holds through the shipped comparator — shadow and enforce produce byte-identical findings on the same fixture and differ ONLY in exit behaviour (policy violation: shadow 0, enforce non-zero), while an unauthorised baseline series, an incomplete sensor and an engine error fail BOTH modes, parity is by identity and multiplicity rather than count, and a missing or unreadable parity input is PARITY_NOT_MEASURED and fails rather than passing", alwaysRun: true },
  // Phase 1B-B repair: the baseline gate's INTEGRITY is not the candidate tree's IDENTITY. Always-run because it is
  // the mechanical guard for the split that makes a prospective architectural change — and therefore the S2 negative
  // control — classifiable at all: while the two questions were one boolean, the hosted job failed at the baseline
  // step before shadow and enforce could run, so no undeclared edge could ever be observed being blocked.
  "tests/unit/city/architecture-baseline-integrity-split.test.ts": { covers: ["runtime"], obligation: "the baseline gate answers integrity and tree identity as separate questions: an untouched tree is valid and reproduces the frozen baseline; a self-consistent baseline whose edge set legitimately differs from the tree (debt reduction, an added declared edge, an undeclared new edge) is VALID as an artifact and is NOT a gate failure, because the candidate comparison is prospective enforcement's input rather than its verdict; the exit code is a conjunction of artifact integrity and series authorisation ONLY, so candidate-tree drift cannot fail the step; the check is read-only and leaves the tracked baseline byte-identical, which is what lets a declaration repair be baseline-unchanged; and tamper detection survives the split, with an edge added or removed without re-hashing, a forged baseline_hash, a tampered count, a tampered ownership map and malformed JSON each failing closed while an untouched copy still passes, and a missing, malformed or non-naming series still refusing rather than reading as empty", alwaysRun: true },
  // Mission-4D repair: a live network probe inside a unit test must be bounded below the enclosing test timeout,
  // and must never let "I could not measure" read as "I measured". No network: every case injects its own runner.
  "tests/unit/city/architecture-hosted-shadow-live-probe.test.ts": { covers: ["runtime"], obligation: "the bounded live-ruleset probe cannot outlive the unit test that calls it (its bound is strictly below the 60s enclosing budget and is passed to the child process), and it classifies every unmeasurable outcome as LIVE_NOT_MEASURED with a named reason rather than hanging or reporting a measurement — a timeout, a missing `gh`, an unauthenticated `gh`, a non-zero exit, a signal kill, malformed JSON, a disabled probe, and a response for the wrong ruleset id each land there with no platform facts leaked; a genuinely readable response lands in LIVE_MEASURED and yields the required contexts, and the same probe reports architecture_required true when the ruleset really requires it, so the classification is a real fork rather than a constant; the diagnostic line distinguishes the two states so a green test can never be read as proof that the live platform was checked; and the hosted-shadow suite is pinned to consume the helper rather than spawning `gh` directly, while the measurement runners keep the long timeouts they legitimately need", alwaysRun: true },
  // Mission-4D transport hardening: the finalization workflow's terminal state must describe its CEREMONY, not its
  // PR transport, and PR transport must belong to the machine identity rather than to an over-scoped GITHUB_TOKEN.
  "tests/unit/city/trust-epoch-finalization-transport.test.ts": { covers: ["runtime"], obligation: "the Trust Epoch Finalization workflow is reduced to contents:write only (pull-requests:write, GH_TOKEN and `gh pr create` are gone, and no Owner credential, App private key, privileged trigger or administration endpoint replaces them), while its authority-preserving properties are proven intact — the protected boss-root-trust-owner environment, the refs/heads/main refusal, dispatch-only triggering, `--advance` followed by `--check`, the branch push with no direct main push or --force, and a bounded evidence upload; the commit step no longer stages the gitignored artifacts path, so its outcome no longer depends on the shell's native-command error preference; the terminal decision is exercised as a pure function and through the shipped CLI — NO_MIGRATION, EPOCH_BRANCH_READY and EPOCH_BRANCH_ALREADY_READY exit 0 while EPOCH_BRANCH_CONFLICT and an unreadable existing record exit 1 and are never handed off for a PR, a rerun onto a matching branch does not re-advance the epoch, and a ready handoff naming no commit is refused; and the machine-readable epoch-pr-handoff.json validates its binding to the run, base, epoch, branch and commit, is state-aware about which fields a non-producing run may omit, and refuses to carry credential material anywhere in the document", alwaysRun: true },
  // The dispatch-SHA binding of `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` §9 B1/B3: proven as a
  // counterfactual rather than as a spelling — the model reproduces the old shape (dispatch at A, main moves to B,
  // approval lands, the run follows main) and the workflow's own ref and assertion step are measured from the YAML.
  "tests/unit/city/trust-finalization-sha-binding.test.ts": { covers: ["runtime"], obligation: "the Trust Epoch Finalization checkout is bound to the dispatch SHA rather than to floating main: the old `ref: main` shape is reproduced as a counterfactual and shown unbound once main moves, the repaired `ref: ${{ github.sha }}` shape stays on the dispatch SHA for an arbitrary number of intervening main commits, and the workflow's own checkout ref is measured from the parsed YAML so a revert of either half fails; the fail-closed assertion step exists by name, compares `git rev-parse HEAD` against `${{ github.sha }}`, exits 1 with its own code, runs as the FIRST step after the checkout with nothing in between, and publishes both SHAs for the artifact; the main-only refusal still precedes the checkout; and the handoff states provenance.dispatch_sha and provenance.checked_out_sha, validates the STATED value so a literal \"main\" cannot masquerade as an absent binding, refuses a half-stated binding, refuses two SHAs that disagree — through the pure validator AND through the shipped CLI, which exits 1 rather than writing a valid-looking artifact — and stays honestly silent (validating, but reporting checkout_is_sha_bound false) for a caller that states no binding at all", alwaysRun: true },
  // The dispatch-helper hardening required by `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` §9 B2: a helper
  // that can write without an explicit confirmation is the defect this suite exists for. The dry-run property is
  // proven against a real child process with a WORKING fake executor injected through the helper's own command
  // route, so "the dry run did not dispatch" is a measurement rather than an assumption.
  "tests/unit/city/trust-epoch-dispatch-helper.test.ts": { covers: ["runtime"], obligation: "the trust-epoch dispatch helper cannot write without an explicit confirmation: the default mode and `--dry-run` plan no command at all, so `execute` — the only function that runs anything — is inert on a write-free plan, while a confirmed plan executes exactly the planned argv; the dry run exits 0 with nothing executed even though a WORKING fake executor is injected through the helper's own command route and demonstrably records invocations, and the same injection records exactly one dispatch on the confirmed path, which is what makes the dry-run proof non-vacuous; `--confirm` without reason, risk and rollback is refused as malformed with nothing dispatched, because the protected workflow declares all three as required inputs; a failing executor is reported as a refusal rather than as a submitted dispatch; the command is an argv array spawned without a shell, so an operator-supplied reason is never reinterpreted, proven against a shell that really does interpret the same text; the module spawns in exactly one place and the dry-run branch reaches neither the executor nor the runner; and `--json` emits the plan verbatim so a reviewer can diff what a confirmation would do", alwaysRun: true },
  // P2-A of `docs/city/PHASE2_ARCHITECTURE_MIGRATION_SPEC.md`: the two-ownership-model disagreement must be a
  // failing check rather than a footnote, so that adopting one model has a machine that can tell when it happened.
  "tests/unit/city/capability-closure-validator.test.ts": { covers: ["runtime"], obligation: "the capability closure validator passes on the committed tree and FAILS on a fixture that breaks exactly one rule, in both directions: it catches a declared module path that does not exist or that names a directory rather than a file, a bootModules/surface entry outside modules, a scanned source file owned by no capability and exempt from none, a file claimed by two capabilities, a file that is both owned and exempt, an exemption carrying no substantive reason, a capability declaring no provided id, a manifest absent from the ownership map, an ownership map naming a capability no manifest declares, and a declared module the declaring capability does not own; it reports every problem class at once rather than the first, so one broken tree cannot hide five defects; its path-matching rule mirrors the selector's directory-prefix rule exactly, so the two cannot disagree about coverage while both being defensible; and it is not satisfiable by emptying a manifest, because an unowned file stays unowned whatever any manifest declares", alwaysRun: true },
  // P2-A increment 2: the size of the P2-B/P2-C work list, measured before the migration starts, with the
  // instrument pinned to the repository's own edge definition so the work list and the ratchet measure one graph.
  "tests/unit/city/phase2-edge-inventory.test.ts": { covers: ["runtime"], obligation: "the cross-capability edge inventory agrees with the repository's own edge definition (a real import resolves through it, a bare package specifier stays unresolved rather than becoming an internal edge, and the ownership map's directory-prefix rule is mirrored so the work list and the selector cannot disagree), measures the real tree rather than a subset (hundreds of owned files, 27 capabilities, the declared-path deficit, hundreds of cross-capability edges over dozens of pairs, zero edges with both endpoints declared), names both classes the programme must drive to zero (kernel -> feature edges and mutual capability pairs, neither zero yet, every kernel -> feature pair starting with a kernel capability), and pins the state of the historical inversion electron/bootstrap/persistence.ts -> electron/runtime-intelligence/live-capture that the workbook forbids assuming away, so the case asserting it is still live is the case a repair must change deliberately rather than the number drifting silently; it also keeps the mutual-pair list a work list rather than a verdict by distinguishing a strongly asymmetric pair, which is usually a missing contract, from a genuine two-way cycle", alwaysRun: true },
  // Stage D: the S2 exit audit recomputes the exit claim from the real hosted history, so its parser and its
  // window arithmetic are the two places the claim could be manufactured rather than measured.
  "tests/unit/city/s2-exit-audit.test.ts": { covers: ["runtime"], obligation: "the Stage D S2 exit audit reads the two lines the hosted `architecture` job publishes, and its two failure modes are pinned as failures: an ABSENT key is reported as null and NEVER as zero, because `ENGINE_ERRORS=0` is the strongest possible result while an unreadable line is the weakest and collapsing them would admit a run whose evidence never arrived as a clean run; and the digest set is reported in full rather than truncated to its first element, because \"same findings hash throughout\" is the claim under audit and a summariser that took the first digest would make it hold by construction; it also strips the workflow's `job<TAB>step<TAB>` prefix where the timestamp SHARES a field with the content, does not mistake the echoed Write-Host source for the printed result, refuses a run without naming the machinery that failed (a skipped or failed `architecture` job, a missing or failed ENF-12 parity step, a missing evidence line, a non-PASS verdict, a policy violation, an engine error, or a line carrying no digest), counts the streak from the newest run and STOPS at the first exclusion rather than counting all valid runs, distinguishes an empty window from a constant one so an empty window cannot pass vacuously, counts retries and flakes separately, judges an unfinished run neither valid nor excluded so a pending run at the head of the window cannot understate it, and is proven read-only: its only `gh` verbs are reads and the case fails if a write, re-run, dispatch, cancel, merge, close, edit or create is ever added", alwaysRun: true },
  // P2-B/P2-C: the regression floor over the REAL graph, which the manifests-only legacy ratchet cannot see.
  "tests/unit/city/p2b-kernel-feature-ratchet.test.ts": { covers: ["runtime"], obligation: "the P2-B/P2-C regression ratchet holds on the committed tree and refuses a report that violates exactly one recorded value, so it is shown to ratchet rather than only to pass: a new kernel -> feature edge, a new kernel -> feature pair and a new mutual capability pair each fail with the value, the recorded floor and the ownership model named, and every problem names the model because neither number means anything without it; the ANTI-GAMING floors matter most and each is exercised, because a fall in the edge count that comes from scanning fewer files is not progress -- fewer owned files, a kernel that lost its kind and a hidden composition root each fail, and the composition root being counted as a kernel is refused outright, which is the exact shape the re-attribution in CC-023 removed; a measurement that cannot be compared fails closed rather than treating a missing number as an improvement, since a ratchet whose comparison no-ops on undefined reports HOLDS for a report it could not read; improvements are reported with the artifact to edit so lowering the floor is the obvious next act rather than a discovery, a rise is never called an improvement and a rise in a FLOOR is neither; the committed artifact names its ownership model, its measurement command, its reason, its two zero targets and the kernels it measured; and the JUDGE is kept separate from the INSTRUMENT -- the inventory keeps its stated boundary of not deciding whether an edge is a defect, holds no threshold and names no ratchet artifact, while the ratchet itself stays read-only and loadable by plain node", alwaysRun: true },
  "tests/unit/platform/platform-health.test.ts": { covers: ["runtime"], obligation: "a missing optional capability degrades locally instead of failing the platform", alwaysRun: true },
  // P2-F: the canonical city state registry, and the cross-check that stops it being self-serving.
  "tests/unit/city/city-flatness-validator.test.ts": { covers: ["runtime"], obligation: "the city flatness registry passes with exactly one state per plot derived from the MANIFESTS rather than authored, and SEAL MODE correctly FAILS because section 20 permits only FLAT at the seal -- the honest state of a programme mid-migration; the cross-check is the gate: a plot a measured defect implicates may not be recorded FLAT, and the cases prove it by INJECTING reports that implicate a plot the committed registry calls FLAT, naming the plot and the reason in the failure, while the same report implicating an already-migrating plot passes so the check is specific rather than blanket; the instrument's one weakness is recorded and closed by a case -- the cross-check is circular in one direction because the registry was authored FROM the instruments, so an instrument that under-reports shrinks both sides together, and a mutation dropping one side of every private-state access was caught by only one case until the expected members were pinned BY NAME, including host-status, the workbook's own historical example, which is implicated ONLY by that instrument; and every section 20 obligation is failed on a fixture that breaks exactly it -- a capability with no state, an entry naming no declared capability, a state outside the five, MIGRATION_IN_PROGRESS with no migration, a migration naming an undeclared stage, a migration with no substantive source or target, PARTIALLY_DEGRADED without a declared missing element, TEMPORARILY_BRIDGED naming no declared bridge, a bridge missing an obligation, an orphan bridge, a bridge whose record or test file does not exist, and an entry that states no reason; the plot set is derived from the manifests so a new capability cannot go unregistered, the CLI can never reach the fixture seam because the seal decision must rest on the tree, and the registry says out loud that FLAT is not a certification", alwaysRun: true },
  // P2-I: the enforcement matrix for principles 15.1-15.9, and the falsification of every rule that stops it
  // promoting a ratchet into an enforcement.
  "tests/unit/city/principle-enforcement-validator.test.ts": { covers: ["runtime"], obligation: "the principle enforcement matrix is DATA rather than prose precisely because a matrix written as prose can claim anything, and the specific forgery section 23 invites is PROMOTION -- recording MACHINE ENFORCED beside a principle whose only guard is a regression ratchet, so that the count cannot silently grow back is written down as the count is zero; so no measurement is typed into the matrix at all: each row names a resolution KEY, and the validator resolves the live value from that guard own JSON output, which is why the drift this artifact is exposed to is impossible rather than merely untested, asserted by a case that every key the file names is a registered key, that no measured field exists anywhere in it, and that every target in it is zero; the cases build a matrix that breaks each rule and assert the rejection -- a principle with no row, a duplicated row, an invented 15.10, a strength outside the four, a row whose strength falls short of what section 23 asks without saying why, a guard that does not exist, a guard whose source writes to the tree, a guard that exits non-zero, a test that mentions none of the guards it is cited for, a guard no cited test reaches, MACHINE_ENFORCED whose measurement is above its target, MACHINE_ENFORCED with a non-zero target, a RATCHET whose measurement REACHED its target and must therefore be promoted, a key no instrument publishes, a key read from a guard the row did not name, a machine claim with nothing to measure it against, EVIDENCE_REQUIRED with no record, with an insubstantial evidence requirement and with a record that does not exist, and NOT_GUARDED that does not name the stage owning its gap; and against the real tree it asserts the honest distribution -- three enforced, two ratchets, two evidence-required and two unguarded -- that the five cited guards are read-only and exit zero when run directly, that the generated document table is identical to the table the validator generates, and that the three unguarded principles stay named rather than left to inference; the document-currency comparison is asserted to be LINE-ENDING AGNOSTIC in one case and to STILL FAIL on a one-character change in the same case, because the table is generated with LF while git checks the document out with CRLF -- which is how the FIRST CI RUN of this stage failed, on a check that passed on the machine that wrote the file and failed on the runner that verified it (ledger CC-034)", alwaysRun: true },
  // P2-E: the road class, and the falsification of every rule that stops it being a way to move a number.
  "tests/unit/city/capability-roads-validator.test.ts": { covers: ["runtime"], obligation: "the road class is the cheapest way in this programme to make a metric move without repairing anything -- attribute an edge to the road class and a kernel stops depending on a building with no code change -- so a declaration must pass a NECESSARY condition the machine checks and a SUFFICIENT one it cannot; the necessary condition is LEAFNESS (imported across a capability boundary by two or more capabilities and importing NO other capability), which is ledger CC-030 refutation made executable, and the cases break it by declaring the shared sink that reaches nine capabilities; the sufficient condition is that the file carry NO POLICY OF ITS OWN, which cannot be automated without pretending to solve a semantic judgement, so the machine enforces the EVIDENCE -- five substantive proofs per road and a REFUTATION RECORD for the candidates that pass the leaf test and are still refused, with a case proving a refutation is rejected when the file is not a leaf or has a single consumer, because a record that records nothing is not evidence; leafness is NECESSARY AND NOT SUFFICIENT and that is the finding rather than a caveat: the committed artifact refuses src/shared/execution.ts, a leaf imported by four capabilities that exports reviewResponse and defaultReviewPolicy which DECIDE an outcome, and src/shared/permission.ts, a leaf that exports the security decision procedure; the remaining cases refuse a road owned by a KERNEL (already foundation, so declaring it a road moves nothing -- a gap the first version of the validator had and the falsification case found), a road owned by no capability (not trapped in a building), one whose declared owner disagrees with the ownership map, one that is also a composition-root file, one missing each of the five proofs in turn, one citing a ledger entry that does not exist, a classification too thin to be a rule, and a file declared a road and refuted at once; against the real tree it asserts two leafless roads with at least two consumers each, two real refutations that both PASS the leaf test, zero edges leaving a road, and that every road carries an exit condition naming the extraction that removes the declaration -- with the ratchet flooring road_files and edges_to_roads so a declaration cannot be withdrawn to push its edges back into a building column", alwaysRun: true },
  // P2-E decision input: the per-pair edge inspector, and the cross-check that makes it usable.
  "tests/unit/city/phase2-pair-edges.test.ts": { covers: ["runtime"], obligation: "the pair inspector decomposes the inventory per pair WITHOUT disagreeing with it, which is the whole point: the counts are what CI enforces, so an inspector that counted differently from the ratchet would be worse than useless, and --verify therefore re-derives the whole graph and asserts equality with the inventory on every total and all 193 pair counts; that gate failed on its FIRST run and the failure was real -- 867 edges against 801 and 84 kernel -> feature against 73 -- because the inventory unit of measurement is a (source file, distinct SPECIFIER) pair rather than an import statement, so a file importing the same module twice, once as a type and once as a value, is ONE edge, and section 16 target of zero is in that currency; the cases then falsify the gate itself rather than trusting it -- an edge dropped or invented must fail it, and a single PAIR count drifting while the total is unchanged must fail it -- after the first version of verify was found to compare the scan own summary instead of re-summarising the edge list it was handed, which is the same class of error as a check that watches the wrong artifact; the currency is pinned as an invariant, every edge is asserted to join two different capabilities with a real target and a positive line, the closure function is asserted to report a common directory ONLY when the targets share one, a named pair prints its edges with line and specifier while a non-existent pair says so, the work list is reported in the inventory currency, and the leaf marking is asserted to follow the measurement in BOTH directions -- a target imported by two or more capabilities is listed, a target with exactly one importer is not, and the list is therefore about sharing rather than popularity -- with two members pinned BY NAME: the shared sink reaching nine capabilities is NOT a leaf, while the popular leaf owned by tenx IS", alwaysRun: true },
  // P2-H: the Core growth ban -- a stable classification, a surface pinned by name, and a budget whose ceiling
  // does not ratchet down.
  "tests/unit/city/core-budget-validator.test.ts": { covers: ["runtime"], obligation: "the Core growth ban is enforced over a STABLE CLASSIFICATION -- a capability is Core if and only if its manifest declares kind: kernel, measured through the closure validator own scan set and ownsPath rule so the two instruments cannot disagree about which capability owns which file -- and the starting surface is four capabilities owning 115 of the 596 capability-owned files across 614 scanned source files, with the composition root counted on its OWN line so shared machinery cannot drift into Core; the first measurement of this artifact counted the ownership map ENTRIES and produced 271, a number that looks like a size and is not one because the map stores 271 patterns that expand to 596 files, which is why the recorded size is in the currency the P2-B/P2-C ratchet already uses; the four names are PINNED, because a count would still read four if a kernel lost its kind and an unrelated capability gained one, and the cases break each rule in turn -- a pinned name that is no longer Core, a fifth Core capability no exception names, growth with no exception, growth beyond the recorded allowance, growth hidden in the composition root, a fall in each of the three floors because a smaller measurement is not a smaller Core, an exception missing its identity or allowance or debt id or exit condition or Owner authorization, an exception that fails to answer EACH of section 22 four questions, an exception citing a ledger entry that does not exist or whose entry does not mention it, a duplicated exception id, an unstated or contradictory classification, and a starting baseline naming no ledger entry or one the ledger lacks; the ceiling deliberately DOES NOT ratchet down -- a case proves that a fall in Core buys nothing by rebounding to the starting size plus one and being refused -- and the starting measurement is anchored to an append-only ledger entry so re-recording the baseline is a visible act rather than an edit to a number; against the real tree it measures 115 files, passes with zero growth and zero unexcused growth, and the artifact says out loud that what is proved is the BAN, since no exception has ever been recorded and the Owner-approval path is exercised only on fixtures", alwaysRun: true },
  // P2-D: the private-state validator, and the three rules it had to be corrected through before it found the
  // defect the workbook names.
  "tests/unit/city/phase2-private-state.test.ts": { covers: ["runtime"], obligation: "the cross-domain private-state validator measures a PATH into another capability durable state rather than a mere name, and its cases pin the three rules that had to be corrected before it was right: a declared namespace matched as a quoted string is NOT an access -- a SKIP set, a fleet-aggregate field and a component id were all false positives -- so the rule is a path join whose LAST segment is a declared namespace; a path join is not always durable state, so a join carrying a durable-root marker is CONFIRMED while a session own artifacts subdirectory and a fault-lab sandbox directory stay in a SEPARATE unclassified tier with a recorded reason each, because counting them would make the number depend on how many directories happen to share a namespace name; and the durable-root marker list was too narrow, because host-status reaches the task ledger through a local name bound to the durable root, so the workbook own historical example classified as unclassified until the ROOT indirection was resolved -- the same one-level indirection as the namespace constant; on the real tree it finds FIVE confirmed accesses over THREE pairs, all into one namespace, including the historical example, and every confirmed access is asserted to cross a real declared ownership boundary; the ratchet refuses a rise in accesses, pairs, the TOTAL join count and the unclassified tier, refuses a fall in the declared-namespace and scanned-file floors, fails closed when a value cannot be compared, and reports a fall as the improvement to record; the TOTAL ceiling exists so an access cannot hide by being unclassifiable; and the artifact records its model, command, reason, zero target and an explicit NOT CLAIMED note that read-versus-write is not statically decidable, machine-enforcing the declared single-owner property instead", alwaysRun: true },
  // P2-A step 3a: the provider closure moved out of a shared bundle, and the ONE-symbol bridge that lets the
  // Root Trust Surface stay put while it does. A split is only a repair if every importer moves with it.
  "tests/unit/city/provider-closure.test.ts": { covers: ["runtime"], obligation: "the provider contract closure owns its own types and no importer was left behind: the new module exports every moved symbol, contracts.ts no longer DECLARES any of them, and the new module deliberately does NOT import contracts.ts because a back-edge would make the two shared modules mutually dependent and raise the providers/status mutual pair the P2-C ratchet guards; the specifier is RESOLVED against the importing file rather than suffix-matched, because a file inside src/shared writes ./contracts and a suffix test on the raw specifier silently misses every straggler in the same directory as the module -- the first version of this helper did exactly that, and a deliberately reverted import was NOT caught until the resolution was added; no electron/ or src/ file still routes a moved type through the old module, and the ONLY remaining importers are exactly the five bridged Root Trust suites, asserted as an exact set so that a new straggler and a silently retired bridge both fail; the bridge is a single re-export statement exactly one symbol wide with ProviderId alone, its id appears in the source where the constraint applies, and it is declared in a tracked document carrying BRIDGE_ID, OWNER, REASON, SOURCE, TARGET, EXIT_CONDITION, DEADLINE/PHASE and TESTS, with a stated exit rather than an implied one and a TESTS field naming a file that exists", alwaysRun: true },
  "tests/unit/platform/test-impact.test.ts": { covers: ["runtime"], obligation: "the impact selector picks the affected suites, fails closed, and its audit detects what it dropped", alwaysRun: true },
  "tests/unit/sandbox-toolchain-materialization.test.ts": { covers: ["promotion"], obligation: "the sandbox materializes the smallest readable toolchain into the user-owned candidate tree, content-addressed so a stale copy cannot mask a changed source" },
  "tests/unit/sandbox-failure-cleanup.test.ts": { covers: ["promotion"], obligation: "the launcher cannot drift from its canonical C# source, and an induced failure releases its drive mapping and request artifacts" },
  "tests/unit/sandbox-capability-preflight.test.ts": { covers: ["promotion"], obligation: "available:true means the production sandbox path is reachable, and every refusal carries a stable reason code" },
  "tests/unit/platform/external-compatibility.test.ts": { covers: ["providers"], obligation: "a single external dependency degrading stays local, is classified honestly, and reroutes or refuses accordingly" },
  "tests/unit/platform/scale-synthetic.test.ts": { covers: ["state-core"], obligation: "the platform holds at 10x its capability set without inconsistency or cross-project contamination, and a failed transaction at volume leaves the journal untouched" },
  // PF-DEBT-019: the durable-event contract, split into the two evidence classes the tiering decision
  // created. The bounded one is hosted required-CI correctness evidence; the 100k one is the scale claim,
  // and it runs on the controlled real host under the REAL_HOST_SCALE execution tier — never in public CI.
  "tests/unit/platform/durable-event-correctness.test.ts": { covers: ["state-core"], obligation: "the durable-event contract — durability across close/reopen, strictly monotone sequence, no loss or repeat across a paged readback, per-aggregate ordering, the UNIQUE(producer, idempotency_key) contract returning the ORIGINAL durable row, stats/head and rollback atomicity — holds at a bounded volume a shared hosted runner can decide, which is correctness evidence and explicitly NOT the 100k scale claim" },
  "tests/unit/platform/durable-event-real-host-scale.test.ts": { covers: ["state-core"], obligation: "100 000 durable events appended one commit at a time into a real database file, verified across a close and reopen: the scale claim, owned by the REAL_HOST_SCALE execution tier and executed by the private real-host control plane rather than by any workflow in this public repository" },
  "tests/unit/platform/platform-soak.test.ts": { covers: ["state-core"], obligation: "the platform runs its whole lifecycle for the tier's duration with bounded resources and no unattended failure" },
  // PF-DEBT-018: the provenance record may report only what it measured. v1 carried `runner.labels` read from
  // a variable GitHub Actions does not define; v2 removes the field, and these tests keep it from coming back.
  "tests/unit/platform/qualification-provenance.test.ts": { covers: ["state-core"], obligation: "the corpus provenance record contains only runner facts the job measured: schema 2 has no runner.labels at all, a forged RUNNER_LABELS value cannot appear anywhere in the machine record, the redacted form leaks no corpus path or content, and the corpus commitment is independent of runner metadata" },
  "tests/unit/platform/provider-usage.test.ts": { covers: ["providers"], obligation: "real provider token usage travels the whole path to the durable ledger, and its absence stays unmeasured rather than becoming an estimate" },
  "tests/unit/platform/coordination-ledger.test.ts": { covers: ["tenx"], obligation: "coordination records are derived from the durable ledger reporting only observed figures, with unobservable ones left null" },
  "tests/unit/platform/coordination-economics.test.ts": { covers: ["tenx"], obligation: "an extra agent stage is promoted only on a measured defect or rework improvement, and never on an unobserved figure" },
  "tests/unit/platform/restart-recovery.test.ts": { covers: ["persistence"], obligation: "after a restart no committed work is lost and no external side effect is applied twice" },
  // Phase 07: the acceptance model decides whether a change satisfies the OBJECTIVE, not merely whether a
  // check passed. Always-run because every other suite's green is only as meaningful as this judgement,
  // and it guards a shared contract rather than one capability's behaviour.
  "tests/unit/platform/acceptance.test.ts": { covers: ["runtime"], obligation: "a claim is satisfied only by discriminating evidence, and a vacuous green test yields INSUFFICIENT_EVIDENCE rather than acceptance", alwaysRun: true },
  // Phase 07 Task D: the counterexample cases. The book is explicit that proving the good path is not the
  // work — the vacuous, contradicted and no-evidence cases are what the phase exists for.
  "tests/unit/engineering/goal-acceptance.test.ts": { covers: ["engineering"], obligation: "a change is judged by the evidence it carries: a vacuous green test and a change with no test are both INSUFFICIENT_EVIDENCE, and a representative non-empty case satisfies" },
  "tests/acceptance/targeted-vs-full.test.ts": { covers: ["runtime"], obligation: "the targeted selection and the same commit's full gate agree, and the pairing refuses when they do not" },
  "tests/acceptance/platform-soak-report.test.ts": { covers: ["state-core"], obligation: "the soak report covers every dimension the book names, declares what it cannot observe, and fails a run whose trend exceeds the allowance" },
  "tests/acceptance/platform-architecture-diagnostics.test.ts": { covers: ["runtime"], obligation: "the architecture CLI reports the same graph the registry builds", alwaysRun: true },
  "tests/acceptance/platform-certificate.test.ts": { covers: ["runtime"], obligation: "the platform certificate recomputes rather than transcribes, is honest about what has not run, and fails closed", alwaysRun: true },
  "tests/acceptance/architecture-discovery.test.ts": { covers: ["runtime"], obligation: "the built application's architecture evidence matches the source tree", alwaysRun: true },
  // --- the selector and the taxonomy it depends on: they must never be skippable.
  "tests/unit/test-layers.test.ts": { covers: ["runtime"], obligation: "the test layers and tiers agree with the declarations", alwaysRun: true },
  "tests/unit/export-surface.test.ts": { covers: ["runtime"], obligation: "no export is unreachable and unrecorded", alwaysRun: true },
  "tests/unit/repository-boundary-guards.test.ts": { covers: ["runtime"], obligation: "the renderer, the Electron side and src/shared do not import across their boundaries", alwaysRun: true },
  "tests/unit/process-gateway.test.ts": { covers: ["runtime"], obligation: "only the declared gateways import child_process", alwaysRun: true },
  "tests/unit/comment-citation.test.ts": { covers: ["runtime"], obligation: "comments citing a requirement cite one that exists", alwaysRun: true },
  "tests/unit/root-trust-authority-lockdown.test.ts": { covers: ["runtime"], obligation: "an autonomous actor may prepare a trust migration but can never authorize, self-sign or finalize one, while ordinary self-evolution stays autonomous", alwaysRun: true },
  // --- capability security (Phase 03)
  "tests/unit/capability/permission-contract.test.ts": { covers: ["security"] },
  "tests/unit/capability/boundary-integration.test.ts": { covers: ["security"] },
  "tests/acceptance/capability-escape.test.ts": { covers: ["security"] },
  "tests/acceptance/permission-surface-report.test.ts": { covers: ["security"] },
  "tests/acceptance/bootstrap-root-hardening.test.ts": { covers: ["security"] },
  "tests/acceptance/autonomous-evolution-trust.test.ts": { covers: ["security"] },
  "tests/unit/hardening-matrix-coverage.test.ts": { covers: ["security"] },
  "tests/unit/github-machine-identity.test.ts": { covers: ["security"] },
  // --- knowledge and data lifecycle (Phase 04)
  "tests/unit/knowledge/knowledge-lifecycle.test.ts": { covers: ["knowledge"], obligation: "knowledge carries provenance, goes stale deterministically, and GC never deletes protected evidence" },
  "tests/unit/knowledge-object.test.ts": { covers: ["knowledge"] },
  "tests/acceptance/data-lifecycle-report.test.ts": { covers: ["knowledge"] },
  "tests/acceptance/state-migration-report.test.ts": { covers: ["state-core"] },
  // --- durability and state
  "tests/unit/evidence-ledger.test.ts": { covers: ["persistence"] },
  "tests/unit/owner-dashboard.test.ts": { covers: ["persistence"] },
  "tests/unit/workbook-contract.test.ts": { covers: ["persistence"] },
  "tests/unit/workbook-hash.test.ts": { covers: ["persistence"] },
  // --- task lifecycle and routing
  "tests/unit/action-readiness.test.ts": { covers: ["tasks"] },
  "tests/unit/result-validator.test.ts": { covers: ["tasks"] },
  "tests/unit/work-escalation-verdict.test.ts": { covers: ["tasks"] },
  "tests/unit/owner-result-contract.test.ts": { covers: ["status"] },
  "tests/unit/state-waiting.test.ts": { covers: ["status"] },
  "tests/unit/capability-router.test.ts": { covers: ["providers"] },
  "tests/unit/autonomy-supervisor.test.ts": { covers: ["tenx"] },
  "tests/unit/candidate-gate.test.ts": { covers: ["promotion"] },
  "tests/unit/closure-terminal-logic.test.ts": { covers: ["engineering"] },
  // --- engineering loop
  "tests/unit/capability-gap.test.ts": { covers: ["engineering"] },
  "tests/unit/recovery-model.test.ts": { covers: ["engineering"] },
  "tests/unit/verification-ladder.test.ts": { covers: ["engineering"] },
  "tests/unit/version-impact.test.ts": { covers: ["engineering"] },
  "tests/unit/review-layer.test.ts": { covers: ["engineering"] },
  "tests/unit/self-healing-battery.test.ts": { covers: ["engineering"] },
  "tests/unit/research-battery.test.ts": { covers: ["research"] },
  "tests/unit/evolution-trial-surface.test.ts": { covers: ["promotion"] },
  "tests/unit/evolution-quiescence.test.ts": { covers: ["promotion"] },
  "tests/unit/self-evolution-production-defaults.test.ts": { covers: ["promotion"] },
  "tests/unit/self-target-resolver.test.ts": { covers: ["promotion"] },
  "tests/unit/repo-world-model.test.ts": { covers: ["workspace"] },
  "tests/unit/git-gateway.test.ts": { covers: ["persistence"] },
  // --- computer / provider page automation
  "tests/unit/dom-page.test.ts": { covers: ["providers"] },
  "tests/unit/provider-dom-surface.test.ts": { covers: ["providers"] },
  "tests/unit/provider-page-repair.test.ts": { covers: ["providers"] },
  "tests/unit/computer-recovery.test.ts": { covers: ["providers"] },
  "tests/unit/network-policy.test.ts": { covers: ["providers"] },
  "tests/unit/login-scan.test.ts": { covers: ["providers"] },
  "tests/unit/renderer-workspace-path-ui.test.ts": { covers: ["workspace"] },
  "tests/unit/tenx-phase-10a.test.ts": { covers: ["tenx"] },
  // --- evolution acceptance
  "tests/acceptance/autonomous-evolution-independent.test.ts": { covers: ["promotion"] }
};

function expandOwned(ownership) {
  const out = new Map();
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return [rel];
    if (fs.statSync(abs).isFile()) return [rel];
    const found = [];
    const stack = [abs];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const child = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(child);
        else if (/\.tsx?$/.test(entry.name)) found.push(path.relative(ROOT, child).split(path.sep).join("/"));
      }
    }
    return found;
  };
  for (const [capabilityId, paths] of Object.entries(ownership)) {
    for (const rel of paths) {
      for (const file of walk(rel)) {
        const base = file.replace(/\.tsx?$/, "");
        out.set(base, [...(out.get(base) ?? []), capabilityId]);
      }
    }
  }
  return out;
}

function discoverTests() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(child); continue; }
      if (/\.test\.tsx?$/.test(entry.name)) found.push(path.relative(ROOT, child).split(path.sep).join("/"));
    }
  };
  walk(path.join(ROOT, "tests"));
  return found.sort();
}

function tierOf(file) {
  if (file.startsWith("tests/acceptance/")) return "acceptance";
  if (file.startsWith("tests/unit/")) return "unit";
  return "integration";
}

function main() {
  if (process.argv.includes("--self-check")) return selfCheck();
  const ownership = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "capability-modules.json"), "utf8")).capabilities;
  const moduleToCapabilities = expandOwned(ownership);
  const tests = discoverTests();
  const problems = [];
  const suites = [];

  for (const file of tests) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const specifiers = [...text.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]);
    const derived = new Set();
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)).replace(/\.(ts|tsx|js)$/, "");
      for (const candidate of [base, `${base}/index`]) {
        for (const capabilityId of moduleToCapabilities.get(candidate) ?? []) derived.add(capabilityId);
      }
    }
    const curated = CURATED[file];
    if (derived.size === 0 && !curated) {
      problems.push(`${file} imports no capability module and has no curated entry`);
      continue;
    }
    // A curated entry is a deliberate narrowing: it names the capability the suite is evidence for,
    // which for a foundation suite is not the same as every module it happens to import.
    const covers = curated ? [...curated.covers].sort() : [...derived].sort();
    const entry = { file, tier: tierOf(file), covers };
    // The tier is escalated to the strongest one the file's own name implies; a suite living under
    // tests/acceptance/ that the tier config runs after a build is `integration` in practice.
    if (file.startsWith("tests/acceptance/")) entry.tier = "acceptance";
    if (curated?.obligation) entry.obligation = curated.obligation;
    if (curated?.alwaysRun) entry.alwaysRun = true;
    suites.push(entry);
  }

  if (problems.length > 0) {
    process.stderr.write(`the catalogue cannot account for ${problems.length} test file(s):\n  ${problems.join("\n  ")}\n`);
    process.exitCode = 1;
    return;
  }

  const document = {
    $comment: "Phase 05 Task B: which capability each test suite is evidence for, and which invariant it is the authority on. Generated by scripts/generate-test-catalogue.cjs; run it with --check to prove this file still describes the tree.",
    suites
  };
  const serialised = `${JSON.stringify(document, null, 2)}\n`;

  if (process.argv.includes("--check")) {
    if (!fs.existsSync(OUT)) { process.stderr.write("config/test-catalogue.json is missing\n"); process.exitCode = 1; return; }
    const current = fs.readFileSync(OUT, "utf8");
    if (normaliseEol(current) !== normaliseEol(serialised)) {
      process.stderr.write("config/test-catalogue.json has drifted from the tree; run `node scripts/generate-test-catalogue.cjs`\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`test catalogue is current: ${suites.length} suites\n`);
    return;
  }

  fs.writeFileSync(OUT, serialised, "utf8");
  const byTier = suites.reduce((counts, suite) => ({ ...counts, [suite.tier]: (counts[suite.tier] ?? 0) + 1 }), {});
  const always = suites.filter((suite) => suite.alwaysRun).length;
  const obligations = new Set(suites.map((suite) => suite.obligation).filter(Boolean));
  process.stdout.write(`wrote config/test-catalogue.json\n`);
  process.stdout.write(`  ${suites.length} suites (${Object.entries(byTier).map(([tier, count]) => `${tier}=${count}`).join(" ")})\n`);
  process.stdout.write(`  ${always} always-run, ${obligations.size} declared obligation(s)\n`);
  const covered = new Set(suites.flatMap((suite) => suite.covers));
  process.stdout.write(`  ${covered.size} of ${Object.keys(ownership).length} capabilities covered\n`);
}

main();
