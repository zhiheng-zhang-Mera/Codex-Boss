# 9-6 Research / v1–v3 Validation

Branch `9-6-research` (created from `9-5`). This doc records what is verified by deterministic
suites versus what remains live/GUI acceptance — per the research plan's "DS-Harness 执行要求"
items 7–9 (real evidence, docs update, full test/typecheck/build) and Final Acceptance.

## Verified (deterministic, run in CI-style vitest + typecheck)

- Full suite: **107 files / 494 tests PASS** (last recorded full run after the round-18
  contradicted-citation audit slice; re-run before any further slice).
- typecheck (renderer + electron) PASS; renderer build + electron build PASS individually
  (`pnpm run build` aggregate fails only because nested `pnpm` cannot resolve through corepack
  here; each underlying step is green).

### BOSS v1–v3 packs (branch 9-5, carried into 9-6-research)

AP24 perception–action loop · AP27 self-modification sandbox (Guardian-gated promote) · AP06
capability-graph routing · AP09 C2 capsules/cache-key · AP10 domain router/rerank · AP16
contribution metrics · AP12 microtask runtime · AP13 event continuation · AP15 project-state
wiring + goal-tree · AP17 L0–L4 lifecycle · AP04 symbol index + auto handoff · AP30 hardening
matrix + probes · AP20 hybrid storage + governance · AP21 software adapter SDK · AP22 Blender +
AP23 Unreal structured adapters (graceful absence). Each has its own test file + handoff doc
(`docs/9-5-ap*.md`).

### Research phases (deterministic cores)

History ops (Phase 1) · 3-AI layout + zoom + order (2) · live progress (3) · guidance gate (4) ·
ResearchIR/ledger/supervisor (5) · structured research runtime (6) · protocol freeze/amendment
(7) · Level-B falsifiable-RQ + evidence>vote (8) · citation ladder (9) · statistics + evidence
graph (10) · manuscript pipeline (11). Handoffs: `docs/9-6-research-phase*.md`; progress:
`docs/9-6-research-progress.md`.

## NOT_RUN / live acceptance (requires GUI + real tools)

- Level-A / Level-B live E2E: real repo inspection via web-AI reviewers, real experiments,
  independent replication, manuscript `paper.pdf` — requires a machine with the installed
  Electron app, logged-in web sessions and (for PDF) a LaTeX toolchain. Never substituted by
  mocks/fixtures (research plan item 7).
- Blender / Unreal live sessions (AP22/23 rows in the AP30 matrix are live-only with reasons).
- Packaged-portable smoke + live acceptance scripts (`scripts/acceptance-*.cjs`,
  `smoke-portable.ps1`) run in release validation (CI + packaging), not in this repo's vitest.

## Product rule

No DS-Harness SDK/CLI/session/plugin/runtime dependency is imported anywhere in the product
code; the harness is only the tool that develops this repo.

## Re-run gate

```text
pnpm run typecheck
pnpm test
pnpm run build:renderer && pnpm run build:electron
```
