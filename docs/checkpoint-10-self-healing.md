# Checkpoint 10 — Self-Healing / Recovery (§33)

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`).

Source plan: `Update-Plan/checkpoint-1.md` §33 (Phase 8 — Self-Healing /
Recovery), with §33.3's bridge into §34's capability-gap backlog.

## What the plan demands

| Plan clause | Requirement |
| --- | --- |
| §33.1 | One unified failure model with at least the twelve classes: TRANSIENT, TERMINAL, DEPENDENCY, AUTH, RATE_LIMIT, PROVIDER_PAGE, WORKSPACE, BUILD, TEST, ENVIRONMENT, THEME, UI, UNKNOWN. |
| §33.2 | The recovery order: native retry → local recovery → alternate internal path → alternate provider → degraded mode → HNS fallback → Hard Blocker. Themes have their own ladder: custom theme fails → disable → fall back to the built-in theme → record the diagnostic. |
| §33.3 | HNS must not become a permanent crutch; it may only be a fallback, a diagnostic, a recovery route or an external executor, and **every** call must produce a `CapabilityGap` that enters the self-improvement backlog. |

## What was built

### 1. `src/shared/recovery.ts` — the model (pure)

* `classifyFailure(observation)` decides one of the thirteen classes from **real
  evidence**: the failing gate, the tool's own output, the provider runtime code,
  host-verified workspace facts, the theme validation count, the visual verdict or
  an explicit policy refusal. It reports the signals that decided it, and it
  refuses to guess: a benchmark miss has no class in §33.1 and is recorded as
  UNKNOWN with that reason rather than being forced into "performance”.
* Ordering is by authority, not convenience: a policy/Guardian refusal is decided
  first and can never be re-labelled TRANSIENT by a stray word in the output; a
  host-verified fact ("the module the error named is present on disk") outranks the
  prose, so a `Cannot find module` in a tree that has the module becomes a BUILD
  failure instead of a false dependency gap.
* `planRecovery(classification)` returns the §33.2 ladder with **every** step listed
  and each one carrying either its budget or the reason it does not apply — so
  "we went straight to HNS" is visible in the record instead of implied. The last
  step is always HARD_BLOCKER; TERMINAL has no applicable step at all and HNS is
  forbidden; AUTH and WORKSPACE hand the decision to the Owner
  (`SIGN_IN` / `AUTHORIZATION`) because no local repair can substitute for them.
  THEME failures additionally carry the §33.2 theme ladder.
* `advanceRecovery(plan, attempts)` enforces the order: a later step is only
  offered once every applicable earlier step has used its budget, and an exhausted
  ladder reports a Hard Blocker rather than looping.
* `planHnsFallback(request)` implements §33.3: the decision may be a refusal for
  three different reasons (the class may not be delegated, the missing capability
  was not named, or HNS has answered too many consecutive calls) and in **every**
  case it still returns the `CapabilityGap` plus the §34 backlog seed. The crutch
  ceiling is 2 consecutive calls; `recordHnsUsage` accepts only the four §33.3
  roles and throws on a gapless usage.

### 2. `electron/engineering/recovery-engine.ts` — the host side

Supplies the evidence and keeps the gaps durable:

* reads the failing gate's own output back out of the §31.3 ledger row;
* verifies the workspace itself (`node_modules` existence for every module the
  error named, `.git` presence, escaped/protected path, scope refusal, disk full);
* obtains the policy refusal from the **real** §7.3 mutation guard
  (`assertMutationAllowed`) rather than assuming one;
* appends every HNS usage — allowed or refused — to
  `<workspace>/artifacts/acceptance/capability-gaps.json` with its gap, its §34
  backlog seed and its role.

### 3. `electron/engineering/implementation-loop.ts` — the repair stage

The loop's repair step now asks for a classification and records it per iteration
(`failure_class`, `severity`, `reason`, the recovery step that is due,
`hard_blocker`, and `requires_owner`), so §30's Repair is §33-classified rather
than blind. No `recover` callback supplied means no classification is recorded —
the record shows that instead of inventing one.

### 4. One fidelity fix found by running it

`verifyClaims` refused a change that restored a file to its **committed** content:
`git status` is clean in that case, so the host denied a modification that really
happened. The check now also accepts the applied change unit's own before/after
hashes (`changed_by_unit`), which is stricter reasoning, not a weaker check — a
phantom claim (a path the unit never touched) is still refused.

## Evidence

`pnpm run acceptance:self-healing` (CI step + local chain step) drives the model
over failures the host really produced. **RC-01..RC-10 PASS, 64 observations:**

* RC-01 a real `tsc --noEmit` failure → BUILD, with the `TS2322` diagnostic and the
  gate cited as signals, and `LOCAL_RECOVERY` as the due step (no provider step);
* RC-02 a real missing module → DEPENDENCY, with the module extracted from the
  output and the host's own `node_modules` check confirming it is absent;
* RC-03 a real failing `node --test` → TEST, with retrying refused;
* RC-04 the real mutation-guard refusal of the Boss repository → TERMINAL /
  CRITICAL, no applicable step, HNS forbidden, Owner `AUTHORIZATION` required;
* RC-05 a real theme validation report → THEME with the §33.2 theme ladder;
* RC-06 the ladder cannot be short-circuited: one failed local attempt leaves the
  next step at `LOCAL_RECOVERY`; only a used-up budget makes HNS due; then it
  hard-blocks;
* RC-07 an allowed HNS fallback writes a durable versioned CapabilityGap backlog
  entry with its §34 stage;
* RC-08 the third consecutive HNS call is refused as a crutch while the gap is
  still recorded, and no usage is ever recorded without a gap;
* RC-09 the implementation loop records the classification and the due step for the
  failing iteration, repairs on the next attempt, and still refuses COMPLETED;
* RC-10 an unrecognised failure stays UNKNOWN with low confidence, an exhausted
  ladder reports a hard blocker, the plan never claims a result, and the gaps
  survive a fresh engine.

Unit layer: `tests/unit/recovery-model.test.ts` (22 cases).

## Honest boundaries

1. **Classification is lexical plus host-verified facts.** It reads real bytes and
   checks real paths, but it does not model semantics; when nothing matches it says
   UNKNOWN rather than guessing, and the reason is recorded.
2. **The recovery steps are expressed and ordered, not all executed.** This
   checkpoint decides *which* step is due and proves the ordering and budgets; the
   actual alternate-provider and degraded-mode executors already exist elsewhere in
   the tree (the provider recovery ladder R0–R8, `intervention.ts`) and wiring them
   into this ladder belongs with the live-path integration checkpoint.
3. **HNS is represented, not called.** §33.3's contract — roles, mandatory
   CapabilityGap, crutch ceiling, durable backlog — is implemented and tested; the
   actual external executor remains the existing HNS integration.
4. **§34's chain is only seeded.** The gap record carries the improvement-task
   stage and the frequency/severity inputs; the full
   CapabilityGap → Improvement Task → Implementation → Regression Test →
   Knowledge Update → Capability Registry loop is checkpoint 11.
5. **Provider-side codes come from the existing vocabulary** (`provider-outcome`),
   so a provider failure is classified from the same codes the rest of the system
   already records.
