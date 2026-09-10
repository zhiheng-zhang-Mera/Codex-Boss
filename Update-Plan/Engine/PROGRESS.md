# Adaptive Provider Intelligence — progress (Engine plan, branch 9-10-M)

Plan: `Update-Plan/Engine/00-ENGINEERING-BOOK.md` … `04-MIGRATION-ROLLBACK.md`.
Standard: `03-ACCEPTANCE-MATRIX.md` (A01–A50) — see `ACCEPTANCE-REPORT.md`.

| Phase | Deliverable | Evidence | Status |
|---|---|---|---|
| P0 | baseline regression oracle + 5 flags (all OFF, kill switch) | `evidence/P0/` | PASS |
| P1 | RuntimeOutcome/SemanticOutcome decoupling + behaviour axes + evaluator versioning | `evidence/P1/` | PASS |
| P2 | append-only episode store (episodes + revisions, full query surface) | `evidence/P2/` | PASS |
| P3 | model identity observation (evidence-ranked, Auto, snapshot dedup) | `evidence/P3/` | PASS |
| P4 | task fingerprint (open schema, embedding optional w/ structural fallback) | `evidence/P4/` | PASS |
| P5 | provider behaviour profiles (derived, rebuildable, decayed version prior) | `evidence/P5/` | PASS |
| P6 | adaptive scorer + fail-open RoleRouter seam + routing feedback ledger | `evidence/P6/` | PASS |
| P7 | concept discovery (registry/miner/merge/split, stable ids) | `evidence/P7/` | PASS |
| P8 | behaviour epoch (change-point detection + durable ledger) | `evidence/P8/` | PASS |
| P9 | bounded contextual exploration | `evidence/P9/` | PASS |
| P10 | policy evolution (replay → shadow → trial → promotion + rollback) | `evidence/P10/` | PASS |
| P11 | provider intelligence panel + learning service + owner controls | `evidence/P11/` | PASS |
| P12 | documentation + acceptance report + acceptance battery | `evidence/P12/` | PASS |

## Gates (final)

- `tsc --noEmit` renderer/shared + electron: PASS
- `vitest run`: 65 files / 428 tests PASS (167 legacy + 10.x + Engine)
- `vite build` + electron emit: PASS

## Defects found by the evidence tests (and fixed)

1. Concept support double-counted when re-mining history (registry `reinforce` now idempotent per episode).
2. Behaviour-epoch `open()` read its parent AFTER closing it, losing the prior link.
3. Exploration only nudged a score, so it could never actually select the explorer (now exploration selects, pin/AVOID still dominate).
4. `EpisodeStore.restore()` threw on an unreadable episode file (EISDIR), violating "episode DB unavailable ⇒ learning degrades, Boss continues".

## Data layout

`userData/.boss/learning/`: `adaptive-flags.json`, `episodes.jsonl`,
`revisions.jsonl`, `model-snapshots.json`, `behaviour-epochs.json`,
`provider-profiles.json`, `concepts.json`, `routing-feedback.json`,
`policy-gate.json`. Derived files may be deleted and rebuilt; episodes are the
source of truth.
