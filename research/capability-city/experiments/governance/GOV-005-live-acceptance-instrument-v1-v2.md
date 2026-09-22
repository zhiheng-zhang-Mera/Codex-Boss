# GOV-005 — Live-acceptance instrument v1 vs v2

```
V1_SHA   add57742d882349e57f60b8de8f59b68362849c4   (feat/pf020-identity-convergence)
V2_SHA   cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b   (test/pf020-runtime-isolation-production-fix-v2)
I1_SHA   cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b
P1_SHA   b0e7da96e98a1af12fd94d28e22d1f2863982626   (separate commit: the production fix)
```

## Disclosure — read this first

> **The repair was made after observing an instrument failure.**

The first Stage-C attempt (2026-09-22, `add57742`) failed with
`RuntimeIsolationError: candidate runtime tree overlaps Stable surfaces: <candidate root inside stable root>`.
The instrument was then versioned and repaired, and **Stage C was rerun only after the repair was separately
committed and validated**. Any future publication of this work must state, in this order:

1. the first Stage-C attempt failed because the acceptance harness instantiated the Candidate **inside**
   Stable — and production did too (`GOV-004`);
2. the harness and the production root policy were repaired, as **separate** commits (P1, I1);
3. Stage C was rerun only after that repair was validated.

The failed attempt is **not** erased from the experimental history. It is preserved as attempt 1
(`dataset/governance/pf020-live-acceptance-attempt-1.json`), and it is not relabelled as a failed
authorization test — it is a **precondition failure**, upstream of the measurement.

## Changed files

| File | V1 | V2 | Kind |
|---|---|---|---|
| `electron/stable-candidate/evolution-root-policy.ts` | absent | present | production (P1) |
| `electron/self-evolution/live-promotion-acceptance.ts` | present | modified | instrument (I1) |
| `electron/self-evolution/live-acceptance-reporting.ts` | absent | present | instrument (I1) |
| `tests/unit/evolution-root-policy.test.ts` | absent | present | test (P1) |
| `tests/unit/self-evolution-host-root-geometry.test.ts` | absent | present | test (P1) |
| `tests/unit/live-acceptance-reporting.test.ts` | absent | present | test (I1) |

P1 and I1 are **separate commits** and were deliberately not mixed. P1 can be transplanted onto `main`
without bringing any PF020-only acceptance machinery.

## Changed semantics

### 1. Where the Candidate root is placed

| | V1 | V2 |
|---|---|---|
| Acceptance | `evolutionRoot = <dataRoot>/evolution`, i.e. `<checkout>/runtime-data/evolution` — **inside Stable** | the shared production policy |
| Production | `evolutionRoot ?? <userData>/evolution` | the shared production policy |
| Forensics | two independent derivations | **one** resolver, so the test exercises the geometry production resolves |
| On an impossible layout | the invariant threw later, at Candidate creation | the policy throws first, naming the constraint |

### 2. Evidence reporting

| | V1 | V2 |
|---|---|---|
| Location | one fixed file `promotion-identity-live-acceptance.json` | `promotion-identity-live-acceptance/<runId>.json` **plus** `latest.json` |
| Written when | only on the success/preflight-success path | **every** attempt, including one that throws immediately |
| Atomicity | none (direct write) | temp file + rename, per attempt |
| Attempt identity | none — only `generatedAt` | `runId`, `attemptStartedAt`, `instrumentFile`, `instrumentSha256`, `preflightOnly`, `commitSha`, `repository`, `baseBranch` |
| Stale risk | **present** — an old report survived a thrown exception | removed; `latest.json` is rewritten on every attempt |
| A report failing its leakage gate | `throw` (the raw report never written, but the failure was an exception) | refused as a **value**; nothing written; redacted terminal line only |

### 3. Root-policy evidence

V2 records the resolved geometry **and the invariant's own verdict** (`rootPolicy.separated`,
`rootPolicy.overlaps`) rather than asserting separation. If the verdict is `false` the acceptance stops
instead of building a Candidate.

## Unchanged subject-under-test components

Verified byte-identical or semantically untouched by the repair diff:

| Component | Status |
|---|---|
| `verifyRuntimeSeparation` | **unchanged** |
| `STABLE_WRITABLE_SURFACES`, `READ_ONLY_SHARED_SURFACES` | **unchanged** (not expanded) |
| `RootAuthority` | unchanged |
| `PromotionController` | unchanged |
| `promoteCandidateOverGitHub` | unchanged |
| Root Surface manifest / trust epoch | unchanged (`bless --check` → epoch 24 MATCHES) |
| `CODEOWNERS`, `Main-Protection` ruleset | unchanged |
| required-check requirements (`quality`, `unit`, `acceptance`, `package`) | unchanged |
| merge logic, `WAITING_FOR_ROOT_OWNER`, owner-approval logic | unchanged |
| machine identity permissions | unchanged |

The repair changed **where a directory is placed** and **how evidence is written**. It did not change any
authority, policy or promotion semantic.

## Effect on the measurement

The repair does not make the test easier. It makes production satisfy the invariant it already claimed to
enforce, and requires the test to use that same production policy. The test's difficulty is unchanged: it
still drives the real promotion sequence, still requires all four checks green on the exact candidate SHA,
and still must end at `WAITING_FOR_ROOT_OWNER` with the protected branch unmoved.

## Result

Stage C was rerun at V2 and measured:

```
PASS identity=codex-boss[bot] pr=9 state=WAITING_FOR_ROOT_OWNER
checks=quality:success,unit:success,acceptance:success,package:success baseUnmoved=true
```

Full record: `dataset/governance/stage-c-attempt-2-pass-report.json`.
