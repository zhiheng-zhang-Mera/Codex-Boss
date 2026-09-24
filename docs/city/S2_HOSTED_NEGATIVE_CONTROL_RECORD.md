# S2 HOSTED NEGATIVE CONTROL — STAGE C (§10) EVIDENCE RECORD

**Status.** RUN, on the hosted runner, and PROVEN. This is the re-run that workbook Stage C requires and that
`docs/research/PAPER_EVIDENCE_LEDGER.md` §T-4 recorded as `NEGATIVE_CONTROL_HOSTED_EVIDENCE = NOT_YET_RUN`
after the T-5 baseline-gate repair landed.

**Why it had to be re-run.** §T established that the control was *structurally unreachable* before the repair:
the hosted `architecture` job failed at `architecture:enforce:baseline -- --check` (step 151) and the
evidence-producing steps — shadow (159), shadow-hosted (164) and enforce (212) — were **SKIPPED**. The repair
required by T-5 split two questions that had been conflated in one gate:

```text
1  ACCEPTED BASELINE INTEGRITY   is the FROZEN artifact well-formed and Owner-authorised?  (the artifact itself)
2  PROSPECTIVE ENFORCEMENT       is the CANDIDATE TREE acceptable, classified against it?   (the engine)
```

---

## 1. Experimental setup

```text
parent           5740b7ca7b83d78990d4ca14da437d8d775f9db8   (exact current main at creation)
branch           s2-negative-control-v1
experimental sha 57aeede5021f69392280cbea1bc58375fed43d82
evidence tag     city-evidence-s2-negative-control-v1
                 annotated tag object d85217d97dad63ae71e18fa4dbd5f8b55ce4ad1f  (NEVER moved)
experiment PR    #56 — CLOSED without merge; evidence comment 5823478991
injected debt    none. The line exists only on the branch and on the tag.
```

The injection is one side-effect import in a manifest-declared boot module:

```ts
// electron/bootstrap/persistence.ts
import "./theme-ipc";
```

`persistence` is a **KERNEL**; `theme-ipc` is owned by the **`theme`** feature. No manifest declares the
relation — the declared capability pairs are `knowledge -> persistence`, `research -> knowledge`,
`theme -> knowledge` — and the pair was verified **absent** from the frozen baseline's 1671 edges before
injecting. A side-effect import is used so the injection is exactly one edge and nothing else.

## 2. The requirements, and what each one measured

| Requirement | Result |
|---|---|
| baseline artifact integrity | **PASS** — exit 0; the frozen artifact's recorded hash equals the hash of its own content |
| baseline series authorization | **PASS** — exit 0; `authorized = true` in BOTH modes |
| shadow | **PASS process** — exit 0, `verdict POLICY_VIOLATION`, the violation reported |
| enforce | **FAIL process** — exit 1, `verdict POLICY_VIOLATION`, the **same** finding identity |
| engine_errors | **0** in both modes |
| legacy ratchet behaviour | **recorded** — exit 1, `kernel-imports-feature`, on the same edge |
| hosted architecture job | **reaches enforce** — steps 1–12 pass and the job fails *at* the enforce step |
| failure reason | **exactly** the injected violation, and nothing else |

## 3. Local measurement — one finding, one identity, both modes

```text
code      NEW_UNDECLARED_CROSS_CAPABILITY_EDGE
severity  VIOLATION
subject   electron/bootstrap/persistence.ts -> electron/bootstrap/theme-ipc.ts
detail    new cross-capability edge not authorized by any declaration: persistence -> theme

finding identity  sha256 b9682ef67c874267945503f4f4e9881f6beb3b33f1d7f7fd7468ac58bfa3e4b6
                  byte-identical in shadow and enforce

summary, identical in both modes
  NEW_UNDECLARED_CROSS_CAPABILITY_EDGE 1 · PASS_AS_GRANDFATHERED 1671 · NON_SOURCE_ASSET 1 ·
  NOT_YET_ENFORCED 5 · violations 1 · engine_errors 0
```

1671 inherited edges are grandfathered **by identity**; exactly one new edge is refused. The artifact-integrity
check reads `internal_edges` 1671 → 1672 and reports the drift **without failing** — which is the repair working
as specified: the frozen artifact is intact *and* the candidate tree is what prospective enforcement classifies
against.

## 4. Hosted measurement

Runs `36068999761` (push) and `36069017063` (pull_request), both on `57aeede5`:

```text
quality        FAILED at step 8   pnpm run architecture:ratchet
                 {"ratchet":"kernel-imports-feature","file":"electron/bootstrap/persistence.ts",
                  "detail":"electron/bootstrap/persistence.ts -> electron/bootstrap/theme-ipc.ts"}

architecture   FAILED at step 13  pnpm run architecture:enforce -- --out artifacts/city/phase1/engine-enforce
                 steps 1-12 PASSED -> the job REACHED enforce
                 {"verdict":"POLICY_VIOLATION"}
                 NEW_UNDECLARED_CROSS_CAPABILITY_EDGE: 1 · grandfathered_edges: 1671 ·
                 violations: 1 · engine_errors: 0

unit, acceptance, package  SKIPPED (unit needs quality) — predicted BEFORE the red existed
```

**The step number is the evidence.** Pre-repair the job died at the baseline step and shadow/enforce never ran;
post-repair the same injection reaches the enforce step. What changed is not the engine's verdict — identical
in both local measurements — but **which gate speaks first**.

## 5. Local/hosted parity

```text
                    LOCAL                                 HOSTED
verdict             POLICY_VIOLATION                      POLICY_VIOLATION
violations          1                                     1
code                NEW_UNDECLARED_CROSS_CAPABILITY_EDGE  NEW_UNDECLARED_CROSS_CAPABILITY_EDGE
grandfathered       1671                                  1671
engine_errors       0                                     0
shadow process      exit 0                                job step PASSED, violation reported
enforce process     exit 1                                job step FAILED
```

The engine's classification is identical on both hosts. The only difference is transport: local exit codes
versus hosted step outcomes.

## 6. Two gates agreed on the injected defect

§T's class-1 injection was a feature → feature edge whose legacy-ratchet row reads **PASS**. This control
injected a **kernel → feature** edge, so the legacy ratchet reports the same defect independently as
`kernel-imports-feature`. Both gates therefore name the same violation, which the feature → feature class did
not establish. This is recorded as a deliberate difference, not an incidental one.

§T-5a's separate, still-open tension is untouched here: no declaration form lets the engine accept a legitimate
new edge without raising a legacy density metric.

## 7. What this record does and does not claim

**It claims** that the S2 negative control has been executed on the hosted runner; that shadow passed the
process while reporting the violation; that enforce failed the process with the same finding identity; that the
hosted `architecture` job reached enforce; that engine errors were zero; that the failure reason was exactly the
injected violation; and that T-5's integrity split is what made any of this observable.

**It does not claim** the declaration-repair counterfactual (the legitimate fix that must turn the finding INFO
and green the engine) has been observed hosted; only its local half exists, in §T-4.

```text
NEGATIVE_CONTROL_EXECUTED        YES (local, reproducible, and now hosted)
NEGATIVE_CONTROL_HOSTED_EVIDENCE RUN — produced by runs 36068999761 / 36069017063 on 57aeede5
S2_EXIT_COMPLETE                 YES — certified in docs/city/S2_EXIT_CERTIFICATION.md (ledger CC-025):
                                 36 consecutive valid hosted runs, 0 excluded, one finding digest throughout
S3                               ALREADY ACTIVATED (ruleset edit recorded in ledger CC-011)
```

**Status note, appended.** When this record was written, the Stage D audit below it had not been performed and
`S2_EXIT_COMPLETE` was `NOT YET`. The audit has since been performed and S2 is certified exited; the statements
above about what the *control* proves are unchanged, and §7's caveat about the accepting direction still stands.
