# Platform Foundation — Phase 04: Knowledge and Data Lifecycle

**Base:** `977ecae92b0e788a2d502f9abac10bcc37d05d87` (Phase 03 FINAL_HEAD)
**Branch:** `platform-foundation/04-knowledge-data-lifecycle`
**Engineering book:** `Update-Plan/Platform-Foundation/Phase-04-Knowledge-Data-Lifecycle.md`

This is the phase acceptance record. It states what was built, what the engineering book
required that the repository did not already have, what the phase found, and where the
implementation departs from the book's letter with a reason.

---

## 1. What was already true, and therefore was not rebuilt

The book says to check the code before assuming the stated defects still exist. One of its
areas was **already implemented and already in live use**, so the phase did not overwrite it:

| Book requirement | Already enforced by | What the phase did instead |
| --- | --- | --- |
| "Data has retention tiers, and owner/security evidence must not be deleted" | `src/shared/data-lifecycle.ts` — an L0–L4 tier model with a `userAuthorizedDelete` hard rule, imported by the running application | Did **not** replace it. Added `data-retention.ts` (HOT/WARM/COLD/DISPOSABLE/PROTECTED, GC planning and execution) as the *auditable* lifecycle the book asks for, and documented the relationship rather than collapsing two live models into one |

Deleting the existing module to install a cleaner one would have been the opportunistic
refactor the phase rules forbid, and would have removed a guard that is currently wired into
the application. No existing test was deleted, weakened, skipped, or had an allowlist widened.

---

## 2. What was delivered

### Knowledge provenance and lifecycle — `src/shared/`

| File | Responsibility |
| --- | --- |
| `knowledge-claim.ts` | the five kinds, the confidence vocabulary, evidence floors, `derivableConfidence`, `validateClaim`/`assertValidClaim`, `supersede`, `dispute`, `adjudicate`, `isCurrent` |
| `knowledge-staleness.ts` | `assessStaleness` over seven named reasons, indexed path matching, `staleClaims`, `reasonHistogram`, `isRetrievableAsFact` |
| `data-retention.ts` | the five data classes, per-class retention rules, `classifyData`, `planCollection`, `applyCollection`, `plansCorrespond`, `buildCompactionSummary` |
| `knowledge-retrieval-guard.ts` | `retrieveClaims` (scope filter → exclusion → explained scoring), `runRetrievalBenchmark`, `rankOf` |

### The gate 7 artifact — `scripts/data-lifecycle-report.cjs`

Writes `artifacts/platform-foundation/phase-04/data-lifecycle-report.json`. Declared policy,
discovered corpus and computed evidence are kept in separate sections, the same discipline as
the Phase 02 and Phase 03 reports. The generator loads the **compiled** modules rather than a
restatement of them, walks the real state roots this checkout has accumulated, and executes a
plan through a **recording** deleter: it records what it would remove and unlinks nothing, so
measuring the policy does not destroy the evidence being measured.

---

## 3. What the phase found

Three of these were found by the artifact generator refusing to write its own report, which is
the point of asserting invariants in the generator rather than only in the tests.

### 3.1 A quadratic in staleness matching, found by the scale gate

`bindingAffected` walked every change entry for every claim and returned on the first match. At
the book's required scale that is 10 500 × 10 500 path comparisons: **measured 60.8 s of CPU for
one `assessStaleness` pass over the corpus**, against a 30 s test ceiling.

The first fix attempt (hoisting normalisation, then short-circuiting the scan) was **insufficient
and was measured to be insufficient** — instrumenting the loop showed 9 000 000 inner iterations
for N = 3 000, still quadratic. The module now builds an index of moved paths per observation
(cached by observation identity) and answers each binding in time proportional to its own size:
**45 ms for the same corpus.**

The same change fixed a correctness defect: stopping at the first matching change entry reported
only one of the paths a binding covers, so a claim bound to two files that both moved named half
the story.

### 3.2 `adjudicate` resolved a conflict into nothing

`dispute` marks both sides `disputed`; `adjudicate` cleared `disputedWith` but **never restored
the confidence level**. The winner of an adjudication therefore stayed `disputed` forever, and
`isCurrent` refused it: the conflict was resolved on paper while nothing was left that a reader
could treat as current. `KnowledgeClaim` now carries `disputedFromLevel`, set by `dispute` and
restored by `adjudicate` — so adjudication settles the *conflict* without promoting the winner's
*evidence* either.

### 3.3 The program's own acceptance evidence was collectable

`PROTECTED_MARKERS` named generic evidence words but not this program's artifact path, so
`artifacts/platform-foundation/phase-01|02|03/*.json` classified as **WARM** — ordinary warm
history, eventually collectable by age. Acceptance evidence that a GC pass can delete is not
evidence. `platform-foundation` is now an explicit protection marker, with the reason recorded
beside it.

---

## 4. Measured results

Corpus: **70 474 files / 540 MB** discovered across `.codex-boss`, `artifacts`, `runtime-data`
and `history`. Classification: 68 821 WARM, 1 415 DISPOSABLE, 165 PROTECTED, 73 COLD, 0 HOT.

| Gate | Evidence | Result |
| --- | --- | --- |
| 2 — no verified claim without provenance | `validateClaim` refuses a missing `sourceRef`, a mutable source at `verified`, a bare confidence level, and a missing project scope | PASS |
| 2 — confidence must not self-grow by citation | `derivableConfidence` has **no citations parameter at all**; passing 50 corroborations returns the same level | PASS |
| 3 — code knowledge binds repo + revision | a claim bound to `repo@rev` goes stale on a change at a later revision, is spared at its own revision, and is spared in another repo | PASS |
| 4 — conflicts keep both sides | `dispute` supersedes neither and keeps both provenances; `adjudicate` refuses a thin reason and refuses identical evidence at identical confidence | PASS |
| 5 — GC dry run corresponds to execution | live corpus: 81 candidates, 81 handed over, **0 misdeleted** of 166 protected/active/referenced records; parity true over both the live and the exercised corpus; audit covers every candidate | PASS |
| 5 — never delete owner/security/audit evidence | 50-record adversarial corpus of ancient duplicated `audit-evidence` yields **0 candidates**; every `platform-foundation` artifact classifies PROTECTED | PASS |
| 6 — retrieval not drowned by stale history | 10 500 stale records + 1 current: current ranked **#1**, 20 returned, 0 excluded, every history entry carries a `stale` penalty; **127 ms** | PASS |
| 6 — no cross-project contamination | another project's claim is excluded by scope before ranking, even on an exact term match | PASS |
| 7 — artifact | `artifacts/platform-foundation/phase-04/data-lifecycle-report.json`, 9/9 invariants held | PASS |

The generator is itself verified to fail closed: `tests/acceptance/data-lifecycle-report.test.ts`
removes the protection marker from the **compiled** module, re-runs the generator, and asserts it
exits non-zero rather than writing a report that claims a property it did not observe.

---

## 5. Deliberate departures from the book's letter

- **`data-retention.ts` alongside `data-lifecycle.ts`** rather than instead of it (§1).
- **The live corpus is collectable, and that is reported rather than engineered away.** A packaged
  build under `artifacts/` carries the epoch timestamps a zip round-trip gives it, so it is
  genuinely past the COLD window. The gate's requirement is zero **misdeletion**, not zero
  candidates, so the live corpus is executed through a recording deleter and the report shows the
  81 items that would be removed — all COLD/DISPOSABLE, none protected.
- **`applyCollection` accepts a plan.** Without it a caller could only recompute the plan from the
  same corpus it is about to execute, which makes "the dry run matches the execution" true by
  construction and untestable. A record the approved plan named but the execution cannot see is now
  reported `NOT_SUPPLIED` instead of vanishing from the difference.

---

## 6. Inherited by later phases

Recorded, not fixed here (each is outside this phase's scope):

- `artifacts/host-soak` holds **65 125 files / 76 MB** from a single soak run — the accumulation
  the retention policy exists for, and the reason an index must be kept separate from an archive.
- 68 375 of the 70 474 discovered files live under `artifacts/`; a GC pass that stats the whole
  tree per run will need the inventory cached, not recomputed.
