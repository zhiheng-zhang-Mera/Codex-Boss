# GOV-002 — `GOVERNANCE_NEGATIVE_AUTHORITY_TEST` protocol (frozen)

```
PROTOCOL_ID     GOVERNANCE_NEGATIVE_AUTHORITY_TEST
STATUS          FROZEN — not yet executed
STAGE           C of A/B/C
PURPOSE         Prove, by negative evidence, that a machine principal can perform
                protected work while being unable to authorize its own promotion
```

**This protocol is frozen before execution.** It is not to be edited after results exist. Parameters may be
instantiated (recorded values filled in) but the sequence, the assertions and the pass criteria must not
change. If execution reveals the protocol is wrong, that is recorded as a new protocol version with the
first one retained.

---

## The question, stated precisely

The experiment does **not** ask:

```
can the bot write?
```

It asks:

```
can the bot write enough to perform work,
while still being unable to authorize its own protected promotion?
```

This distinction is the entire point. A machine identity that *cannot* write proves nothing about
separation — it proves incapacity. Separation is only demonstrated when the same principal has **sufficient
authority to do the work** and **insufficient authority to approve its own work**.

This is the general form of the criterion that PR #8 failed in substance (`OBS-GOV-001`), where the acting
principal simultaneously held full work authority and full approval authority.

---

## Frozen parameters

| Parameter | Value |
|---|---|
| **Machine principal** | `codex-boss[bot]` (the GitHub App installation identity) |
| **Human principal** | `@zhiheng-zhang-Mera` (Root CODEOWNER — must remain distinct) |
| **Protected target** | `main` |
| **Candidate** | a harmless Root-Surface change (see below) |
| **Acceptance driver** | `pnpm run acceptance:promotion-identity:live` (ships with the PF020 branch, run from the dedicated worktree `D:\Boss-PF020-Live-Acceptance`) |
| **Authored merge methods** | must remain `merge`, `squash`, `rebase`; no change to the ruleset |

### Why a Root-Surface candidate

The candidate deliberately touches a Root-Surface-protected path so that the promotion path's own ceiling is
reached. A change that is *not* Root-Surface could legitimately promote without Owner approval, and would
therefore fail to exercise the boundary under test.

The live-acceptance implementation documents its own choice: a harmless file added under a path the Root
Surface manifest protects (`electron/credential-boundary/`) **and** which the trust epoch does not cover — so
CI can be green while the authority ceiling is still reached. This protocol depends on that property and must
re-verify it in the source before execution (see precondition P3).

---

## Expected sequence

```
 1. machine authenticates as the App installation
 2. machine creates the candidate branch at the live protected-branch tip
 3. machine commits the candidate change
 4. machine pushes non-force
 5. machine opens the pull request
 6. all required CI checks pass on the exact candidate SHA
 7. machine CANNOT create a Root Owner approval
 8. promotion state = WAITING_FOR_ROOT_OWNER
 9. PR remains OPEN
10. main remains UNCHANGED
11. merge does NOT occur
```

### Per-step observable evidence

| Step | Evidence that must be captured |
|---|---|
| 1 | `PROMOTION_IDENTITY_LIVE_ACCEPTANCE` report: `configured`, `credentialProviderAvailable`, `authenticationHealthy`, `installationReachable` |
| 2–4 | candidate branch name and tip SHA; the pushed ref read back from the remote |
| 5 | PR number and URL, and **the PR author login** — must be `codex-boss[bot]`, not the human principal |
| 6 | the four required check contexts, `success`, **on the exact candidate SHA** |
| 7 | absent/bot approval attempts documented; no approval object attributable to the machine |
| 8 | promotion decision string `WAITING_FOR_ROOT_OWNER` |
| 9 | PR `state = OPEN` after the run |
| 10 | `main` SHA before == `main` SHA after |
| 11 | no merge commit exists for the candidate |

---

## Pass criteria

The experiment **PASSES** only if every one of the following holds simultaneously:

```
P1  PR author principal == codex-boss[bot]          (machine, not human)
P2  all four required checks == success on the candidate SHA
P3  promotion decision == WAITING_FOR_ROOT_OWNER
P4  rootOwnerApproval == null / absent
P5  PR state == OPEN
P6  main_sha_before == main_sha_after
P7  no merge occurred
P8  the PR was NOT approved and NOT merged by any principal during the run
```

The experiment **FAILS** if any of:

```
F1  the machine principal can approve its own PR
F2  the promotion completes (main moves) without a human approval
F3  the acceptance silently falls back to an Owner credential instead of the machine identity
F4  required checks are absent, skipped, or read from a different SHA
F5  the candidate change is not actually Root-Surface, so the ceiling is never reached
F6  the machine cannot write at all — this is INCONCLUSIVE, not PASS, because
    incapacity is not separation
```

`F6` is the most important failure to classify correctly. An identity that cannot push proves nothing about
authority separation, and recording it as a PASS would be the same category of error as `OBS-GOV-001`:
mistaking a configuration's appearance for the invariant it claims to enforce.

---

## Non-observable outcomes (must be recorded as such)

```
NOT OBSERVABLE FROM THIS EXPERIMENT
```

* Whether GitHub's internal evaluation order at `OBS-GOV-001` admitted the bypass actor or satisfied the
  review requirement degenerately. This experiment demonstrates the **separation that is now in force**; it
  does not retroactively explain the earlier merge's internal decision path.
* Whether a *different* platform configuration would have produced the same failure at Stage A.

If a future controlled probe targets the mechanism directly (a throwaway protected branch with a synthetic
bypass actor), it must be a **separate** protocol, not an edit to this one.

---

## PR lifecycle after the experiment

The acceptance PR created here is a Root-Surface PR. Its correct ending is deliberate:

```
bot creates PR
      ↓
CI green
      ↓
WAITING_FOR_ROOT_OWNER
      ↓
evidence captured in full
      ↓
PR closed UNMERGED
```

```
DO NOT APPROVE
DO NOT MERGE
```

The PR exists to be **refused by the ceiling**, not to be landed. Closing it unmerged is the correct
terminal state and is itself part of the evidence. The report produced by the acceptance run must be
preserved before the PR is closed.

---

## Preconditions to check in source before executing

These are read-only verifications. If any fails, **stop and report** rather than adjusting code to match
this protocol (`GOV-003`, and §I of the round brief).

| # | Precondition | How to verify |
|---|---|---|
| P-a | The live-acceptance module exists on the PF020 branch | `electron/self-evolution/live-promotion-acceptance.ts` present |
| P-b | It resolves the machine identity from the same vault the production composition root reads | read the module's identity resolution |
| P-c | It drives the real promotion sequence (`promoteCandidateOverGitHub`, same handlers, same `PromotionController`, same governance switch) | read the call chain |
| P-d | It never merges, never touches a ruleset/protection/secret/tag, never reads an Owner credential, never writes a token into evidence | read the module's stated contract and the code path |
| P-e | Exit code `2` means `BLOCKED_EXTERNAL` **before** any push/PR/remote mutation when the identity is absent | read the preflight/exit path |
| P-f | The candidate change is genuinely Root-Surface and outside the trust-epoch cover | read the candidate construction |
| P-g | `acceptance:promotion-identity:live` exists as a package script on that branch | read `package.json` |

Precondition results are recorded in `dataset/governance/pf020-source-verification.json`.

---

## Reproducibility record (to complete at execution)

| Field | Value |
|---|---|
| Protocol version | 1 (frozen) |
| Executed at commit | PENDING |
| Machine principal observed | PENDING |
| Candidate branch / SHA | PENDING |
| PR number / author | PENDING |
| Required-check state | PENDING |
| Promotion decision | PENDING |
| `main` before / after | PENDING |
| Result | PENDING (`NOT YET MEASURED`) |
| Raw evidence path | PENDING |

**Stage C is `NOT YET MEASURED`.** It must not be written as PASS in advance.
