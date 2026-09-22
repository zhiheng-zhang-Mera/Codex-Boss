# PHASE 0 — ARCHITECTURE OBSERVATORY ACCEPTANCE RECORD

This is the durable, tracked acceptance record for Capability City **Phase 0**. It binds the runtime evidence
by SHA-256 and summarises it. The full generated dataset is deliberately **not** copied here.

| Field | Value |
|---|---|
| Specification | `docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md` |
| Spec commit | `76b2f495f57928f34823f6ce17176890963e846e` |
| Source commit (measured tree) | `6bf354dda3324efeb1bf01421abaad6b6ca2d97` |
| Branch | `dev/city-phase0-architecture-observatory` |
| Branch point | `53aa74a7f9628765a92210d16aabcc77ae98bae4` — equal to `city-start-baseline-v1` |
| City-start baseline | `53aa74a7f9628765a92210d16aabcc77ae98bae4` |
| Pre-city baseline | `7024203eee3444a0115664de5e3a3d6599d9a800` (untouched) |
| Host evidence class | `LOCAL_REAL_HOST` (the Mech host, measured on it) |
| Owner directive | `mission-2.md`, SHA-256 `00926f49e9702d185246699b508aa110b11fd3ccb457beefcf2da1526bc867e9` |
| Paper-evidence ledger | `docs/research/PAPER_EVIDENCE_LEDGER.md` |

## Commands executed (on the real host, at the source commit)

```powershell
corepack pnpm run architecture:observe                    # the experimental sensor; writes the artifacts below
node scripts/architecture-observatory.cjs --self-test     # OBS-01..OBS-06 on isolated fixtures
node scripts/architecture-observatory.cjs --known-positive
corepack pnpm run architecture:ratchet                    # the control sensor, unchanged
corepack pnpm run typecheck
corepack pnpm run security:scan
corepack pnpm run state:probe
corepack pnpm run test:catalogue:check
node scripts/acceptance-evolution-bless.cjs --check
corepack pnpm run build
corepack pnpm test                                        # unit tier
corepack pnpm run test:postbuild
corepack pnpm run test:slow
```

## Runtime evidence, bound by SHA-256

All under `artifacts/city/phase0/` (runtime-owned; gitignored by repository policy, which this phase did not
violate in order to track them).

| Artifact | Bytes | SHA-256 |
|---|---|---|
| `architecture-observatory.json` | 678655 | `d76cd5336b05f77addb48bc1365eeb4a9cbcb7a68d8f2d390a0fb844cc39e94f` |
| `legacy-comparison.json` | 79602 | `fd39404f001cb647fb504f173a1b031e9d34ae34f81e077e3ce23a0f1605e30d` |
| `observatory-self-test.json` | 4519 | `e5410406a34a77403e9a0da43db252f131098468b0cbee05bed2f5e31b283552` |
| `ARCHITECTURE_OBSERVATORY_REPORT.md` | 3022 | `e90bcab56aa5003503b36ffa813d38a4073fe7138758d40441e1281082b1ac87` |
| `paper-evidence.json` | 38254 | `2b0ba77b184a481d13f36abf105d7c2d32c233c63fdb179a4cd99110bca5157d` |
| `paper-evidence-index.md` | 9033 | `05352fcec4911e390b8626f4931251af5394e23f9aa5be40993a706ae5778ce3` |

The observatory's own **semantic hash** of the measured architecture (canonical JSON over the semantic payload,
volatile metadata excluded) is:

```
0c36a2643d5ef6c343b4533f8c3950ef0e19b0af32ddd83fe3903b5a090115b0
```

identical on two consecutive runs at this commit (determinism, OBS-06 on the real tree).

**How `paper-evidence.json` and `paper-evidence-index.md` were produced.** They are authored from the
measured artifacts and from `docs/research/PAPER_EVIDENCE_LEDGER.md`; they are not machine-derived from the
ledger. That is stated as a limitation rather than implied away.

## Hosted CI

| Field | Value |
|---|---|
| Workflow | Desktop CI (`.github/workflows/ci.yml`), event `push` |
| Run | **`35689642769`** |
| `head_sha` | `6bf354dda3324efeb1bf01421abaad6b6ca2d97` — the source commit measured above |
| Result | `quality`, `unit`, `package`, `acceptance` — **all `completed` / `success`** |
| Earlier run on this branch | `35688213411` on the spec commit `76b2f49` — all four success |

The `unit` job is the one that builds the repository and runs the three test tiers, so a green `unit` on this
SHA is hosted evidence that the Phase 0 suite, the catalogue and the observatory command all behave the same
way on a clean checkout as they do on the Mech host.

This acceptance record is committed in a **later** commit than the source commit it measures. That is
deliberate: the record describes the tree it measured, and the tree it sits in has gained only documentation
since. The hosted run above certifies the measured tree, not the documentation commit that records it.

## Scan set

| Field | Value |
|---|---|
| Scan roots | `electron/**`, `src/**` |
| Selection | `git ls-files` (Git-tracked only; not filesystem discovery, not manifests) |
| Extensions | `.ts` `.tsx` `.js` `.jsx` `.cjs` `.mjs`; `*.d.ts` excluded |
| Never scanned | `tests/**` `artifacts/**` `runtime-data/**` `dist/**` `dist-electron/**` `coverage/**` `node_modules/**` `.git/**` — as rules, independent of local directory existence |
| Tracked files in the repository | 1296 |
| **Tracked source files scanned** | **612** |
| Files with at least one reference | 489 |
| Parse issues | **0** |
| Run duration | 2117 ms |

## Ownership

| Field | Value |
|---|---|
| Manifests read | 27 |
| Declared modules (`config/capabilities/**` → `modules`) | 25 |
| **Declared-owned files present in the scan set** | **25** |
| **UNDECLARED files** | **587** |
| Declared modules absent from the tracked source set | 0 |
| Module ownership conflicts | 0 |

Definition (normative, and deliberately narrower than the historical 594 figure): *a tracked source file is
declared-owned if and only if some manifest names it in `modules`; everything else is `UNDECLARED`.*

## Graph

| Field | Value |
|---|---|
| **Observer internal edges** | **1671** |
| Capability-level edges | 0 (see N-05: `DECLARED_TO_DECLARED = 0`) |
| **Unresolved internal references** | **1** |
| Edge endpoints declared / undeclared | 171 / 3171 |
| Distinct external packages / occurrences | 17 / 493 |

| Edge class | Count |
|---|---|
| `DECLARED_TO_DECLARED` | 0 |
| `DECLARED_TO_UNDECLARED` | 146 |
| `UNDECLARED_TO_DECLARED` | 25 |
| `UNDECLARED_TO_UNDECLARED` | 1500 |

| Form | Edges carrying it |
|---|---|
| `static-import` | 1601 |
| `dynamic-import` | 75 |
| `export-from` | 16 |
| `require` | 3 |
| `side-effect-import` | 0 |

The single unresolved reference is `src/renderer/main.tsx` → `./styles.css`
(`non-source-extension`): reported with its reason, not dropped.

## Known-positive control

| Field | Value |
|---|---|
| Source | `electron/bootstrap/persistence.ts` (declared owner: `persistence`) |
| Specifier actually used | `../runtime-intelligence/live-capture` (resolved from source; no hard-coded path) |
| **Target observed** | `electron/runtime-intelligence/live-capture.ts` |
| Target declared owner | `UNDECLARED` |
| Legacy visibility rule would keep this edge | **NO** |
| **Observable** | **YES** |

The dependency is real, is retained by the Observatory, and is exactly the class of edge the legacy rule
discards. The pre-city evidence described it as `tenx`-owned; that description is **historical comparison data**
and is not used to decide the outcome. The dependency was **not** modified.

## Control comparison (legacy vs observatory, same tree)

| Metric | Value |
|---|---|
| Legacy scanned files (re-derived rule) | 25 |
| Observer scanned files | 612 |
| Legacy internal edges (re-derived rule) | 145 |
| Observer internal edges | 1671 |
| Legacy visible edges (re-derived rule) | 0 |
| **Observer-only edges** | **1671** |
| Legacy ratchet exit code / pass | 0 / `true` |
| Legacy ratchet violations | 0 |
| Legacy declared capability edges | 3 |

The control sensor reports a clean ratchet while retaining **none** of the 1671 real internal import edges. The
legacy instrument is executed as a subprocess and its visibility rule is re-derived; both are labelled
(`LEGACY_CLI`, `LEGACY_RULE_REDERIVATION`) and neither is presented as the other.

Inherited historical counts (`25`, `594`, `187`, `43`) appear in the artifacts **only** as comparison data with
provenance and are never used as acceptance truth.

## Falsification self-tests

| Test | Subject | Result |
|---|---|---|
| OBS-01 | manifest independence — an undeclared tracked file is still scanned | **PASS** |
| OBS-02 | undeclared target preservation — the edge survives with owner `UNDECLARED` | **PASS** |
| OBS-03 | false-import negative control — comment/string/template text yields no edge | **PASS** |
| OBS-04 | supported import forms — five edges, one per `(from,to)`, duplicate collapsed | **PASS** |
| OBS-05 | mutation sensitivity — one added dependency yields exactly one edge; removal restores baseline | **PASS** |
| OBS-06 | determinism — canonical-hash identical across runs and input orders | **PASS** |

They are also asserted by `tests/unit/city/architecture-observatory.test.ts`, which drives the shipped command
rather than a copy of it, and by the repository's unit tier.

## Acceptance criteria — A01..A25

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| A01 | Phase 0 branch point == `53aa74a…` | **PASS** | `git merge-base --is-ancestor` at branch creation; recorded above |
| A02 | tracked spec exists and was committed before implementation | **PASS** | spec commit `76b2f49`, parent of `cfdde45` and `6bf354d`; the spec commit contains no implementation code |
| A03 | `architecture:observe` scans Git-tracked real source independently of manifest modules | **PASS** | 612 scanned vs 25 declared; selection is `git ls-files` |
| A04 | all resolved internal edges preserved even when ownership is `UNDECLARED` | **PASS** | 146 `D→U` + 1500 `U→U` edges retained |
| A05 | known historical persistence/live-capture blind spot is observable | **PASS** | target observed; legacy rule would drop it |
| A06 | OBS-01 PASS | **PASS** | self-test artifact |
| A07 | OBS-02 PASS | **PASS** | self-test artifact |
| A08 | OBS-03 PASS | **PASS** | self-test artifact |
| A09 | OBS-04 PASS | **PASS** | self-test artifact |
| A10 | OBS-05 PASS | **PASS** | self-test artifact |
| A11 | OBS-06 PASS | **PASS** | self-test artifact; two-run hash equality on the real tree |
| A12 | legacy ratchet remains operational and semantically unchanged | **PASS** | `architecture:ratchet` exit 0, `violations: []`; metrics unchanged |
| A13 | `scripts/architecture.cjs` unchanged from city-start baseline | **PASS** | `git diff city-start-baseline-v1 -- scripts/architecture.cjs` empty |
| A14 | `config/architecture-baseline.json` unchanged | **PASS** | diff empty |
| A15 | `config/capabilities/**` unchanged | **PASS** | diff empty |
| A16 | real-host Mech evidence exists | **PASS** | six artifacts produced on this host at `6bf354d` |
| A17 | runtime evidence hashes bound into this record | **PASS** | table above |
| A18 | Root Trust remains `MATCHES` and its surface is not modified | **PASS** | epoch 24, 63 files, aggregate `6eaf71e9…d457` on this branch |
| A19 | required repository regression suites pass | **PASS — local and hosted** | Local: unit 261 files / 3300 tests / 0 failures; postbuild 8 / 119 / 0; slow 4 / 35 / 0; typecheck, security scan (1296 files), ratchet, state probe, catalogue check all green. Hosted: Desktop CI run **`35689642769`** on the source commit `6bf354d` — `quality`, `unit`, `package`, `acceptance` all `completed`/`success`. |
| A20 | Phase 1 has not started | **PASS** | no Phase 1 work; `ENFORCEMENT_CONVERGENCE = NOT_STARTED` |
| A21 | `PAPER_EVIDENCE_LEDGER` exists with historical + current evidence | **PASS** | `docs/research/PAPER_EVIDENCE_LEDGER.md`, sections A and C |
| A22 | failed attempts, corrections and negative results preserved | **PASS** | ledger sections B/D/E; 2 corrections, 5 failed attempts, 7 negative results |
| A23 | `paper-evidence.json` and `paper-evidence-index.md` exist and are hash-bound | **PASS** | hashes above |
| A24 | historical measurements distinguished from current ones | **PASS** | historical figures labelled and carried only as comparison data with provenance |
| A25 | legacy-vs-Observatory control comparison explicitly recorded | **PASS** | control table above; `legacy-comparison.json` |

No criterion was weakened.

## Limitations and UNKNOWN values

1. **One repository, one host, one commit.** `n = 1` throughout; no claim generalises beyond it.
2. **Parser deviation.** The specification prefers AST/compiler parsing. `typescript@7.0.2` is the native port
   whose package root exports only `version`; `unstable/ast` has no parser and its scanner yields no usable
   tokens; `unstable/sync` needs a native server; no third-party parser is in the lockfile. The extractor is a
   character-level lexer plus a token-level recogniser. Recorded as failed attempts F-01/F-02.
3. **Cross-check scope.** The regex cross-check shares the resolver with the observer, so it can falsify the
   extraction step but not the resolution step. 106 lexer-only edges are a limitation of the regex method
   (multi-line import/export); 0 are regex-only.
4. **Historical figures are not comparable.** `187` counted cross-capability edges under a broader ownership
   notion; `43` / `25-of-27` are cycle measures Phase 0 does not compute; `7` is a state-access measure a
   source-import observatory cannot see. Only the `25`-file declared set reproduces exactly.
5. **Edge existence is a source-level fact.** No runtime dependency, load order or execution is claimed.
6. **The semantic hash includes the tracked-file total**, so it also moves when the repository gains or loses
   any tracked file.
7. **`package.json` gains one script** and is a CODEOWNERS-protected path. This branch is **not merged**; no
   promotion ceremony was performed and none is claimed.
8. **Fixture tests are synthetic by construction**; the non-synthetic half is the real-tree structural
   assertions in the regression suite.
9. **One unit-tier test timed out once** under concurrent host load
   (`tests/unit/runtime-intelligence/replay-corpus-io.test.ts`); it passed in isolation in 585 ms and the idle
   full-tier re-run passed 3300/3300. Recorded rather than dropped.

## What Phase 0 deliberately did NOT do

```
legacy ratchet widened or replaced                     NO
capability manifests repaired for appearance           NO
capabilities moved                                      NO
tenx split                                              NO
persistence -> runtime-intelligence coupling repaired   NO  (it is a measurement target)
private-state access repaired                           NO
cycles repaired                                         NO
new zoning enforcement introduced                       NO
Root Trust changed                                      NO
promotion rules or required CI contexts changed          NO
Construction B implemented                              NO
Phase 1 started                                         NO
history rewritten                                       NO
```

## Terminal state

```
PHASE0_DEFINITION = REAL_SOURCE_ARCHITECTURE_OBSERVATORY
PHASE0_MEASUREMENT = TRUSTWORTHY
LEGACY_GATE = PRESERVED_AS_CONTROL
PAPER_EVIDENCE = PRESERVED_AND_INDEXED
ENFORCEMENT_CONVERGENCE = NOT_STARTED
RUNTIME_STATE_EVENT_OBSERVATORY = NOT_STARTED
PHASE1_STARTED = NO
```
