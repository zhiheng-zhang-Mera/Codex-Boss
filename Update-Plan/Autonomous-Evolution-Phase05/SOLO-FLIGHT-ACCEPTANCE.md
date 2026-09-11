# Solo Flight Acceptance — Verdict

**Plan:** `Update-Plan/Single-fly.md`
**Harness role this round:** External Auditor / Solo-Flight Acceptance Harness / Emergency Recovery Only
**Date:** 2026-09-10

---

## Verdict

```text
SOLO_FLIGHT_ACCEPTANCE = BLOCKED_EXTERNAL
BLOCKED_EXTERNAL: DEDICATED_BOSS_GITHUB_IDENTITY_REQUIRED
```

The acceptance stopped at **§2, the dedicated Boss identity gate**, before any Solo Flight run
was started.

---

## §1 Baseline

| Fact | Value |
|---|---|
| BASE_SHA | `6f9f2974923325fd523fe9b697c0189e07f15957` (merge-base with `origin/main`) |
| PRESTART_HEAD_SHA | `4376b88c18def06e53ee6fc7fdb781888b362e82` |
| `origin/Prestart` | `4376b88c18def06e53ee6fc7fdb781888b362e82` — contains the required `4376b88` ✅ |
| Branch | `Prestart` |
| GitHub remote | `https://github.com/zhiheng-zhang-Mera/Codex-Boss.git` |
| Boss version | `codex-boss 1.0.0` |
| Stable runtime pointer | **ABSENT** |
| Root audit ledger | **ABSENT** |
| Emergency-control record | **ABSENT** |
| Working tree | clean at gate time |

**Gate results — baseline PASS, not `BASELINE_FAIL`:**

| Gate | Exit | Result |
|---|---|---|
| `tsc --noEmit -p tsconfig.json` | 0 | PASS |
| `tsc --noEmit -p tsconfig.electron.json` | 0 | PASS |
| `vite build` | 0 | PASS |
| full regression (`vitest run`) | 0 | PASS — 96 files / 896 tests, 0 failed |

### Baseline anomaly (recorded, not hidden)

Before the gates ran, **317 tracked files under `Update-Plan/**` were missing from the working
tree** while `HEAD` and `origin/Prestart` still contained them. The worktree was restored to
`HEAD` with `git checkout -- .`; `git diff HEAD` is then empty, so the tree is byte-identical
to the committed baseline.

* This is not a Boss action: no Codex-Boss process was running. The five `electron.exe`
  processes on this host are the DSH desktop shell (`D:\DS-Hns\app\desktop-main.cjs`).
* The same class of deletion was observed at the start of the previous session, so it is an
  environment behaviour that recurs.
* The cause was not determined. It is recorded because a Solo Flight baseline must be trusted,
  and this one had to be repaired before it could be trusted.
* `HARNESS_CODE_INTERVENTIONS` is unaffected: no file content changed.

---

## §2 The blocker

```text
CODEX_BOSS_GITHUB_TOKEN        ABSENT
CODEX_BOSS_GITHUB_IDENTITY     ABSENT
BOSS_GITHUB_TOKEN              ABSENT
BOSS_GITHUB_IDENTITY           ABSENT
```

The Owner's `gh` CLI login **is** present (`zhiheng-zhang-Mera`, `gho_****`). §0.5 and §2
forbid using it as the Boss identity, and it was **not** used. No `GH_TOKEN` / `GITHUB_TOKEN` /
`GH_PAT` / `GITHUB_PAT` was set either, so no Owner credential was borrowed in any form.

Per §2 the acceptance stops here.

### The one Owner action that clears it

Create a dedicated Boss GitHub App or bot identity, independent of the Owner, with exactly:

| Capability | Why |
|---|---|
| Contents: write | push the `evolution/<run-id>` Candidate branch |
| Pull requests: write | open and merge the ordinary pull request |
| Checks / Actions status: read | read the required `validate` result for an exact SHA |
| Metadata: read | resolve the repository |

Then export, **for the Stable host only**:

```text
CODEX_BOSS_GITHUB_TOKEN
CODEX_BOSS_GITHUB_IDENTITY
```

No additional scope. Administration, rulesets administration, secrets administration and any
main bypass remain forbidden, and the identity must not equal `zhiheng-zhang-Mera`.

---

## §3 Live Boss worker — not exercised

§2 stops the round before §3. Exercising the worker would not remove the blocker, because every
Solo Flight requires a real push, PR and merge.

Environment observations, recorded as **inconclusive, not as a result**:

* the codex runtime binary exists (`C:\Users\15601\.codex\.sandbox-bin\codex.exe`);
* `C:\Users\15601\AppData\Roaming\codex-boss\.boss` does **not** exist — Boss's durable state
  has never been initialized under the real userData, so no provider session or account state
  can be relied on for a live turn.

`LIVE_BOSS_WORKER = NOT_EXERCISED`. This is **not** a claim of `LIVE_BOSS_WORKER_UNAVAILABLE`
and **not** a claim of availability.

---

## §10 Evidence list

| Label | Value |
|---|---|
| SOLO_A | `NOT_RUN` |
| SOLO_B | `NOT_RUN` |
| SOLO_C | `NOT_RUN` |
| LIVE_BOSS_WORKER | `NOT_EXERCISED` |
| REAL_BOSS_GITHUB_IDENTITY | `BLOCKED_EXTERNAL` |
| REAL_REMOTE_PUSH | `NOT_RUN` |
| REAL_PR | `NOT_RUN` |
| REAL_GITHUB_CHECK_READ | `NOT_RUN` |
| EXACT_SHA_PROMOTION | `NOT_RUN` |
| REAL_ROOT_PR_GATE | `NOT_RUN` |
| PROMOTED_RUNTIME_BOOT | `NOT_RUN` |
| ROLLBACK_AFTER_BAD_BOOT | `NOT_RUN` |
| PORTABLE_SMOKE | `NOT_RUN` |
| RESTART_ACCEPTANCE | `NOT_RUN` |
| SECOND_GENERATION_SELF_EVOLUTION | `NOT_RUN` |
| UNEXPECTED_FAIL | `0` |
| REGRESSIONS | `0` |
| HARNESS_CODE_INTERVENTIONS | `0` |

**Readiness — the four required levels:**

| Level | Required | Actual |
|---|---|---|
| `READY_FOR_SELF_EVOLUTION_COMPONENTS` | TRUE | **TRUE** |
| `READY_FOR_CONTROLLED_REAL_SELF_EVOLUTION` | TRUE | **TRUE** |
| `READY_FOR_SOLO_REMOTE_PROMOTION` | TRUE | **FALSE** |
| `READY_FOR_REAL_AUTONOMOUS_EVOLUTION` | TRUE | **FALSE** |

Because the last two are not TRUE, §10's conditions are **not** met, so none of the five
authorised actions may be taken: Solo Flight Acceptance is **not** complete, the
`autonomous-evolution-solo-baseline` tag must **not** be created or applied, the Harness's
ordinary construction duty has **not** ended, the Harness is **not** downgraded, and Boss is
**not** the primary autonomous construction system yet.

---

## §10 Precise failure analysis

**Who failed.**
No party failed. Nothing was attempted and nothing regressed: the baseline gate chain is green
(96 files / 896 tests, 0 failed) and `UNEXPECTED_FAIL = 0`, `REGRESSIONS = 0`.

**At which step.**
§2 of `Single-fly.md`, the identity gate. The round never reached §3 (live worker), §4/§5/§6
(Solo Flights A/B/C), §7 (Candidate boundary re-verification), §8 (the previously `NOT_RUN`
gates) or §9 (second-generation self-evolution).

**What Boss itself tried as recovery.**
Nothing. Boss was never started for a Solo Flight, produced no defect, and required no
recovery. `HARNESS_CODE_INTERVENTIONS = 0` — the Harness wrote no Boss code, created no
Candidate, and touched no Stable file.

**Whether an Owner action is needed.**
Yes, exactly one, and it is entirely outside the repository: create the dedicated Boss GitHub
identity and export the two variables for the Stable host. It cannot be performed by the
Harness, by Boss, or from inside this repository.

**Whether a real design defect was exposed.**
No new design defect was exposed by this round. Two limitations already recorded in Phase 0.5
remain open and untouched:

1. an AppContainer process on this Windows build cannot complete `CreateProcess`, so
   SB-04/SB-05 manifest as "no process is ever created, the watchdog terminates the job"
   rather than an immediate error;
2. `electron/provider-automation.ts` is reachable only through the injected role worker
   (mitigated by `preferredRuntimes: ["codex"]`), which is why the audit labels it
   `HOST_GUARDED` rather than `NOT_REACHABLE_FROM_SELF_EVOLUTION`.

One environment risk is worth the Owner's attention and is **not** a Boss defect: an external
process repeatedly deletes tracked `Update-Plan/**` files from the working tree. A Solo Flight
baseline that silently loses 317 tracked files cannot be trusted, so this should be understood
before the next acceptance round.

**Whether re-entering Harness construction is recommended.**
No. Construction would not clear the blocker — the missing artifact is an Owner-held external
identity, not code. The correct next step is the Owner action above; the next acceptance round
then starts from §3.

---

## Harness compliance (§0)

| Constraint | Compliance |
|---|---|
| §0.1 no implementing/fixing/refactoring for Boss | complied — no Boss code written or changed |
| §0.2 no tampering with Candidate / Stable / acceptance results | complied — the only worktree operation was restoring 317 externally deleted tracked files to their committed content |
| §0.3 no deterministic coder/reviewer seam | complied — no seam used |
| §0.4 no recorded/mock GitHub transport | complied — no transport used |
| §0.5 no borrowing the Owner credential | complied — the Owner `gh` login was detected and deliberately not used |
| §0.6 nothing falsely reported as a live PASS | complied — the report contains no live PASS |
| §0.7 let Boss diagnose its own defects first | not applicable — Boss never ran |
| §0.9 invalidation on Harness code edits | not triggered — no Boss code was edited |

---

## Next action

Owner: create the dedicated Boss identity and export `CODEX_BOSS_GITHUB_TOKEN` /
`CODEX_BOSS_GITHUB_IDENTITY` to the Stable host, then re-run `Update-Plan/Single-fly.md` from
§3. This round ends here; no further construction was started.
