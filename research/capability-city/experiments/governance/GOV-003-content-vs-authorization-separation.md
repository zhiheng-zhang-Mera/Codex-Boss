# GOV-003 — Content validity vs authorization-process validity

Two properties of the same event, which must never be collapsed into one another.

```
CONTENT_BASELINE_VALID                        C1
PROMOTION_AUTHORIZATION_PATH_NONCONFORMING    C2
```

Both are true of the promotion recorded in `OBS-GOV-001`. Neither implies the other, and the inference from
C1 to `PROMOTION_IDENTITY_SEPARATION_PROVEN` is **invalid**.

---

## C1 — Content validity

```
CONTENT_BASELINE_VALID
```

**Claim.** The software content that was promoted is the verified Pre-City baseline.

**Supporting evidence (all measured):**

| Evidence | Value |
|---|---|
| RC tree == promoted `main` tree | `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5` == `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5` |
| `git diff 836b5ed origin/main` | **empty** (0 lines) |
| `git diff pre-city-baseline-v1 origin/main` | **empty** (0 lines) |
| `pre-city-baseline-v1^{tree}` | `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5` — binds the promoted content |
| Required checks on the candidate SHA | `quality`, `unit`, `acceptance`, `package` all `success` |
| Local acceptance chain at the candidate SHA | `PRESTART_CERTIFIED`, `AUTONOMOUS_EVOLUTION_CERTIFIED`, 16/16 gates, 89/89 desktop claims, 13/13 capabilities, 0 owner interventions |
| Root Trust | epoch 24 (`boss-root-trust-24`) `MATCHES`; surface unchanged |

**What this proves:** the promoted artifact is the verified Pre-City baseline, content-addressed and
reproducible. `main` and the tag can be relied on as the measurement baseline for the Capability City
programme.

**What this does NOT prove:** anything about who authorized it, or whether authorization was independent.

---

## C2 — Authorization-process validity

```
PROMOTION_AUTHORIZATION_PATH_NONCONFORMING
```

**Claim.** This promotion cannot be used as evidence that Boss and Owner identities are operationally
separated.

**Supporting evidence (all measured):**

| Evidence | Value |
|---|---|
| PR #8 review count | **`0`** — `reviews: []`, `latestReviews: []`, `reviewDecision: ""` |
| Author principal | `zhiheng-zhang-Mera` |
| CODEOWNER principal | `@zhiheng-zhang-Mera` — **identical** |
| Merging principal | `zhiheng-zhang-Mera` — **identical** |
| Independent CODEOWNER approval | **absent** |
| `require_code_owner_review` at merge time | `true`, ruleset `updated_at` predates the programme |
| Protected path in the patch | `/package.json` — correctly matched by CODEOWNERS |
| Bypass actors | one `User` actor (`229580437`), `bypass_mode: always`; `current_user_can_bypass: always` |
| Platform refusal of the separating action | `Review Can not approve your own pull request` |

**What this proves:** the promotion completed with **zero independent authorization**, performed by the same
principal that authored the change, at a moment when the code-owner requirement was live and the protected
path was correctly matched.

**What this does NOT prove:** see "Non-observable" below.

---

## The invalid inference, named

The following inference is **forbidden** in every paper, report and commit message of this programme:

```
CONTENT_BASELINE_VALID
        ⊬
PROMOTION_IDENTITY_SEPARATION_PROVEN
```

Two concrete forms of the error, both of which this programme actually committed or nearly committed:

| Error | Why it is wrong |
|---|---|
| "The checks were green and the tree matches, so the promotion was properly authorized." | The checks and the tree are properties of the **content**. Authorization is a property of the **process**. PR #8 is the counterexample: all content evidence was impeccable and authorization was absent. |
| "The code-owner requirement was enabled, so authorization was independent." | A requirement is not an authorization. A live requirement with a degenerate actor set is satisfiable in form and empty in substance — the exact configuration observed. |

A third form, which this programme's first analysis produced and then had to retract:

| Error | Why it is wrong |
|---|---|
| "The ruleset blocked the merge, so bypass was the only path." | This was `UNVERIFIED` and turned out false: the merge succeeded. Asserting the platform's decision path from a `BLOCKED` UI status is not measurement. Retained here because a retracted inference is itself useful research material about how confidently governance mechanisms get misread. |

---

## Non-observable — required wording

```
NOT OBSERVABLE FROM CURRENT EVIDENCE
```

| Question | Status |
|---|---|
| Did GitHub evaluate `require_code_owner_review` as **satisfied** (e.g. because the reviewer identity and the author identity are the same principal)? | **Not observable** |
| Did GitHub instead admit the Root Owner through the **bypass** path (`bypass_mode: always`)? | **Not observable** |
| What is GitHub's internal evaluation order between `require_code_owner_review`, `current_user_can_bypass`, and the merge endpoint? | **Not observable** from the PR/review/ruleset APIs; requires a controlled probe |

**Permitted claim:**

> Declared authority separation was insufficient until principals were separated at the GitHub identity
> layer.

**Permitted, weaker, and directly supported:**

> The observable result was a merge with zero independent reviews, performed by the principal that authored
> the change and that held the sole always-bypass authority.

**Forbidden claim:**

```
GitHub definitely bypassed CODEOWNER review
```

This may not be asserted unless a controlled experiment or a platform API directly demonstrates the specific
decision path. It must be marked `NOT OBSERVABLE FROM CURRENT EVIDENCE` wherever the question is raised.

---

## Why the distinction is load-bearing for the research programme

**1. It protects the baseline's usefulness.** If C2's defect were allowed to invalidate C1, the programme would
lose a baseline that is in fact sound, and would have to redo a verified integration for no informational
gain. Conversely, if C1's strength were allowed to launder C2, the programme would build on an authorization
claim that is false. Keeping them apart is what makes both usable.

**2. It is the same distinction the Capability City programme must maintain throughout.** Replaceability
(`RQ2`) has exactly this shape: *the implementation changed* (content) vs *the switch was authorized and
independently validated* (process). A replacement protocol whose validator is the proposer is C2's defect
reproduced inside a capability. `GOV-002`'s negative-authority test is the general form of the check.

**3. It is why the failure was silent.** Content evidence is easy to instrument — hashes, checks, trees — and
it was all green. Process evidence requires observing *who* acted, which no architecture tool in this
repository measures. A system that instruments only content will report unqualified success for an
unqualified-authorization event.

**4. It is why validation must happen at the principal layer.** `threats-to-validity.md` §7 records that the
instrument cannot see credential-level coupling. C1/C2 is that limitation made concrete: the same event is
simultaneously excellent by one measure and nonconforming by another, and only a principal-aware measurement
distinguishes them.
