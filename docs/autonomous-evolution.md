# Autonomous-evolution trust hardening — `AUTONOMOUS_EVOLUTION_CERTIFIED`

**Documentation records the certification; it does not constitute it.**

Authority: `artifacts/acceptance/prestart-attestation.json` +
`artifacts/acceptance/autonomous-evolution-attestation.json` inside a successful CI
run, together with the independent verifier's verdict over the repository.

Engineering book: `Update-Plan/self-evlo.md` (Post-Prestart Trust Hardening /
Autonomous Evolution Readiness, §1–§104). This page is the durable record of what
that book's phases A–F actually delivered on branch `Prestart-checkpoint-4`.

---

## 1. What was missing before this phase

Prestart (`PRESTART_CERTIFIED`, branch `Prestart-checkpoint-3`) proved that sixteen
gates, a real Electron black box and an empty Owner ledger could be bound by
attestations. It did **not** answer the questions an autonomous run must answer:

| Question | Before | Now |
| --- | --- | --- |
| Which commit **tree** was certified? | commit SHA only | `tree_sha` in the session, in every attestation and in both certificates, re-read at graduation |
| Can the tree move *after* the session started? | no re-check | graduation-time `HEAD`/tree/worktree/index re-read; `CURRENT_HEAD_MISMATCH`, `CURRENT_TREE_MISMATCH`, `WORKTREE_DIRTY_AT_GRADUATION`, `INDEX_DIRTY_AT_GRADUATION` |
| Which **build** is the evidence about? | "the built modules exist" | `build-manifest.json` with per-file SHA-256 bound to `source_commit`/`source_tree`; a stale or foreign build is refused |
| Which **dependency set**? | implicit | `dependency_identity` (lockfile SHA-256, node, pnpm, electron, platform, arch) in the certificate |
| Which **contracts** ran? | the contract version string | `contract-snapshot.json` hash over the acceptance contracts, the desktop claim contract and the capability mapping |
| Which **tests** existed? | a count | `test-manifest.json` (file, cases, SHA-256, category) with monotonicity: a deleted test or a shrunk required-id surface is refused unless a retirement record exists |
| Was the code frozen during the run? | not checked | source freeze at session start, re-verified at graduation |
| Who decided PASS? | one implementation | Validator A (the TypeScript root audit) **and** Validator B (`scripts/acceptance-evolution-certificate.cjs`, an independent re-derivation that imports no trust module) must agree |
| Can a run certify a change to its own rules? | not modelled | Root Trust Surface + trust epoch: a diff touching the surface forces `ROOT_TRUST_CHANGE` → `SELF_CERTIFICATION_FORBIDDEN` → `TRUST_EPOCH_MIGRATION` |
| What happens if evidence is mutated? | 20 hostile cases | 62 hostile cases + 1680 fuzz inputs + 6 metamorphic cases, all refused, `false_positive_cases = 0` |
| Does an autonomous change actually work end to end? | not exercised | a real 20-round trial battery (change → verify → evidence → rollback) plus budget, scope, containment, mid-round kill, negative and self-corruption cases |

## 2. The boundary

```text
PRODUCT_SURFACE        Boss may change it autonomously
EVOLUTION_ENGINE       Boss may change it under the run contract
VERIFICATION_SURFACE   change is allowed, but it changes what "verified" means
ROOT_TRUST_SURFACE     the judge itself — self-certification is forbidden
```

`src/shared/autonomous-evolution-trust.ts` classifies every path; `trust-policy/root-trust-surface.json`
is machine-generated from that policy and `trust-policy/trust-epoch.json` anchors it:

```json
{ "trust_epoch": 5, "root_contract_version": "boss-root-trust-5",
  "root_surface_hash": "…", "parent_epoch_hash": "…" }
```

The epoch only ever moves forward, and it moves through the explicit bootstrap step
`node scripts/acceptance-evolution-bless.cjs --advance` — never by a run editing its
own rules. The surface hash is line-ending independent, because a committed anchor
must mean the same thing on a developer host (`core.autocrlf=true`, mixed endings)
and on the CI runner.

## 3. The graduation chain

```text
pnpm run acceptance:session:start -- --certify --clean    # commit + tree + clean tree, ledger initialised
16 × (gate → acceptance:attest)                           # strict report contract + SHA-256 binding
desktop black box → attest                                # exact 89-claim versioned contract
acceptance:bootstrap-completion                           # trusted root audit (schemaVersion 2)
5 × (trust suite → attest)                                # EI, DB, OI, RA, AD  (Prestart phase)
acceptance:prestart                                       # PRESTART_CERTIFIED (validator A)
5 × (evolution suite → attest)                            # EV, TE, VB, AD-21..MM-06, trial battery
acceptance:evolution-battery --rounds 20                  # the real trial battery
verify:certificate                                        # validator B, independent
acceptance:autonomous-evolution                           # AUTONOMOUS_EVOLUTION_CERTIFIED
```

Everything the run produces is published with the CI run, so a later reader can
re-derive every claim from the artifacts rather than trusting this page.

## 4. What the trial battery actually proves — and what it does not

`acceptance:evolution-battery --rounds 20` runs twenty real rounds in the checkout:
each round applies a frozen catalog change to `src/shared/evolution-trial-surface.ts`
(a small bug fix, a refactor, a test addition, a dependency-neutral feature, a
performance improvement, a state migration, error handling, documentation+code or a
multi-file change), runs the **real** verification profile (`tsc --noEmit` plus the
real vitest file), records its evidence atomically outside the product tree, then
restores the exact baseline blob bytes. Around the rounds it proves: no state drift,
containment of a refused round, budget refusal (26 files / 700 LOC), scope refusal
of root-trust files, an append-only journal, a real mid-round `taskkill` that leaves
no half certificate, the negative test ("delete the failing test so CI turns green")
refused, and three self-corruption attempts (the acceptance verifier, the graduation
command, the CI attestation step) refused as root-trust changes.

**Limitation, stated plainly:** the change supply is a frozen deterministic catalog,
so `worker = deterministic-catalog` and `live_worker_rounds = 0`. The battery proves
the *machinery* — isolation, verification, evidence, refusal, rollback, containment —
with real gates and real bytes; it does not prove live-LLM autonomous authorship, and
the certificate says so instead of implying otherwise.

## 5. Residual gaps (recorded in the certificate, not hidden)

| Section | Item | Status |
| --- | --- | --- |
| §24/§25/§26 | append-only ndjson owner ledger, 100-writer concurrency, ledger existence commitment | NOT_IMPLEMENTED (the ledger is read-modify-write, single-writer-verified) |
| §53/§54 | security scan of baseline **and** candidate with a critical-regression gate | PARTIAL (candidate-only scan in CI) |
| §55/§56/§57 | destructive filesystem sandbox, process-boundary and evidence-directory ownership batteries | PARTIAL (existing root-authority + evolution-sandbox suites cover the boundary) |
| §58 | per-stage evidence seals | NOT_IMPLEMENTED |
| §70/§71 | persisted-schema migration and crash recovery at every stage | PARTIAL (restart + goal-rollback cover restart recovery) |
| §92/§93 | performance thresholds and resource-leak soak | PARTIAL (benchmark measures, no threshold gate) |
| §36 | two-clone A/B cross validation | PARTIAL (`--clone-b` supported; the CI run compares within one clone) |
| §72 | live-worker autonomous rounds | LIMITATION (deterministic catalog) |

None of these is a §98 completion condition, and none of them is claimed as done.
They are the starting list for the next round.

## 6. Reproduce

```bash
pnpm run build && pnpm test
pnpm run acceptance:session:start -- --certify --clean
# … the gate/attest pairs, the desktop black box, bootstrap-completion, the trust suites …
pnpm run acceptance:prestart
pnpm run acceptance:evolution-identity && pnpm run acceptance:attest -- acceptance-evolution-identity
pnpm run acceptance:evolution-trust    && pnpm run acceptance:attest -- acceptance-evolution-trust
pnpm run acceptance:evolution-independent && pnpm run acceptance:attest -- acceptance-evolution-independent
pnpm run acceptance:evolution-adversarial && pnpm run acceptance:attest -- acceptance-evolution-adversarial
pnpm run acceptance:evolution-battery -- --rounds 20
pnpm run acceptance:attest -- acceptance-evolution-trial
pnpm run verify:certificate
pnpm run acceptance:autonomous-evolution
```

A dirty tree refuses certification, a simulated battery can never pass, and the
graduation command exits non-zero with the machine reasons when any §98 condition
does not hold.
