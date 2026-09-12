# Checkpoint 16 — Final Acceptance (§42) with §43–§45, §51 and §52

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`).

Source plan: `Update-Plan/checkpoint-1.md` §42 (Phase 17 — Final Acceptance),
§43 (Bootstrap Completion), §44/§45 (what may and may not be a Hard Blocker),
§51 (Benchmark) and §52 (Seeded Failure Battery).

## What the plan demands

| Plan clause | Requirement |
| --- | --- |
| §42 | Before ACCEPTED: all mandatory requirements verified, no HIGH/MEDIUM findings, no unresolved secret issue, no unresolved destructive action, knowledge write complete, version impact complete, CI green, candidate matches the Owner's goal — plus theme runtime verified, visual surfaces usable, fallback verified and built-ins intact when UI is involved. |
| §43 | `BOOTSTRAP_COMPLETE` exists and is reachable only when every critical capability is available. |
| §44 | Only four classes may block: HB1 authority, HB2 irreversible Owner decision, HB3 missing external resource, HB4 root policy. |
| §45 | Library choices, code organisation, test writing, error fixing, provider failures, CI failures, file/branch naming, conflicting reviewers and theme implementation details must **not** be escalated. |
| §51 | A fixed bootstrap benchmark: B01 simple repo edit … B18 delete active theme safely. |
| §52 | Thirteen injected failures Boss must detect, diagnose, repair and verify itself. |

## What was built

### 1. `src/shared/final-acceptance.ts` — the decision layer (pure)

* **`evaluateFinalAcceptance`** runs §42's eight items (plus the four theme ones for a
  UI change), each reporting `VERIFIED` / `FAILED` / `NOT_VERIFIED` with what it
  inspected and why. Acceptance requires **every** required item to be VERIFIED:
  a `NOT_VERIFIED` item rejects it, which is the difference between "we checked and
  it is fine" and "nobody looked".
* **`bootstrapCompletion`** implements §43 over thirteen critical capabilities and
  names the ones that are missing; the comparison is case-insensitive (a bug the
  acceptance caught: `architecture and UI discovery` never matched).
* **`assessBlocker`** implements §44/§45 as a refusal: the §45 situations are
  rejected even when dressed as a blocker, and each §44 class is granted only when
  its own evidence is present (a policy denial, an authority need, an irreversible
  decision, a missing resource) — otherwise Boss must decide it itself.
* **`BENCHMARK_SCENARIOS` / `SEEDED_FAILURES`** are §51's eighteen and §52's thirteen
  entries, each pointing at the gate that actually proves it in this repository, so
  the catalogue cannot drift into aspiration.

### 2. `electron/engineering/final-acceptance-gate.ts` — the host gate

Gathers the facts from the artifacts the earlier checkpoints really wrote
(`review-loop.json`, `candidate-guardian.json`, `knowledge-foundation.json`,
`version-checkpoint.json`, `ci-repair.json`), the §31.3 ledger (including a
requirement whose newest row is a failure), the real secret scanner over the files
the candidate wrote, and writes the final-acceptance record alongside what it read
and what was missing.

A defect the acceptance caught here is worth naming: the first version built an
evidence object even when the artifact was absent, so a missing review report became
`blocking: 0` and the item **passed on no evidence**. Evidence keys are now only set
when the artifact exists — a fabricated zero is exactly what §42 exists to prevent.

## Evidence

`pnpm run acceptance:final` (CI step + local chain step) — **FS-01..FS-08 PASS,
55 observations**:

* FS-01 the eight items (twelve for UI) and the rule that nothing is verified
  without evidence;
* FS-02 a real artifact set plus real ladder rows verifies every item and the gate
  ACCEPTS, naming the artifacts it read;
* FS-03 an empty artifact set rejects the acceptance and marks the review,
  destructive, knowledge, version and CI items `NOT_VERIFIED`;
* FS-04 a real `AKIA…` shape, an open HIGH/MEDIUM finding and an unapproved removal
  each fail their own item;
* FS-05 an unverified requirement, a requirement with failing ledger rows and a red
  CI all fail their items; a green CI verifies its own;
* FS-06 §43 completeness over the thirteen capabilities;
* FS-07 §44 grants exactly the four classes and §45 refuses all thirteen
  autonomous situations (including one dressed as HB1);
* FS-08 the §51/§52 catalogues have 18/13 entries, `B01..B18` / `S01..S13`, and
  every proof names a gate this repository actually runs.

## Honest boundaries

1. **The gate reads artifacts, not the live pipeline.** It is the aggregation point
   for evidence the other checkpoints produced; wiring it into the live task/release
   path (so a release cannot proceed without an ACCEPTED record) is integration work
   that belongs with the live-path checkpoint.
2. **The §51/§52 catalogues are proven by existing gates, not by a new harness.**
   Each entry names the acceptance gate that exercises the scenario today
   (`acceptance:verify`, `acceptance:ci-repair`, `acceptance-restart`, …); a
   one-shot benchmark runner that walks all eighteen in one command is CP17's soak
   test and beyond.
3. **`VERSION_IMPACT_COMPLETE` re-reads the §37 record** rather than re-assessing;
   the assessment itself is CP13's, and re-running it here would hide a stale
   record.
4. **Theme items are only required for UI changes**, and they are supplied by the
   caller (the theme runtime checks live in CP4/CP5); a UI change without them is
   `NOT_VERIFIED` and therefore rejected.
