# Final acceptance — Phase 0 Root Defense & Isolation

```text
BASE_SHA:                     fc14988395d60a0fb9a8f7d955657b55a0bfce87
CANDIDATE_SHA:                bc2487401bb5b0cf1689638b14e260c664253a23
BRANCH:                       Alien-Prestart-Isolation
PR:                           https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/1

TYPECHECK:                    PASS
BUILD:                        PASS
FULL_TEST:                    PASS   (93 files / 855 tests, 0 failed; baseline was 82 / 687)
BENCHMARK:                    PASS   (persistence 100/100, recovery 20/20, routing 10/10)
PORTABLE_SMOKE:               PASS   (PACKAGED_SMOKE_PASS)
RESTART_ACCEPTANCE:           PASS   (CONTROLLED_ELECTRON_RESTART status PASS)

ROOT_AUTHORITY:               PASS   (F1: 43/43 assertions)
STABLE_CANDIDATE_ISOLATION:   PASS   (F2: 17/17 assertions)
CREDENTIAL_BOUNDARY:          PASS   (F3: 16/16 assertions)
PROTECTED_SURFACE:            PASS   (F1 + owner-authority batteries; RT-09..RT-13)
EXACT_SHA_PROMOTION:          PASS   (F5: 27/27 assertions; RT-14/RT-15)
ROLLBACK:                     PASS   (F6: 10/10 assertions)
EMERGENCY_CONTROL:            PASS   (F7: 15/15 assertions)
RED_TEAM:                     PASS   (F8: 25/25 cases, RT-01..RT-25)

READY_FOR_CONTROLLED_AUTONOMOUS_EVOLUTION:  TRUE
READY_FOR_UNATTENDED_PROMOTION:             BLOCKED_EXTERNAL

BLOCKED_EXTERNAL:             1 (dedicated Boss GitHub identity — see §2)
UNEXPECTED_FAIL:              0
REGRESSIONS:                  0
```

Evidence for every line above is machine-derived and committed under
`evidence/`; `evidence/regression.json` carries the gate exit codes and a
SHA-256 digest of each gate transcript, and `evidence/gate-logs/` holds those
transcripts verbatim.

### Note on the two SHAs

`CANDIDATE_SHA` above is the implementation commit — the tree the acceptance
evidence belongs to. A commit cannot contain its own hash, so the branch tip
necessarily sits further along; the tip SHA is what GitHub reports as the PR head
and what CI validates.

The extra commits beyond `CANDIDATE_SHA` carry **no production-code change**. The
claim is checkable rather than asserted:

```text
git diff --name-only bc2487401bb5b0cf1689638b14e260c664253a23 <branch tip>
```

must list only paths under `Update-Plan/Autonomous-Evolution-Phase0/` plus
`tests/unit/root-authority.test.ts`. `evidence/final-readiness.json` records
`headSha` = the commit whose tree the gate chain was last executed against.

One change beyond documentation is worth naming: the "policy must not carry
secret material" test originally used a format-valid `ghp_…` canary, which GitHub
secret scanning can reasonably mistake for a real personal access token. It now
uses a generic token-shaped value that still exercises the same detector
(`src/shared/secret-scan.ts`) without producing a false credential alert on a
repository whose entire point is credential hygiene.

---

## 1. The two readiness conclusions, kept separate (§21)

### A. `READY_FOR_CONTROLLED_AUTONOMOUS_EVOLUTION = TRUE`

| Requirement (§21.A) | Result |
|---|---|
| Stable / Candidate isolation | PASS |
| Root Authority | PASS |
| Protected Surface | PASS |
| Credential Boundary (code) | PASS |
| Emergency Stop | PASS |
| Rollback | PASS |
| Adversarial tests | PASS (25 / 25) |
| Existing regression | PASS (855 / 855) |

The necessary condition list is satisfied. The system is safe to run under
**controlled** autonomous evolution: a Candidate may work, verify, crash and be
replaced, and the Root boundaries hold throughout. The one thing that will not
happen yet is an unattended remote promotion — that parks in `BLOCKED_EXTERNAL`
rather than proceeding, which is the behaviour the plan asks for.

### B. `READY_FOR_UNATTENDED_PROMOTION = BLOCKED_EXTERNAL`

§21.B requires a *configured* dedicated Boss GitHub identity with no bypass and no
repository administration, plus live evidence of branch push, PR creation, CI read
and an ordinary merge. None of that can be demonstrated here, and §21.B forbids
substituting the Owner credential for the verification. Every sub-check is
therefore reported as `BLOCKED_EXTERNAL`, not as PASS, and not as FAIL — the code
path is implemented and unit-exercised, but the external precondition does not
exist.

---

## 2. Blocker detail (the only one)

| Field | Value |
|---|---|
| Item | Dedicated Boss GitHub identity |
| What is missing | A Boss-owned GitHub App or bot account credential with `contents:write`, `pull_requests:write`, `checks:read` only — no repository administration, no ruleset bypass |
| Blocker | `BLOCKED_EXTERNAL` |
| Required external action | Create that identity, grant it the three scopes above and nothing more, then expose its token to Boss as `CODEX_BOSS_GITHUB_TOKEN` (and its login as `CODEX_BOSS_GITHUB_IDENTITY`) |
| Does it affect Controlled Evolution? | **No.** Local Candidate construction, verification, review, isolation, emergency control, rollback and the entire Root boundary work without it |
| Does it affect Unattended Promotion? | **Yes.** Without it, every remote promotion stops at `BLOCKED_EXTERNAL` |
| Was the Owner credential used instead? | **No.** `EnvironmentBossGitHubCredentialProvider` reads only `CODEX_BOSS_GITHUB_TOKEN` / `BOSS_GITHUB_TOKEN`; a credential byte-identical to an ambient Owner token is refused, and a credential whose identity is the Root Owner is refused. RT-22 asserts that a missing credential produces **zero** HTTP requests |

`UNEXPECTED_FAIL: 0` and `REGRESSIONS: 0`: every gate that could run, ran and
passed. The four `NOT_RUN` entries in the benchmark transcript
(`realProviderRecovery`, `machinePowerLoss`, `engineeringCompletionRates`,
`semanticApplicationCoverage`) are `NOT_RUN` by `scripts/benchmark.cjs`'s own
design at this baseline; they were left exactly as found rather than converted
into anything.

---

## 3. What was proven, in one paragraph

Not that Boss is willing to obey the Owner. Rather: **even if an autonomous
worker produces an over-reaching plan, wrong code, bad judgement or hostile-style
output, it can only damage the Candidate. It cannot seize the Root, cannot
silently weaken a gate, cannot borrow Owner credentials to exceed its authority,
cannot pollute Stable — and only a Candidate that satisfies the exact-SHA evidence
contract can be promoted.** The 25 red-team cases and 5 combined
failure-isolation cases are the operational form of that sentence, and they run
against real git repositories, real filesystem junctions, real subprocesses and
real files.

---

## 4. Closeout conditions (§25)

| # | Condition | Status |
|---|---|---|
| 1 | Existing full regression PASS | ✅ 93 files / 855 tests, 0 failed |
| 2 | New Root tests PASS | ✅ F1 43/43, F4 10/10, F5 27/27 |
| 3 | New isolation tests PASS | ✅ F2 17/17, F3 16/16, F6 10/10, F7 15/15, FI 5/5 |
| 4 | Every red-team case behaves as expected | ✅ 25 / 25 |
| 5 | Candidate crash does not affect Stable | ✅ RT-18, RT-19, FI-01, FI-02 (real child-process crash) |
| 6 | Exact-SHA promotion PASS | ✅ RT-14, RT-15, F5 exact-SHA battery |
| 7 | Owner-credential fallback proven absent | ✅ RT-22, RT-23, F3 provider battery |
| 8 | CODEOWNER paths correctly trigger `REQUIRE_OWNER` | ✅ RT-09..RT-13, owner-authority battery |
| 9 | Emergency freeze still effective after restart | ✅ F7 restart-durability case; state re-read from disk on every call |
| 10 | Evidence complete | ✅ §22 file set present under `evidence/` |
| 11 | No ordinary product feature mixed in | ✅ `FUTURE-OPPORTUNITIES.md`; §18 list untouched |
| 12 | Final PR created or ready | ✅ [PR #1](https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/1) opened from this branch; Root Surface review expected |
| 13 | Harness did not use an Owner bypass to merge | ✅ nothing was merged; no ruleset, CODEOWNERS or required check was altered |

---

## 5. Expected terminal state

This branch modifies CODEOWNERS-protected surfaces
(`/electron/root-authority/`, `/electron/credential-boundary/`,
`/electron/stable-candidate/`, `/electron/promotion-gate/`,
`/electron/emergency-control/`, `/electron/root-recovery/`,
`/src/**/root-authority/`, `/.codex-boss/root/`, and the Root-invariant test
paths), so GitHub requiring a Code Owner review from `@zhiheng-zhang-Mera` is the
**success condition** of this round, not a failure. The harness deliberately did
not:

- merge with an Owner bypass;
- remove or weaken `.github/CODEOWNERS`;
- lower a required check, or edit the ruleset;
- change required-approval logic to route around the Code Owner;
- self-approve using the Owner identity.

After the Owner approves and this lands on `main`:

```text
main
 -> tag autonomous-evolution-baseline
 -> Harness's ordinary construction duties end
 -> Boss Autonomous Evolution Phase 1 begins
```

From that point the harness's role is External Auditor / Red-Team / Emergency
Recovery / Independent Acceptance (§26), not primary construction team.
