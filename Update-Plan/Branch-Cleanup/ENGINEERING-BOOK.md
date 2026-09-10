# Branch-Cleanup — Engineering Book

Branch final convergence, history archival, A/M integration, acceptance and old-branch
cleanup for Codex Boss.

**This project adds no product features.**

- Execution authority: `Update-Plan/cleanup.md`
- Execution branch: `A-main-integration`
- Baseline: `origin/9-10-M` @ `86e32d12a0e35ab928580509b615dbcbae2c4d01`
- Long-term target structure: `main` + `owner-result` only

## Naming note

cleanup.md calls this branch `9-10-integration`. The owner instructed the name
`A-main-integration`, and that is the branch actually used. The two names refer to the
same branch; `9-10-integration` should be read as its former name throughout
cleanup.md.

## Scope ruling for this round

The owner ruled that **no ref other than `A-main-integration` may be modified until the
final promotion phase**. Concretely, this round:

| Phase | Status this round |
|---|---|
| A — freeze and snapshot | **executed** |
| B — archive and delete historical branches | **executed** — 15 archive tags created, verified and pushed; 11 branches deleted |
| C — create the integration branch | **executed** |
| D — merge Host-A | **executed** |
| E — restore the test union | **executed** |
| F — static and unit acceptance | **executed** |
| G — Host-M acceptance harnesses | **executed** |
| H — evidence cleanup | **executed** |
| I — merged-tree soak | **executed** |
| J — live gates | **executed** (live blockers recorded honestly as BLOCKED_EXTERNAL) |
| K — final integration acceptance | **executed** |
| L — promote `owner-result` | **executed** — `825cd1f → 148c342` |
| M — promote `main` | **executed** — `825cd1f → 148c342`, tagged `v10.0.0` |
| N — delete A / M / integration temp branches | **executed** — 10 local + 14 remote branch deletions |

`main` and `owner-result` were **not touched** during phases A–K. In phases L–N they
were promoted, as those phases require. `9-10-M` and `9-10-A` were frozen throughout
and then archived and deleted in phase N. All 17 tags were pushed to `origin`.

See `PROMOTION-RECORD.md` for the executed SHAs and guard verdicts.

## Deliverables

| File | Content |
|---|---|
| `PROGRESS.md` | phase-by-phase status and evidence pointers |
| `branch-heads-before.json` | every branch HEAD before work began |
| `archive-manifest.json` | executed archive tags per branch, with SHA match and push status |
| `deletion-manifest.json` | section 21 guard verdict per branch |
| `integration-conflicts.md` | merge analysis, conflict rulings, A-side divergences |
| `integration-test-map.md` | test-set union restoration and count arithmetic |
| `EVIDENCE-CLEANUP.md` | phase H defects found, repaired, and deliberately not repaired |
| `FINAL-ACCEPTANCE.md` | final integration acceptance record + owner view |
| `evidence/` | merge, regression, acceptance, evidence-cleanup, soak evidence |

## Guard rules that constrained every action

1. **No unarchived deletion** (section 1.1) — a branch may only be deleted once a tag
   exists at its exact HEAD, is verified, and the tree is readable with no unique
   unintegrated code.
2. **No mechanical whole-history merge** (section 1.2) — integration is
   `9-10-M → A-main-integration ← 9-10-A` only. Historical branches do not participate.
3. **`main` is not a work branch** (section 1.3) — `main` only receives a version that
   has already passed final integration acceptance.
4. **No force push to hide conflicts** (section 28).
5. **Never delete tests to pass integration** (section 8, section 28) — enforced by
   restoring the two M suites A's curation removed.
6. **Never report BLOCKED_EXTERNAL as PASS** (section 13, section 28).
7. **Failure isolation** (section 22) — on any failure, do not force-update `main` or
   `owner-result`, do not delete remaining branches, stop at the last safe state.

## Reproducing the evidence

Scripts written for this project live in `scripts/` and are safe to re-run:

| Script | Purpose | Writes |
|---|---|---|
| `phase-a-snapshot.ps1` | record all branch HEADs | `branch-heads-before.json` |
| `verify-test-union.ps1` | prove the merge is an M superset and the test union holds | `evidence/merge/test-union-verification.json` |
| `build-archive-manifests.cjs` | plan tags and evaluate the deletion guard | `archive-manifest.json`, `deletion-manifest.json` |
| `scan-json-health.ps1` | find BOM and malformed JSON | `evidence/evidence-cleanup/json-health-scan*.json` |
| `repair-evidence-json.ps1` | strip BOM, extract the malformed file's JSON (`-DryRun` supported) | `evidence/evidence-cleanup/bom-repair-report.json` |
| `classify-dangling-refs.ps1` | classify dangling references per section 11.3 | `evidence/evidence-cleanup/dangling-reference-classification.json` |

None of these scripts creates, moves, retags or deletes a git ref.
