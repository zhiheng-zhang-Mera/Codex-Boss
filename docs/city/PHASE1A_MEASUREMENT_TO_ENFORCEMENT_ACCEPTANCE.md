# PHASE 1A — MEASUREMENT-TO-ENFORCEMENT ACCEPTANCE RECORD

This is the durable, tracked acceptance record for Capability City **Phase 1A**. It binds the runtime evidence
by SHA-256 and summarises it. The full generated dataset is deliberately **not** copied here.

| Field | Value |
|---|---|
| Specification | `docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md` |
| Spec commit | `335bf5b3a094557627eaf5d5657ae6c931f6b351` (spec alone; no implementation code) |
| Implementation commit | `b33926da42ec9d4c4ea4227d694e5ff5bd2033bc` |
| Branch | `dev/city-phase1a-enforcement-convergence` |
| Branch point | `66440c1d360362a0bba38332d385feed41b64acb` — equal to `city-phase0-observatory-v1` |
| Phase 0 base | tag `city-phase0-observatory-v1` (object `24bc1b9145cff314b389a373bf355390f55cd5cf`) → `66440c1d…` |
| Phase 0 promotion | PR #11, `merged = true`, approved by `zhiheng-zhang-Mera`, merge `66440c1d…` |
| Phase 0 post-merge CI | run **`35699482212`**, push, `head_sha = 66440c1d…`, all four required jobs success |
| Host evidence class | `LOCAL_REAL_HOST` (the Mech host) |

## Commands executed on the real host

```powershell
corepack pnpm run architecture:qualify                                       # Q-01..Q-08
corepack pnpm run architecture:observe                                       # truth sensor
corepack pnpm run architecture:enforce:baseline -- --check                   # baseline is current
corepack pnpm run architecture:enforce:shadow                                # report-only
corepack pnpm run architecture:enforce                                       # failing
node scripts/architecture-enforcement-baseline.cjs --record-only             # refresh runtime record only
node scripts/architecture-phase1a-experiments.cjs                            # nine controlled regressions
node scripts/phase1a-paper-evidence.cjs                                      # consolidate paper evidence
corepack pnpm run architecture:ratchet                                       # the legacy control, unchanged
corepack pnpm run typecheck ; corepack pnpm run security:scan ; corepack pnpm run state:probe
corepack pnpm run test:catalogue:check ; node scripts/acceptance-evolution-bless.cjs --check
corepack pnpm run build ; corepack pnpm test ; corepack pnpm run test:postbuild ; corepack pnpm run test:slow
```

## Runtime evidence, bound by SHA-256

All under `artifacts/city/phase1/` (runtime-owned; gitignored by repository policy, which this phase did not
violate in order to track them).

| Artifact | Bytes | SHA-256 |
|---|---|---|
| `sensor-qualification.json` | 14751 | `82ccbff2c4a4c8d1e505fdd57f2dc85f715d049c61bf1d13f9de2acc50fbb37e` |
| `sensor-qualification-report.md` | 5179 | `a154e6baef181d7fb2d9f3fcffe14b4b015825ef6764d55a7e912d432df4bcc5` |
| `baseline-generation.json` | 894 | `83103c14a122f8135c12c5ecc921a53c50e57a1d8de062bc6f0d033db38e4973` |
| `architecture-enforcement-shadow.json` | 432893 | `29aeea2c1a18146be4f93049b46718587c875bd6f4cf930e81dd5aa2a0b67512` |
| `architecture-enforcement-live.json` | 432894 | `442735a8ad9a25210760900ada82aef78d6c13256b9609c68e2aff4af2447ce5` |
| `controlled-regressions.json` | 7739 | `2d6f52a5ca0794b2a89a47e78705e276756e5b622f43cb4277bb48d181351730` |
| `legacy-vs-observer-vs-enforcer.json` | 1358 | `3d60889b7ec246292c7e6efc3a9932b1f9a9174ae0d8db5f688bf61d8b571527` |
| `paper-evidence.ndjson` | 60227 | `4dff438831b3df5df00a6387227379d91801b5e455cd5c8fd6edb54b1f9a2cad` |
| `paper-evidence.json` | 70624 | `905b1a8a87ca91b276ffd74daaec5c631a21750e91f84a33b0e218017d178fd6` |
| `paper-evidence-index.md` | 8171 | `6ba3489da38bb4a3647a741aad207d87368599bceb1215a54fe1cc7b306d137a` |

The tracked enforcement baseline is `config/architecture-enforcement-baseline.json`, **version 1**, byte-identity
verified against the tree by `--check` (`identical: true`, `hash_matches: true`):

```
baseline_hash = b211c0520f8ab72872ab0f756e92cef0cd7faad532213f52b9ebb1a9e6969f4e
```

`PHASE1A_MEASUREMENT_TO_ENFORCEMENT_REPORT.md` is the run's final report and is produced in the same runtime
directory; it is not bound here because it describes the acceptance rather than forming it.

## Sensor qualification — Q-01..Q-08

| Gate | Verdict | Substance |
|---|---|---|
| Q-01 production corpus integrity | **PASS** | 612 scanned files, **612 instrumented read calls**, 0 read failures, 0 parse issues, **0 silent skips** |
| Q-02 adversarial syntax corpus | **PASS** | **14 of 14** hand-labelled cases |
| Q-03 seeded mutation battery | **PASS** | **520 of 520** seeded cases, each asserting the exact graph delta |
| Q-04 independent disagreement detector | **PASS** | `BOTH` 1565 · `OBSERVER_ONLY` 106 · **`CROSSCHECK_ONLY` 0** |
| Q-05 determinism | **PASS** | 5 consecutive real-tree runs, **1** unique semantic hash |
| Q-06 path/platform resolution | **PASS** | 19 cases, after two harness expectations were corrected (both were test defects) |
| Q-07 scope honesty | **PASS** | 8 assertions; the sensor's own `scripts/**` implementation is outside its own scan set |
| Q-08 resource measurement | **MEASURED** | wall time, output bytes, cheap memory metrics; **no invented threshold** |

```
UNEXPLAINED_SENSOR_DISAGREEMENTS = 0
SEEDED_MUTATION_CASES            = 520
```

## Grandfathered-debt baseline

| Metric | Value |
|---|---|
| Path | `config/architecture-enforcement-baseline.json` |
| Schema / version / hash | `city-architecture-enforcement-baseline/1` / `1` / `b211c052…9f4e` |
| Tracked source files (identity) | **612** |
| Declared-owned / UNDECLARED | **25** / **587** |
| Internal edges (identity) | **1671** |
| Retired edges | 0 |
| Unresolved by class | `NON_SOURCE_ASSET` 1 · `SOURCE_TARGET_MISSING` 0 · `UNSUPPORTED_SOURCE_RESOLUTION` 0 · `OTHER_UNKNOWN` 0 |
| Reproducible | `--check` exits 0; `identical: true`, `hash_matches: true` |

```
MEANS          THESE RELATIONS EXISTED BEFORE ENFORCEMENT
DOES NOT MEAN  THESE RELATIONS ARE HEALTHY
```

## Enforcement, shadow trial and controlled regressions

| Item | Result |
|---|---|
| `architecture:ratchet` (legacy control) | exit 0, `pass = true`, **0 violations** — untouched, not replaced |
| `architecture:observe` (truth) | 612 files, **1671** internal edges, 587 undeclared |
| `architecture:enforce:shadow` | **PASS**, exit 0, no engine error |
| `architecture:enforce` | **PASS**, exit 0 — every inherited relation grandfathered |
| Findings on the baseline | 1677 = `PASS_AS_GRANDFATHERED` 1671 + `NOT_YET_ENFORCED` 5 + `NON_SOURCE_ASSET` 1; **violations 0** |
| `NEW_REGRESSIONS` | **0** |
| ENF-01..ENF-18 | **21 tests, all green**, driving the shipped command |
| Controlled regressions | **9 of 9** injections produced their expected machine code; shadow exit 0 and enforce non-zero on each; **9 of 9** rollbacks restored |

## Acceptance criteria — P1A-01..P1A-30

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| P1A-01 | Phase 0 promoted by Root Owner | **PASS** | PR #11 `merged = true`, `APPROVED` by `zhiheng-zhang-Mera` |
| P1A-02 | post-merge CI green | **PASS** | run `35699482212` on the merge SHA, four jobs success |
| P1A-03 | `city-phase0-observatory-v1` frozen | **PASS** | tag object `24bc1b91…` → `66440c1d…`, resolved from the remote |
| P1A-04 | Phase 1A branches from that tag | **PASS** | branch point `66440c1d…` = the tag commit |
| P1A-05 | spec precedes implementation | **PASS** | `335bf5b` contains one file and no implementation code |
| P1A-06 | Q-01..Q-08 satisfied | **PASS** | table above |
| P1A-07 | unexplained sensor disagreement = 0 | **PASS** | `CROSSCHECK_ONLY 0` |
| P1A-08 | baseline mechanically generated | **PASS** | `architecture:enforce:baseline`; reproducible by `--check` |
| P1A-09 | identity-level debt, not count-only | **PASS** | 612 file identities + 1671 edge identities |
| P1A-10 | inherited debt visible/grandfathered | **PASS** | 1671 `PASS_AS_GRANDFATHERED`, each still labelled debt |
| P1A-11 | debt removal passes | **PASS** | ENF-02; `EXP-09` reports `DEBT_REDUCED` |
| P1A-12 | new undeclared source fails | **PASS** | ENF-03; `EXP-01` |
| P1A-13 | new undeclared-endpoint edge fails | **PASS** | ENF-04, ENF-05; `EXP-02`..`EXP-04` |
| P1A-14 | declared same-capability semantics proven | **PASS** | ENF-06 |
| P1A-15 | cross-capability semantics proven | **PASS** | ENF-07 and ENF-08 (both directions) |
| P1A-16 | ownership conflict fails | **PASS** | ENF-09; `EXP-06` |
| P1A-17 | sensor failure fails closed | **PASS** | ENF-10 (read failure, parse issue, silent skip); `EXP-08` |
| P1A-18 | shadow/enforce findings identical | **PASS** | ENF-12, asserted by deep equality of the findings arrays |
| P1A-19 | controlled regression battery passes | **PASS** | 9 of 9 |
| P1A-20 | baseline tree passes enforce mode | **PASS** | exit 0, 0 violations |
| P1A-21 | legacy ratchet unchanged | **PASS** | `git diff city-phase0-observatory-v1 -- scripts/architecture.cjs` empty |
| P1A-22 | production architecture repair = NONE | **PASS** | no capability moved, split or rewired; every injection is a temporary directory |
| P1A-23 | CI workflow unchanged | **PASS** | `.github/workflows/ci.yml` byte-identical to the base |
| P1A-24 | Root Trust MATCHES | **PASS** | epoch 24, 63 files, aggregate `6eaf71e9…d457` on this branch |
| P1A-25 | evidence captured continuously | **PASS** | 23 records in `paper-evidence.ndjson`, appended at each checkpoint |
| P1A-28a | hosted CI on the final tip | **PASS after one transient failure** — run `35707095128` (`pull_request`) failed its `unit` job on runner throughput while the same SHA's push run `35707090892` passed all four jobs; the failed job was re-run once and attempt 2 is all-green. All eight check-runs on the tip are `success`. No gate was weakened, no check disabled, no baseline raised. Recorded in full in the ledger's C11 addendum. |
| P1A-26 | failures/corrections/negative results preserved | **PASS** | one `FAILURE` record with five defects, one `CORRECTION`, one `NEGATIVE_CONTROL` record with four retained negatives |
| P1A-27 | Phase 0 history not rewritten | **PASS** | `P0-15`/`P0-16` untouched; append-only additions |
| P1A-28 | branch CI green | **PASS** | Desktop CI run **`35703938755`**, event `push`, `head_sha` = `4bf6a45483105504f006e3e3dfb4ebd074b3cf7b`, `completed`/`success`; `quality`, `unit`, `package`, `acceptance` all `completed`/`success` |
| P1A-29 | Phase 1B not started | **PASS** | `HOSTED_REQUIRED_GATE = LEGACY` |
| P1A-30 | architecture migration not started | **PASS** | tenx split, cycle repair, private-state repair, manifest cleanup all NOT DONE |

No criterion was weakened.

## Limbs of the claim that are deliberately NOT made

```
ENFORCEMENT_ENGINE      = QUALIFIED_CANDIDATE
HOSTED_REQUIRED_GATE    = LEGACY
```

Unit tests exercise the engine **on this branch**; that is not hosted-gate activation, and it must not be
reported as such. Passing enforce mode on the baseline is a property of grandfathering, **not** evidence that the
policy works — only the nine injections are that evidence. `NOT_YET_ENFORCED` covers dependency cycles,
cross-domain private-state access, bundle structure, layer violations and runtime-only dependencies, and none of
those is claimed to be clean.

## Limitations and UNKNOWN values

1. **One repository, one host, one commit.** `n = 1` throughout.
2. **The disagreement detector shares the resolver with the observer**, so it can falsify extraction but not
   resolution.
3. **Fixtures are synthetic.** The real-tree half is the baseline enforce run; neither substitutes for the other.
4. **The baseline faithfully records the repository's own declarations**, including any that are wrong. It says
   what existed, not what is healthy.
5. **`SOURCE_TARGET_MISSING` and `UNSUPPORTED_SOURCE_RESOLUTION` are 0 on the real tree**, so their fail-closed
   paths are exercised by fixtures only — a retained negative result, not a silence.
6. **The metric `declared_owned_files` uses the manifest `modules` notion** and is deliberately narrower than the
   historical 594 figure.
7. **`package.json` gains four scripts** and is a CODEOWNERS-protected path. This branch is **not merged**.
8. **Rollback in the controlled regressions is fixture-level**, re-hashing the unmutated measurement; no
   production tree was mutated to test rollback, because this phase forbids it.
9. **Four instances of one failure mode are recorded rather than smoothed over**: in the qualification harness,
   the baseline generator (five sub-defects), the experiments' rollback arm and the enforcement suite's own
   assertion source, the apparatus was wrong and the measured object was right.

## What Phase 1A deliberately did NOT do

```
.github/workflows/ci.yml / Root Trust Surface / required checks / CODEOWNERS / branch protection   NOT MODIFIED
tenx split · cycle repair · persistence -> runtime-intelligence repair · private-state repair ·
mass manifest cleanup · ownership migration                                                       NOT STARTED
Phase 1B hosted-gate activation · Phase 2 architecture migration                                  NOT STARTED
legacy ratchet replaced or widened                                                                NO
Phase 0 history rewritten                                                                         NO
```

## Terminal state

```
PHASE0 = PROMOTED_AND_FROZEN
SENSOR = ENFORCEMENT_QUALIFIED
GRANDFATHERED_DEBT_BASELINE = FROZEN
PROSPECTIVE_ENFORCEMENT = QUALIFIED
HOSTED_REQUIRED_GATE = LEGACY
PAPER_EVIDENCE = CONTINUOUSLY_PRESERVED
PHASE1B = NOT_STARTED
ARCHITECTURE_MIGRATION = NOT_STARTED
```
