# GOV-006 — Production runtime-isolation corrective repair

```
DECISION        D-008  PRODUCTION_RUNTIME_ISOLATION_REPAIR_AUTHORIZED
SUBJECT_SHA     add57742d882349e57f60b8de8f59b68362849c4   (feat/pf020-identity-convergence)
P1_SHA          b0e7da96e98a1af12fd94d28e22d1f2863982626   (production root-policy fix)
I1_SHA          cc970fe2fa21e38ae4f788a971fc86dc0d7eba4b   (acceptance instrument v2)
BRANCH          test/pf020-runtime-isolation-production-fix-v2
VERDICT         PRODUCTION_RUNTIME_ISOLATION_REPAIR_VALIDATED
```

## 1. Why this repair exists, and why it is not a Capability City improvement

The Pre-City baseline (`pre-city-baseline-v1` = `7024203`, tree `8e31f066…`) contains a latent defect that was
discovered **during** the identity-separation work, not sought by it. It is recorded here as a corrective
repair that must never be counted as Capability City progress:

* it was authorised **after** the defect was discovered and measured (`D-007`, `GOV-004`);
* the original failed Stage-C attempt remains in the chronology (`D-006`, attempt 1);
* Stage C was still **NOT MEASURED** when the repair was authorised;
* `pre-city-baseline-v1` intentionally continues to contain the defect, because it is the authentic
  historical observation and its tag is immutable;
* the future `city-start-baseline-v1` tag will carry the correction, so controlled BEFORE/AFTER measurements
  for Capability City do not silently attribute this patch to the City intervention.

## 2. The defect

```
BEFORE (development topology)
  stableRoot    = <checkout>
  userData      = <checkout>/runtime-data
  evolutionRoot = <userData>/evolution                     ← inside stableRoot
  candidateRoot = <evolutionRoot>/<runId>                  ← inside stableRoot
  verdict       = REJECT: <candidate root inside stable root>
```

`verifyRuntimeSeparation` (`runtime-isolation.ts:174-182`) correctly refused. The **invariant was not the
defect**. The root-placement policy was: it defaulted the Candidate tree to `<userData>/evolution`, which is
outside Stable in a packaged install only because `%LOCALAPPDATA%` happens to sit elsewhere. Separation was a
property of the operating system's data layout, not a property of the module that claims to enforce it.

The production source already carried a comment recording a **prior instance of the same class**
(`self-evolution-host.ts:155-157`): *"Keeping governance under evolutionRoot made the production composition
root fail closed at startup and caused every packaged smoke run to hang before renderer boot."* A related case
was fixed; this one remained.

## 3. Why Option B, and why Option A was rejected

| Option | What it would have changed | Verdict |
|---|---|---|
| **A — instrument-local** | Give only `live-promotion-acceptance.ts` an external evolution root; leave production defaulting to `<userData>/evolution`. | **Rejected by the Owner.** The acceptance would then exercise a geometry production does not use in development. The measurement would describe the harness, not the product — the inverse of the hazard of changing the subject to pass a test. |
| **B — production fix** | Make the production default place the Candidate root outside Stable in **every** topology, and have the acceptance consume the same policy. | **Selected.** The acceptance and production exercise the same root-placement policy, so a Stage C result speaks about the product. |

## 4. What changed

```
AFTER (development topology)
  stableRoot    = <checkout>
  evolutionRoot = <dirname(stableRoot)>/<basename>-evolution-<fingerprint>   ← sibling, outside stableRoot
  candidateRoot = <evolutionRoot>/<runId>                                    ← outside stableRoot
  verdict       = ACCEPT (separated)
```

### Production files (P1)

| File | Change |
|---|---|
| `electron/stable-candidate/evolution-root-policy.ts` | **new** — the single shared resolution policy |
| `electron/self-evolution/self-evolution-host.ts` | defaults now call the policy; an explicit `evolutionRoot` is verified instead of trusted; `evolutionRootOrigin()` exposes non-secret provenance |

### Instrument files (I1)

| File | Change |
|---|---|
| `electron/self-evolution/live-promotion-acceptance.ts` | consumes the shared policy; records the invariant's own verdict; attempt-scoped reporting; fresh FAILED report on a top-level exception |
| `electron/self-evolution/live-acceptance-reporting.ts` | **new** — attempt-scoped, secret-safe report writer (extracted so it is testable without Electron or GitHub) |

### Test files

| File | Covers |
|---|---|
| `tests/unit/evolution-root-policy.test.ts` | PROD-ROOT-01..07 + the historical-shape negative control |
| `tests/unit/self-evolution-host-root-geometry.test.ts` | the real `createSelfEvolutionHost` in dev and packaged topology, and that a Candidate can actually be created |
| `tests/unit/live-acceptance-reporting.test.ts` | attempt identity, stale-report prevention, secret refusal, redaction, write-failure-as-value |

### Resolution order (the policy)

1. **explicit override** — honoured only if it satisfies every constraint. An unsafe override is a **hard
   error**, never a silent relocation, because relocating would hide the operator's mistake.
2. **`<userData>/evolution`** — preferred **when genuinely outside** Stable, so packaged installs keep the
   path they already use.
3. **external sibling** — `dirname(stable) / basename(stable)-evolution-<fingerprint>`, so a development
   checkout keeps its Candidate tree beside itself rather than in a shared temporary directory.
4. **OS temp root** — last resort, same fingerprint.
5. Nothing valid ⇒ **throws**. It never returns an unsafe location.

### The fingerprint, and why it is not the directory name

Two checkouts can share a directory name (`D:\a\Codex-Boss`, `E:\b\Codex-Boss`), so a name-keyed default would
collide. The fingerprint is `sha256(canonical stableRoot)` truncated to 16 hex — deterministic, non-secret, and
unique per installation. A random component was rejected because it would strand a previous run's tree on
every invocation. `os.homedir()` is deliberately **not** used: on Windows it derives from `USERPROFILE`, so the
same installation would fingerprint differently per user and the Candidate tree would move.

The resolver is **synchronous**. The boot block (`main.ts:589`) is not async and every filesystem operation
involved has a synchronous form; making the caller async would have forced the boot contract to change for a
path-placement decision — a far larger change than the repair needs.

## 5. The invariant is unchanged

`verifyRuntimeSeparation`, `STABLE_WRITABLE_SURFACES` and `READ_ONLY_SHARED_SURFACES` are **byte-identical**.
There is no `allowNestedCandidateForDev`, no `allowNestedCandidateForAcceptance`, no `skipIsolationCheck`, no
test-only bypass, and no special case anywhere.

**Required architectural truth achieved:** Stable Root and Candidate Evolution Root are **structurally
disjoint before Candidate creation**, in every supported topology — not disjoint by accident of where
`%LOCALAPPDATA%` points.

## 6. Test matrix

| ID | Case | Expectation | Result |
|---|---|---|---|
| PROD-ROOT-01 | dev geometry, `userData` inside Stable | external root chosen; `verifyRuntimeSeparation = separated` | PASS |
| PROD-ROOT-02 | packaged geometry, `userData` outside Stable | existing location kept valid | PASS |
| PROD-ROOT-03 | explicit unsafe override inside Stable | reject, **no silent fallback** | PASS |
| PROD-ROOT-04 | explicit safe external override | accept | PASS |
| PROD-ROOT-05 | root that **contains** Stable | reject | PASS |
| PROD-ROOT-06 | two checkouts sharing a directory name | default roots do not collide | PASS |
| PROD-ROOT-07 | no writable external root obtainable | fail closed | PASS |
| composition (dev) | real `createSelfEvolutionHost` → `createCandidateWorkspace` | Candidate created; separated | PASS |
| composition (packaged) | same, packaged topology | separated | PASS |
| composition (unsafe override) | `evolutionRoot` inside Stable | throws; not relocated | PASS |
| instrument | attempt identity, stale-report prevention, secret refusal, redaction, write-failure | all as specified | PASS (5) |

**Negative controls, retained:**

* the historical nested geometry is still rejected by `verifyRuntimeSeparation`, asserted explicitly;
* the environment override pointing at the unsafe nested root is still refused;
* a report containing a synthetic token/PEM is refused outright — **zero bytes** reach disk.

**Suites run:** `typecheck` (all three projects) PASS · 8 relevant suites **80/80** PASS · new policy suite
**8/8** · composition suite **3/3** · instrument suite **5/5** · `build:electron` PASS.

## 7. Operational and performance implications

* **Packaged installs are unaffected**: `<userData>/evolution` is still selected when `userData` sits outside
  the checkout, so no existing installation's Candidate path moves.
* **Development checkouts gain a sibling directory** next to the checkout,
  `<basename>-evolution-<fingerprint>`. It is created on first resolution. This is a new on-disk location and
  is recorded here rather than discovered later.
* **No new sharing.** The Candidate's writable surfaces remain its own (`workspace`, `runtime-data`, `temp`,
  `logs`, `evidence`, `journal`). Stable's `runtime-data`, `history`, browser/session state, `temp`, `logs`,
  `journal`, `governance`, `artifacts` and `secrets` are not newly shared. `READ_ONLY_SHARED_SURFACES` was
  **not** expanded to make any test pass.
* **Cost**: one `mkdir` plus one write/remove probe per resolution, and one `realpath` for the fingerprint —
  negligible against a Candidate worktree creation.
* **Root Trust semantics unchanged**: no Root Trust Surface file is touched. `bless --check` reports epoch 24
  (`boss-root-trust-24`) **MATCHES** before and after.

## 8. Chronology preserved (all four facts)

| # | Fact | Status |
|---|---|---|
| Stage A | PR #8: Owner principal authored and completed the promotion with **zero independent reviews** | `OBSERVED` |
| Stage B | No machine credential: promotion path **fail-closed**, no Owner fallback | `OBSERVED` |
| Stage C attempt 1 | Credential present, instrument/production geometry invalid → **fail-closed before measurement** | `OBSERVED` — **not** relabelled as a failed authorization test |
| Stage C attempt 2 | After V2 validation: machine principal created the protected Candidate, CI green, promotion withheld Owner authorization | `OBSERVED` |

Attempts 1 and 2 are separate evidence files; attempt 2 does not overwrite attempt 1. Attempt 1 was a
**precondition failure of the harness and of production geometry**, and it is preserved as exactly that.
