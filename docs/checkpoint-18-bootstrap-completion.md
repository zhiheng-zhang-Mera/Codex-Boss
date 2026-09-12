# Checkpoint 18 — Bootstrap Completion (§57/§58)

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`). The audit over
this repository's own artifacts reports **BOOTSTRAP_COMPLETE**.

Source plan: `Update-Plan/checkpoint-1.md` §57 (Bootstrap Completion acceptance
scenario — a real black box from a fresh clone, a real WorkBook, no human
engineering, then the UI theme black box), §58 (Bootstrap Completion DoD) and §43
(the `BOOTSTRAP_COMPLETE` state).

## What was built

### 1. `src/shared/bootstrap-audit.ts` — the audit (pure)

* **`GATE_REQUIREMENTS`** is the delivery chain: sixteen gates, each with the exact
  ids it must have passed (WB-01..WB-10, K-01..K-04, A-01..A-10, TH-01..TH-15 +
  T-TOKENS, R-01..R-08, P-01..P-06, V-01..V-10, C-01..C-11, RC-01..RC-10,
  CG-01..CG-10, GD-01..GD-10, VC-01..VC-08, PB-01..PB-10, CR-01..CR-08,
  FS-01..FS-08, SK-01..SK-06).
* **`auditGate`** judges one gate's report against those ids: a missing id or a
  non-PASS verdict fails the gate, and the reason names it — partial green is not
  green.
* **`auditBootstrap`** combines the gate audits with §57's real-application black box
  (which also counts as evidence for the theme capability), derives §43's thirteen
  capabilities from the passing gates, and requires **zero Owner interventions**.
  Anything less is honestly `INCOMPLETE` with the reasons listed.

### 2. `electron/engineering/bootstrap-completion.ts` — the host auditor

Reads the report each gate wrote under `artifacts/acceptance/` and writes
`bootstrap-completion.json` (decision, per-gate audit, capability evidence,
interventions, reasons, hash).

### 3. The desktop black box now publishes a durable report

§57's black box is the real Electron application driven over CDP
(`acceptance:desktop-workbook`, 89 claims: the WorkBook path plus the theme phase).
It previously wrote its evidence into a per-run directory, so no later gate could
audit it; it now also writes `artifacts/acceptance/desktop-workbook.json` in the
shape every other gate uses — the same claims, machine-readable.

## Evidence

`pnpm run acceptance:bootstrap-completion` (the **last** step of both CI and the local
chain, so every report it reads was just produced) — **BC-01..BC-06 PASS,
30 observations**, and then the real audit:

```
[bootstrap] real audit: BOOTSTRAP_COMPLETE
[bootstrap] gates: 16/16 passed, desktop black box PASS,
            capabilities 13/13, owner interventions 0
```

* BC-01 every gate is audited against the ids it must have passed (a missing report
  is `MISSING`, a failed id fails the gate and is named);
* BC-02 a complete report set yields `BOOTSTRAP_COMPLETE` with all seventeen reports
  found, no Owner intervention and a durable hashed record;
* BC-03 a deleted report makes the decision `INCOMPLETE` and un-establishes the
  capability that gate proved;
* BC-04 a single `NOT_RUN` id inside an otherwise green report fails that gate;
* BC-05 one Owner intervention forbids completion;
* BC-06 all thirteen capabilities are traceable to evidence and none is established
  without it.

## Honest boundaries

1. **The audit aggregates; it does not re-run the chain.** It reads the reports the
   gates wrote in the same run, which is why it is last in CI; a stale artifact
   directory would be audited as it is (the record carries `audited_at`, and every
   report carries its own `generatedAt`).
2. **§57's "fresh clone of Codex Boss" is the CI checkout plus the soak rounds.**
   `acceptance:soak` clones from a bare remote and walks clone → bootstrap → task →
   repair → PR → CI → completion per round; the audit requires its report like any
   other gate, so a broken soak blocks completion.
3. **The WorkBook and theme black boxes are the existing desktop smoke.** It drives
   the real application over CDP with an offline provider and verifies the durable
   files the app wrote; live provider execution remains out of scope (`NOT_RUN`) and
   is declared as such in its report.
4. **`owner_interventions` is asserted as zero by the audit's caller.** The desktop
   smoke takes no human step once launched, and the soak rounds take none; the gate
   records the count so a future run that needed one fails instead of quietly
   succeeding.
