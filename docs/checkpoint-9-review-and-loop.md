# Checkpoint 9 — Implementation Loop (§30) + Multi-Layer Review (§32)

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`).

Source plan: `Update-Plan/checkpoint-1.md` §30 (Phase 5 — Implementation Loop)
and §32 (Phase 7 — Multi-Layer Review). This record states what exists, what was
proved, and what remains honestly open.

## What the plan demands

| Plan clause | Requirement |
| --- | --- |
| §30 (cycle) | Plan → Worker → Host Verification → Review → Repair → Reverify. |
| §30.1 | A worker has a scope: allowed files, allowed commands, workspace, requirement ids. |
| §30.2 | After every claimed change the host verifies git diff, existence, syntax, typecheck and target tests. |
| §30.3 | Each change unit should be small, testable, rollbackable, traceable. |
| §32 | At least three layers: Implementation Worker, Internal Reviewer, Adversarial Reviewer. |
| §32.1 | Internal review covers correctness, architecture, test coverage, scope, maintainability; theme review adds visual coherence, surface coverage, fallback safety, theme isolation. |
| §32.2 | The adversarial reviewer hunts twelve named phenomena (hidden failure, race, restart issue, partial state, security, secret exposure, false positive test, silent fallback, unverified completion, theme renderer crash, theme registry corruption, cross-theme dependency). |
| §32.3 | Findings are HIGH/MEDIUM/LOW/INFO; HIGH/MEDIUM must return to the Repair Loop automatically. |

## What was built

### 1. `src/shared/review.ts` — the review decision layer (pure)

Three layers; §32.1's dimensions (plus the four theme ones for theme changes);
all twelve §32.2 probes as a catalogue, each naming the artifacts a reviewer must
inspect; §32.3 finding routing; `reviewCoverage` and `completionGate`.

The §2.3 rules are the point of the module:

* a HIGH/MEDIUM finding must name a requirement/file **and** something
  re-checkable (gate, ledger row, command, report) or it is refused — an
  unfalsifiable complaint cannot block work;
* only the Owner may `ACCEPTED_RISK` a finding;
* a dimension nobody reviewed is `NOT_RUN`, and "zero findings" from a reviewer
  that inspected nothing is not a clearance;
* `completionGate` opens three independent doors — no open blocking finding, full
  coverage, no requirement still owed evidence — before the word COMPLETED is
  available. `MODEL_DONE` is not an input.

### 2. `src/shared/review-checks.ts` — the checks the host can decide (pure)

`reviewFindings` derives findings from observations the host actually gathered:
UNVERIFIED_COMPLETION (no passing gate; **or** a demanded rung above the cheap
baseline that never passed; **or** a proof-bearing rung this host cannot climb at
all), correctness (a failed gate), PARTIAL_STATE (verification failed while the
change is still on disk), SILENT_FALLBACK (recovery/persistence claimed without a
restart or fault-injection rung), scope, `test_coverage`, SECRET_EXPOSURE,
architecture (generated artifact edited by hand), maintainability, and the three
theme probes.

Two calibrations come straight from running it:

* a finding may only block when the repair is inside the worker's authority — a
  "no test changed" observation is MEDIUM when the grant contains a test path and
  LOW when it does not, because otherwise the loop spins on something the worker
  can never fix;
* repository-wide gates (syntax, typecheck) do not prove a specific requirement,
  which is why the demanded/unavailable rung check exists.

`hostReviewRecords` reports only what was really inspected, so RACE,
HIDDEN_FAILURE, SECURITY and FALSE_POSITIVE_TEST stay unreviewed unless another
review layer supplies an evidence-bearing record.

### 3. `electron/engineering/review-engine.ts` — the host review

Gathers the artifacts: per-requirement ledger rows, the §31.2 rung demand and
unavailable rungs, the **real bytes** of every written file through the existing
secret scanner (`scanSecrets`), the generated-directory classification
(`GENERATED_DIRECTORIES`), the §20 theme validation state, and new-file
classification. It judges the **current** state (newest row per gate wins, so a
repaired failure stops blocking while the history stays in the ledger) and
assembles the §32 report.

### 4. `electron/engineering/implementation-loop.ts` — the §30 cycle

`runImplementationLoop` drives the stages in the plan's order: bounded scope →
worker proposal → whole-or-nothing apply → claim verification → ladder per
requirement → review → blocking findings back to the worker → re-verify, bounded
to 3 iterations by default, with a per-iteration record (applied, refused
problems, changed/new files, confirmed/refused claims, gate results, ladder
outcomes, blocking findings **with their statements**, coverage gaps, label). The
label comes from `completionGate`. No worker attached ⇒ `NOTHING_TO_DO` with the
reason, never a success.

## Evidence

`pnpm run acceptance:review` (CI step + local chain step) drives the real loop
over the real §30 engine (git, `tsc`, `node --test`, durable §31.3 ledger) and the
real §32 review engine on a real git fixture. **C-01..C-11 PASS, 62 observations:**

* C-01 a real change is applied, git confirms it, gates run, and the label is
  INCOMPLETE because dimensions are still unreviewed;
* C-02 a credential-shaped write is caught by the real scanner → repair iteration
  → the leak is gone and the block clears;
* C-03 a requirement claimed done whose demanded restart rung cannot be climbed
  is a HIGH UNVERIFIED_COMPLETION finding;
* C-04 an out-of-scope write never reaches disk and becomes a §32.1 scope finding;
* C-05 a failed typecheck produces correctness + PARTIAL_STATE and no completion;
* C-06 the loop stops at its iteration bound with REPAIR_REQUIRED;
* C-07 no proposal / no worker ⇒ NOTHING_TO_DO;
* C-08 a worker's "DONE" note never yields COMPLETED;
* C-09 a claim for an untouched file is refused by git and reported;
* C-10 an evidence-bearing record from a second review layer is what makes
  COMPLETED reachable;
* C-11 the ledger stays durable and no run was ever labelled complete by a claim.

Unit layer: `tests/unit/review-layer.test.ts` (19 cases).

## Honest boundaries

1. **The reviewers here are the host's.** The three §32 layers exist as roles and
   the host fills the internal/adversarial ones with checks it can decide. A model
   reviewer can add records and findings through `reviewerRecords` /
   `reviewerFindings`, and can never clear a dimension it did not inspect.
2. **The loop's in-app consumer arrives next.** The loop and the engine are
   exported host modules with a tested API; the WorkBook/commander path still uses
   the older `verifyAndRepair` seam, unchanged, so nothing regressed. Wiring the
   loop into the live task path (and recording its iterations on the durable task)
   belongs to the next checkpoint.
3. **Theme probes read registry records, not CSS semantics.** THEME_RENDERER_CRASH / THEME_REGISTRY_CORRUPTION / CROSS_THEME_DEPENDENCY are judged from the
   §20 validation state and package presence passed in by the host.
4. **The loop repairs with the same worker.** §33's failure classification and
   recovery ladder (alternate paths/providers, degraded mode) are checkpoint 10;
   today a repair is another worker attempt with the findings attached.
5. **Iterations are bounded at 3 by default** (hard cap 5) so a hopeless repair
   cannot loop forever; the bound being reached is reported as REPAIR_REQUIRED.
