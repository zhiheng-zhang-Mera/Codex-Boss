# AP04 — Symbol Index + Auto Handoff (Dev-Plane seam)

Compact handoff closing the remaining AP04 seam (plan AP04 Dev Efficiency; audit: repo inspector,
semantic slice, targeted test selector existed; symbol index and auto handoff absent). Branch `9-5`.

## Why

AP04a/AP04b shipped the bounded repo index, test map, semantic code slice and targeted-test
selector. What remained missing from the Development Plane was the symbol vocabulary (definition
location for exported functions/classes/types) and the "Auto Handoff" writer that closes the §18
pack loop (a fresh session can resume from a compact checkpoint without re-reading the repo).

## What was added

- **`electron/engineering/symbol-index.ts`** (new)
  - `indexFile(file, content)` → `FileSymbols { exports, functions, classes, types }` with
    bounded regex symbol extraction (never parses/executes repo code);
  - `buildSymbolIndex(snapshot, readFile)` → deterministic per-file index over the repo
    snapshot (skips non-code and >1 MB files);
  - `locateSymbol(index, name)` — files defining a symbol; `symbolsForFile`;
  - `signatureFor(snapshot)` = repo fingerprint (cache-invalidation signal, §13.3/§13.4).
- **`src/shared/auto-handoff.ts`** (new, pure)
  - `AutoHandoffInput` + `buildAutoHandoff(input)` → compact markdown handoff
    (#pack — title / Why / What was added / Evidence / Verification / Boundary notes /
    Next actions), trims each section, and `validateAutoHandoffInput` fail-closed.
- **`electron/engineering/dev-handoff.ts`** (new)
  - `persistAutoHandoff(directory, input)` — writes `<pack>-<date>.md` plus a schemaVersion-1
    metadata JSON (atomic durable write).
- **`tests/dev-plane.test.ts`** (new, 4 tests) — symbol indexing + `locateSymbol` on synthetic +
  real temp repo; auto-handoff document content; validation failure; handoff persistence
  (markdown + metadata).

## Verification

- Targeted: `dev-plane` (4) + `repo-inspector` (5) + `semantic-slice` (5) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- The index is symbol-location only; module dependency edges already live in
  `semantic-slice`/`code-graph` (AP25a). Combining symbol + dependency + tests into one
  dev-plane "capsule compiler" is the natural next consumer seam; C0/C1/C2 capsules already
  compile in AP09/AP10 (`compileContextCapsule`), so no new capsule compiler is needed here.
- Auto handoff writes are bounded text; the DSH harness protocol still governs how handoffs are
  consumed (this repo does not embed the harness).

## Checkpoint

Commit with: `electron/engineering/symbol-index.ts`, `src/shared/auto-handoff.ts`,
`electron/engineering/dev-handoff.ts`, `tests/dev-plane.test.ts`, this handoff.
