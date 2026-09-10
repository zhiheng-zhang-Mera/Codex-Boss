# Host-M 9-10-M — progress

Plan: `Update-Plan/Host-M-9-10.md` (P1 System Acceptance Hub, P2 Failure Injection
Lab, P3 Long-run/Soak Harness, P4 Unified Observability, P5 Evidence/Artifact
Inspector, P6 Regression Sentinel, P7 Boss Doctor).
Branch: `9-10-M` (stable baseline; `main` / `owner-result` are never updated).

Discipline: every phase is an independent, removable outer module with its own
tests and evidence, committed separately. `BLOCKED_EXTERNAL` is never rendered as
`PASS`, and no tested module is modified to make a check go green.

| Phase | Deliverable | Evidence | Status |
|---|---|---|---|
| P1 | System Acceptance Hub — catalog + isolated runner + single command + P6 record | `evidence/P1/` | PASS |
| P2 | Failure Injection Lab | `evidence/P2/` | — |
| P3 | Long-run / Soak Harness | `evidence/P3/` | — |
| P4 | Unified Observability (read-only aggregate) | `evidence/P4/` | PASS |
| P5 | Evidence / Artifact Inspector | `evidence/P5/` | — |
| P6 | Regression Sentinel | `evidence/P6/` | — |
| P7 | Boss Doctor | `evidence/P7/` | — |

## Gates

- `npx tsc --noEmit -p tsconfig.json`: PASS
- `npx tsc --noEmit -p tsconfig.electron.json`: PASS
- `npx vitest run`: **67 files / 481 tests PASS** (baseline 65 / 428 + Host-M)
- `node scripts/host-acceptance.cjs`: runs the whole acceptance surface in one command

## Defects found by the new evidence (and fixed)

1. **`spawn EINVAL` on every `npx`-driven check.** Windows cannot spawn a `.cmd`
   shim without a shell. Fixed by resolving `npx`/`npm` to their Node entry point
   and keeping `shell: false`; the process seam now has a regression test.
2. **`node` was given a `.cmd` suffix too**, because the first fix appended it to
   every name. Real executables must pass through untouched.
3. **Two "browser" checks were run under `node`.** `acceptance-browser-crash.cjs`
   and `acceptance-vision.cjs` `require("electron")`, so they must be launched by
   the electron binary — a FAIL that was really a wrong runner.
4. **Missing inputs surfaced as cryptic exit codes.** `acceptance-v1-audit.cjs`
   needs `artifacts/v1-acceptance-manifest.json`, which does not exist on this
   branch; the hub now declares an `entryPoint` per check and reports the missing
   path as `BLOCKED_EXTERNAL` before anything is spawned.
5. **`legacy:seeded-engineering` and the 2h soak were unbounded in the default
   scope.** Both are now opt-in, so `one command` stays bounded and honest.
6. **The observer mutated what it observed.** Building a `StateStore` to read
   `state.json` starts a startup session (its constructor persists), so a naive
   P4 collector rewrote the file it was reading. The collector now parses the
   task rows itself and the test asserts the file is byte-identical afterwards.
7. **A corrupt node registry read as a healthy empty one.** `NodeCapabilityRegistry`
   aborts its own restore on a malformed file, so `list()` returns `[]`. The
   collector validates the store shape first and reports the dimension
   `UNAVAILABLE` rather than conflating "corrupt" with "nothing registered".
8. **The fleet dimension was reported twice** (nodes and assignments each pushed
   their own entry). Both read models now feed one dimension entry.
