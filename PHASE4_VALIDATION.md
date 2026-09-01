# Phase 2–4 Validation Record

Date: 2026-09-01 (Australia/Sydney)

This record separates code/build evidence from third-party service observations. A loaded page, a visible input, or a passing selector test is not reported as a successful model response.

## Local acceptance

| Check | Result | Evidence |
|---|---|---|
| TypeScript contracts (renderer + Electron) | PASS | `pnpm run typecheck` |
| Unit/integration tests | PASS | 6 files, 16 tests |
| Production renderer + Electron build | PASS | `pnpm run build` |
| Production launcher smoke test | PASS | `.codex-boss/launcher.log`, 2026-09-01T22:14:01+10:00 |
| Windows split-screen render | PASS | Visible left workbench and right 3-page layout |
| Current-account Codex CLI detection | PASS | App header displayed `Codex: CHATGPT`; detection reads `codex login status` and copies no credentials |

## Phase 2 visible-adapter validation

Selected guest candidates: Gemini, Qwen, Kimi.

| Provider | Page opened | Guest input observed | Prompt prepared | Prompt sent | Response captured |
|---|---:|---:|---:|---:|---:|
| Gemini | PASS | PASS (`为 Gemini 输入提示`, login remained optional in observed page) | NOT_RUN | NOT_RUN | NOT_RUN |
| Qwen | PASS | PASS (`询问 Qwen`, login/register controls also visible) | NOT_RUN | NOT_RUN | NOT_RUN |
| Kimi | PASS | PASS (`尽管问，或做个 Agent 任务...`) | NOT_RUN | NOT_RUN | NOT_RUN |

The three pages were visibly rendered in the expected two-top/one-bottom Windows-style split. No prompt text was entered or transmitted. The live run stopped when Windows displayed an Electron public/private network firewall permission dialog; the validator did not act on the security prompt.

## Phase 3 Council validation

| Capability | Result | Boundary |
|---|---|---|
| Independent proposal fan-out | PASS (code/test) | Real guest send NOT_RUN |
| Anonymous proposal labels | PASS | Unit test verifies provider names are excluded |
| Evidence-over-vote instruction | PASS | Peer-review and synthesis prompts assert this rule |
| Conflict/minority parsing | PASS | Valid structured output retained; malformed output ignored |
| All-provider artifact gate | PASS (code inspection/build) | Real three-provider completion NOT_RUN |
| End-to-end guest Council | NOT_RUN | Requires sending representational prompts to third-party services and clearing the local firewall prompt |

## Phase 4 evidence foundation

| Capability | Result |
|---|---|
| Artifact SHA-256 manifest and integrity root | PASS |
| Claim/dispute/missing-provider indexes | PASS |
| Malformed synthesis fails closed | PASS |
| Selective rehydration excludes unrelated artifacts | PASS |
| Evidence bundle and controller persistence | PASS |
| Codex current-account dossier review | PASS with a synthetic, non-user-data dossier; returned `HOLD_FOR_REVIEW` and enumerated missing evidence |
| Automatic evidence acceptance | NOT IMPLEMENTED by design; decision remains `HOLD_FOR_REVIEW` |

## Next live checkpoint

After the user resolves the Windows firewall dialog, the next controlled checkpoint is to create one harmless Council task, visibly prefill the same prompt into Gemini/Qwen/Kimi, obtain action-time confirmation before submitting it, capture all three raw answers, advance through peer review and synthesis, then generate and review the Phase 4 evidence bundle.
