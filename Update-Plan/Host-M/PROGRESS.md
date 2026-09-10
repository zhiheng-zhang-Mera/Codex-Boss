# Host-M 9-10-M 鈥?progress

Plan: `Update-Plan/Host-M-9-10.md` (P1 System Acceptance Hub, P2 Failure Injection
Lab, P3 Long-run/Soak Harness, P4 Unified Observability, P5 Evidence/Artifact
Inspector, P6 Regression Sentinel, P7 Boss Doctor).
Branch: `9-10-M` (stable baseline; `main` / `owner-result` are never updated).
Baseline HEAD before this round: `7879aff`.

Discipline: every phase is an independent, removable outer module with its own
tests and evidence, committed separately. `BLOCKED_EXTERNAL` is never rendered as
`PASS`, an unrun tier is never reported as a pass, and no tested module was
modified to make a check go green.

| Phase | Deliverable | Evidence | Status |
|---|---|---|---|
| P1 | System Acceptance Hub 鈥?28-check catalog, isolated runner, single command, P6 record | `evidence/P1/` | PASS |
| P2 | Failure Injection Lab 鈥?13 fault classes graded inject/observe/contain | `evidence/P2/` | PASS |
| P3 | Long-run / Soak Harness 鈥?30m tier actually run | `evidence/P3/` | PASS |
| P4 | Unified Observability 鈥?read-only aggregate over eight domains | `evidence/P4/` | PASS |
| P5 | Evidence / Artifact Inspector 鈥?checksum, provenance, orphan detection | `evidence/P5/` | PASS |
| P6 | Regression Sentinel 鈥?nine dimensions, report only | `evidence/P6/` | PASS |
| P7 | Boss Doctor 鈥?25 fault-isolated probes | `evidence/P7/` | PASS |

## Gates

```
npx tsc --noEmit -p tsconfig.json            PASS
npx tsc --noEmit -p tsconfig.electron.json   PASS
npx vitest run                               72 files / 614 tests PASS   (baseline 65 / 428)
node scripts/host-acceptance.cjs --all ...   18 PASS 路 1 FAIL 路 6 BLOCKED_EXTERNAL 路 3 SKIPPED_WITH_REASON
node scripts/host-fault-lab.cjs              PASS: 9 CONTAINED, 4 ACCEPTED_DEGRADATION of 13
node scripts/host-soak.cjs --tier 30m        PASS: 11/11 invariants; 1800s of 1800s
node scripts/host-evidence.cjs               Host-M scope: 0 issue
node scripts/host-regression.cjs             PASS: 0 regression, 0 drift
node scripts/host-doctor.cjs                 READY: 15 READY, 0 DEGRADED, 0 FAIL, 10 SKIPPED
```

## The 30-minute soak (the headline result)

```
tier 30m 路 PASS 路 11 PASS / 0 FAIL / 0 UNAVAILABLE of 11
ran 1800s of 1800s 路 15195 completed 路 0 failed 路 2170 injected retries
throughput 8.441 tasks/s 路 121 samples at 15s

duration-reached               1800s (bound >= 1800s)
no-unexpected-restart          1 process id (bound 1)
rss-bounded                    +23.3 MiB (59.6 -> 82.9)   bound <= 512 MiB
heap-bounded                   +6.3 MiB (5.1 -> 11.4)     bound <= 256 MiB
handles-bounded                +2 (0 -> 2)                bound <= 2000
queue-drained                  peak 0; the tail window reached 0
failure-ratio-bounded          0.0% (0/15195)             bound <= 50%
throughput-above-floor         8.441 tasks/s              bound >= 0.2 tasks/s
no-stale-sessions              peak 0
no-orphan-processes            0 alive after reaping
provider-crash-loop-bounded    no circuit opened          bound <= 25 per runtime
```

Two dimensions are reported `UNAVAILABLE` with reasons rather than filled in:
renderer health (the harness runs headless under node, so there is no renderer to
observe) and checkpoint/degradation/continuation injection (covered by the closure
soak and the P2 fault lab). The 2h, 8h and overnight tiers are implemented and
selectable but were **not** executed this round, and are recorded as not-run.

## Defects found by the new evidence (and fixed)

1. **`spawn EINVAL` on every `npx`-driven check.** Windows cannot spawn a `.cmd`
   shim without a shell. Fixed by resolving `npx`/`npm` to their Node entry point
   and keeping `shell: false`; the process seam now has a regression test.
2. **`node` was given a `.cmd` suffix too**, because the first fix appended it to
   every name. Real executables must pass through untouched.
3. **Two "browser" checks were run under `node`.** `acceptance-browser-crash.cjs`
   and `acceptance-vision.cjs` `require("electron")`, so they must be launched by
   the electron binary 鈥?a FAIL that was really a wrong runner. After the fix
   `legacy:browser-crash` PASSES in 7.5s.
4. **Missing inputs surfaced as cryptic exit codes.** `acceptance-v1-audit.cjs`
   needs `artifacts/v1-acceptance-manifest.json`, absent on this branch; the hub
   now declares an `entryPoint` per check and reports the missing path as
   `BLOCKED_EXTERNAL` before spawning anything.
5. **`legacy:seeded-engineering` and the 2h soak were in the default scope**,
   which would have made the routine `one command` run for hours. Both opt-in;
   the seeded battery PASSED in 269s when run explicitly.
6. **The runner re-derived the default scope from the catalog** even when the
   caller had already resolved an explicit selection, silently dropping opt-in
   rows the caller had chosen. An explicit selection is now authoritative.
7. **The observer mutated what it observed.** Constructing a `StateStore` to read
   `state.json` starts a startup session (its constructor persists), so a naive
   P4 collector rewrote the file it was reading. The collector parses the task
   rows itself and the test asserts the file is byte-identical afterwards.
8. **A corrupt node registry read as a healthy empty one.** `NodeCapabilityRegistry`
   aborts its own restore on a malformed file, so `list()` returns `[]`. The
   collector validates store shapes first and reports `UNAVAILABLE`.
9. **The fleet dimension was reported twice.** Both read models now feed one entry.
10. **Four fault-lab injectors would have produced false verdicts**, and the lab's
    own three-phase grading exposed each: the role router only admits runtimes
    whose health is cached, a DOM stub returned `undefined` instead of throwing,
    the dropout scenario pinned work to a node with no alternative host, and both
    episode injectors seeded rows without the store's `schemaVersion`.
11. **The soak harness forked a child process per task** with no ceiling. The
    orphan invariant failed on the first smoke run and was right: a soak that
    forks per unit of work is itself the leak. It now runs a bounded pool.
12. **The orphan check conflated the live pool with a leak**, and polling
    `exitCode` after `kill()` reported a mid-exit process as an orphan. Cleanup
    now escalates to `taskkill /T /F` and awaits the real exit event.
13. **The sentinel conflated a whole-dimension absence with an optional sub-field
    absence**: omitting per-suite test counts produced a spurious missing-
    measurement finding on every run. Its capture also accepted a test
    measurement but never stored it.
14. **The evidence inspector reported 44 false "invalid JSON" findings** because
    44 evidence files carry a UTF-8 BOM that plain `JSON.parse` rejects 鈥?the
    closure report generator already strips it. It also needed three reference
    anchors: an anchor-blind resolver reported 116 dangling references of which
    63 were false, and its repository path enumeration silently stopped before
    reaching the directory the citations named.

## Pre-existing findings reported, not repaired

The inspector is read-only by design, so these are recorded rather than fixed:

- 44 evidence files carry a UTF-8 BOM (accepted by the inspector, still a
  portability hazard for any other JSON reader).
- 1 file is genuinely malformed JSON: `overcomplete/evidence/live/live-finding-qwen-2026-09-09-07-10-04.json`
  is two concatenated top-level objects.
- 57 dangling references across the plan, 43 of them to the seeded files the
  seeded acceptance creates inside a clone; 150 orphans in the full-plan scan.
- `legacy:vision` FAILS on this host: the script needs a real authenticated
  provider page and produces no output or artifact without one.

## Rows that did not run as PASS, with their real status

| Row | Status | Real reason |
|---|---|---|
| `legacy:recovery`, `legacy:resource`, `legacy:engineering`, `legacy:finalization`, `legacy:structured` | BLOCKED_EXTERNAL | no `codex` CLI on PATH |
| `legacy:v1-audit` | BLOCKED_EXTERNAL | `artifacts/v1-acceptance-manifest.json` does not exist on this branch |
| `legacy:vision` | FAIL | needs a real authenticated provider page; no output, no artifact |
| `closure:soak-2h` | SKIPPED_WITH_REASON | opt-in 2h run; not executed this round |
| `host:soak-30m` | SKIPPED_WITH_REASON in the hub run | executed separately as the P3 tier (PASS) |
| `legacy:seeded-engineering` | SKIPPED_WITH_REASON in the final run | executed separately (PASS, 268914ms) |

## Data layout

Host-M introduces no new system-level source of truth. Run artifacts live under
`artifacts/host-{acceptance,sentinel,evidence,soak}/` (gitignored); committed
evidence lives under `Update-Plan/Host-M/evidence/<Phase>/`; the P6 baseline is
`Update-Plan/Host-M/evidence/baseline/sentinel-baseline.json`; the feature-flag
registry is `src/shared/host-maturity-flags.ts`, separate from the Engine's
`adaptive-flags` contract so Host-M stays removable.

## Removability

Deleting `src/shared/{acceptance-hub,acceptance-record,fault-lab,soak-harness,host-observer,host-maturity-flags,evidence-inspector,regression-sentinel,doctor}.ts`,
`electron/host/**`, `scripts/host-*.cjs` and `tests/unit/host-*.test.ts` leaves Boss
running unchanged: no production path depends on any of them, and no frozen-area
protocol, schema or persistence format was touched.
