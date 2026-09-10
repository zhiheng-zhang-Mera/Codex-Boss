# Autonomous Evolution — Phase 0 execution record

**Plan:** `Update-Plan/Isolation-Finalization.md`
**Phase:** 0 — Root Defense & Isolation Finalization
**Base branch:** `main`
**Base SHA:** `fc14988395d60a0fb9a8f7d955657b55a0bfce87`
**Work branch:** `Alien-Prestart-Isolation`
**Nature of the round:** last externally-driven hardening pass before Codex-Boss
enters its autonomous-evolution stage. Non-functional build-out only: no
ordinary product feature was added.

---

## 1. What was built

The round adds one thing: an **outer authority boundary** around the autonomous
engineering chain, so that a Candidate can evolve the product but can never
evolve *who controls the product*.

| Phase | Deliverable | Where |
|---|---|---|
| F0 | Baseline freeze and regression baseline | `evidence/F0-baseline.json` |
| F1 | Root Authority: policy, protected surface, audit ledger | `src/shared/root-authority/`, `electron/root-authority/` |
| F2 | Stable / Candidate real isolation | `electron/stable-candidate/` |
| F3 | Credential boundary | `electron/credential-boundary/` |
| F4 | Autonomous Evolution execution profile | `electron/root-authority/execution-profile.ts` |
| F5 | Promotion gate and exact-SHA contract | `electron/promotion-gate/`, `src/shared/root-authority/promotion-state.ts` |
| F6 | Rollback and Root recovery | `electron/root-recovery/` |
| F7 | Emergency control | `electron/emergency-control/` |
| F8 | Adversarial / red-team acceptance | `tests/unit/root-authority-red-team.test.ts` |

The four invariants the round had to establish:

1. Boss may autonomously evolve its capabilities, but may never autonomously
   redefine, bypass, revoke, impersonate or supersede the Root Owner, or the
   controls that enforce Root Owner authority.
2. Candidate failure must never corrupt or terminate Stable.
3. No autonomous component may obtain Owner-equivalent GitHub authority through
   ambient credentials, fallback credentials, browser sessions or privilege
   escalation.
4. Promotion is evidence-bound to the exact Candidate SHA that passed the gates.

---

## 2. How this round was constructed

The plan fixes a base branch (`main`) and a base SHA
(`fc14988…`). The Owner's primary checkout was **not** used as the construction
workspace: it sits on a divergent local branch with unrelated pending changes.
Following plan §6 ("建施工 branch / isolated workspace") and §8.2, the work was
done in a linked git worktree at the frozen SHA:

```
git fetch origin --prune
git worktree add <isolated-workspace> -b Alien-Prestart-Isolation fc14988
```

The primary checkout was left untouched throughout. `evidence/F0-baseline.json`
records the frozen SHA, the clean working tree, the toolchain and the real
baseline gate results (82 test files / 687 tests, all gates PASS).

Note on tooling: `pnpm` is not on `PATH` in this environment; `corepack pnpm`
resolves the `packageManager` version pinned by `package.json`
(`pnpm@11.19.0`), which is what every gate command below was run with.

---

## 3. Reproducing the gates

```text
pnpm run typecheck
pnpm run build
pnpm test
pnpm run benchmark
pnpm run package:portable
powershell -NoProfile -File scripts/smoke-portable.ps1
node scripts/acceptance-restart.cjs
```

Per-phase evidence is generated from a real test run, not typed by hand:

```text
node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=<report>.json
node scripts/root-defense-evidence.cjs --report <report>.json --out Update-Plan/Autonomous-Evolution-Phase0/evidence
```

`scripts/root-defense-evidence.cjs` reads the machine-produced vitest report and
derives each phase's evidence file from the **observed** result of the tests that
belong to that phase, plus the gate logs it is pointed at. A phase with a failing
test produces `FAIL` in its evidence file; the script cannot emit a PASS that did
not happen.

---

## 4. Reading order

1. `REQUIREMENTS.md` — every clause of the plan, mapped to an implementation and
   an acceptance case.
2. `ARCHITECTURE.md` — the module map, the decision composition rules, and the
   reasoning behind each structural choice the plan left open.
3. `ACCEPTANCE-MATRIX.md` — RD-001…RD-020 with evidence pointers and results.
4. `FINAL-ACCEPTANCE.md` — the first-screen verdict block required by §24.
5. `evidence/` — machine-derived per-phase evidence.
6. `FUTURE-OPPORTUNITIES.md` — improvements found but deliberately **not** built
   this round (§18).
