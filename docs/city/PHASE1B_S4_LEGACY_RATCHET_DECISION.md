# PHASE 1B — S4 DECISION: RETAIN THE LEGACY RATCHET

**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Decision:** `RETAIN_LEGACY_RATCHET`
**Stage:** S4 of Phase 1B (`docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md` §2.6, line 166)
**Made under:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` §13
**Prerequisite measured:** the S3 activation, `Main-Protection` ruleset id 22746755

---

## 1. The decision

```text
RETAIN_LEGACY_RATCHET
```

`pnpm run architecture:ratchet` **stays** as a step inside the required `quality` job. It is not removed, not
weakened, and not replaced.

## 2. Why, measured rather than asserted

The Phase 1B specification permits either retiring the legacy ratchet after H5 evidence, or keeping it and
recording the decision. It permits retirement only when **all four** H5 conditions hold. Measured at the moment
of this decision:

| H5 condition | Required | Measured | Satisfied |
|---|---|---|---|
| `architecture` required **and green** on `main` for a continuous window of **at least 30 consecutive promotion merges**, zero post-hoc reversals | 30 merges | **0** — the S3 activation is live from commit `476388b` onward, so the window has not started, let alone completed | **NO** |
| The new gate's findings are a **superset** of the legacy gate's detection classes on the same tree, shown by a named test or experiment per class | one named proof per class | the C9 battery and the enforcement suites exist and pass, but a **class-by-class superset mapping** has not been produced | **NO** |
| The legacy baselines show **no metric drift** unexplained by the changes in the window | no unexplained drift | no window exists yet, so this cannot be evaluated | **NO** |
| Retirement proposed with its own evidence record and performed by the Owner as a **separate** change from any activation | separate act | this decision is separate from the S3 activation, and it is a *retention*, so the condition is not reached | **N/A** |

**H5 is not satisfied, and the specific failing condition is the first one.** The honest reading is therefore to
retain.

**The workbook's own instruction is explicit about the alternative** (§13): *"Do not create meaningless PRs merely
to satisfy this number."* The 30-merge window is evidence about the new gate's behaviour under real promotion
pressure; manufacturing 30 trivial merges would produce 30 data points about nothing, which is the fabrication
the workbook forbids by name.

## 3. What this decision is, and what it is not

```text
IS      an explicit S4 Owner decision, permitted by the Phase 1B specification (line 166: "or keep it and
        record the decision not to")
IS      a recorded retention with its reason, so a later reader does not have to infer intent from absence
IS NOT  renovation debt. It must never appear in CITY_RENOVATION_DEBT_REGISTER.md, and it must not be
        represented as a failure, a compromise, or unfinished work.
IS NOT  permanent. Future retirement remains a separate Owner act, on its own evidence, per H5.
IS NOT  a claim that the legacy ratchet is superior to the new gate. It is the admission that the evidence
        required to compare them does not exist yet.
```

## 4. What actually stays running, and why that is not redundant in a bad way

```text
quality job (required, one of the five)
  pnpm run typecheck
  pnpm run security:scan
  pnpm run architecture:ratchet        <- the legacy control sensor, retained by this decision
  pnpm run state:probe

architecture job (required since S3)
  architecture:enforce:baseline:series       is the accepted baseline authorised?
  architecture:enforce:baseline -- --check   is it self-consistent with this tree?
  architecture:enforce:shadow                the engine's verdict, visible
  architecture:enforce                       the real governing evaluation
  parity + evidence assertions
```

The two gates are **different instruments with different failure modes**, which is the reason the specification
keeps both during the window:

```text
legacy ratchet    ABSOLUTE metrics against a hand-maintained baseline (bootModuleCount, capabilityCount,
                  dependencyEdgeCount, requiredEdgeCount, featureCapabilityCount, durableNamespaceCount).
                  It fails on any metric ABOVE the recorded value. Its blind spot is that it reads only the
                  declared manifest graph -- currently 3 edges against the observatory's 1671.
new engine        RELATION identities against an Owner-authorised series, with grandfathering by identity,
                  reintroduction treated as new debt, and both shadow and enforce modes sharing one evaluator.
                  Its blind spot is that its own policy refuses to claim two classes as measured
                  (dependency_cycles, cross_domain_private_state_access -- Phase 2 measurement M-xx).
```

Retaining the legacy ratchet costs a step in the required `quality` job. Retiring it early would cost the only
absolute metric guard the repository has while the new engine's two unmeasured classes are exactly the ones
Phase 2 must repair. Keeping both until the evidence exists is the cheaper error.

## 5. What would change this decision

```text
1  the 30-merge window completing with architecture green throughout and zero post-hoc reversals;
2  a class-by-class superset mapping, with a named test or experiment per legacy detection class;
3  the legacy baseline metrics showing no drift unexplained by the window's changes;
4  Phase 2 closing the new engine's two unclaimed classes (dependency_cycles and
   cross_domain_private_state_access), so that the superset claim in (2) is even meaningful;
5  a separate Owner act, with its own evidence record, taken apart from any activation.
```

Conditions 1 and 4 are programme work; 2 and 3 are records that can only be produced once 1 has run. **No
condition is a reason to pause construction.**

## 6. Status

```text
S4_LEGACY_RATCHET_DECISION = RETAIN_LEGACY_RATCHET
S4_DECISION_RECORDED      = YES (this document)
S4_DECISION_DATE          = 2026-09-24
S4_BLOCKS_CITY_COMPLETION = NO
H5_WINDOW_PROGRESS        = 0 of 30 required promotion merges (window opens at the S3 activation)
FUTURE_RETIREMENT         = a separate Owner act, on the evidence in section 5
DEBT_CREATED              = NONE (deliberately: this is a decision, not a compromise)
```
