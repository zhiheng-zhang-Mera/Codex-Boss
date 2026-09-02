# Phase 2–4 Validation Record

Updated: 2026-09-03 (Australia/Sydney)

This record separates code/build evidence from third-party service observations. A loaded page, a visible input, or a passing selector test is not reported as a successful model response.

## Local acceptance

| Check | Result | Evidence |
|---|---|---|
| TypeScript contracts (renderer + Electron) | PASS | `pnpm run typecheck` |
| Unit/integration tests | PASS | 7 files, 21 tests |
| Production renderer + Electron build | PASS | `pnpm run build` |
| Production launcher smoke test | PASS | `.codex-boss/launcher.log`, 2026-09-03T09:01:07+10:00; smoke mode exits without waiting on external web loads |
| Windows split-screen render | PASS | 3-page vertical thirds and 5-page 2×3 layout both observed |
| Current-account Codex CLI detection | PASS | App header displayed `Codex: CHATGPT`; detection reads `codex login status` and copies no credentials |

## Phase 2 visible-adapter validation

Selected guest candidates: Gemini, Qwen, Kimi.

| Provider | Page opened | Guest input observed | Prompt prepared | Prompt sent | Response captured |
|---|---:|---:|---:|---:|---:|
| Gemini | PASS | PASS (`为 Gemini 输入提示`, login remained optional in observed page) | NOT_RUN | NOT_RUN | NOT_RUN |
| Qwen | PASS | PASS (`询问 Qwen`, login/register controls also visible) | NOT_RUN | NOT_RUN | NOT_RUN |
| Kimi | PASS | PASS (`尽管问，或做个 Agent 任务...`) | NOT_RUN | NOT_RUN | NOT_RUN |

The original 2026-09-01 guest check used the earlier two-top/one-bottom layout. No prompt text was entered or transmitted. The live run stopped when Windows displayed an Electron public/private network firewall permission dialog; the validator did not act on the security prompt.

## 2026-09-02 workflow and layout revision

| Check | Result | Evidence boundary |
|---|---|---|
| Startup opens default three providers | PASS | ChatGPT, Gemini and Claude opened without a second button |
| Three-provider layout | PASS | Right side showed equal top/middle/bottom panes |
| Selection/open state coupling | PASS | Selecting Qwen immediately opened a fourth pane |
| Five-provider layout | PASS | 2×3 workspace observed; Codex Boss occupied top-middle, five web AIs occupied remaining cells |
| Pane-close coupling | PASS | Closing Kimi from its pane changed the main selector and count from 5 to 4 |
| 3/5 group-size gate | PASS (code/test/UI) | Composer identified 4 as ineligible and 5 as eligible; no prompt was sent |
| All-provider checkpoint and rollback | PASS (code/test) | Real partial-send failure was not induced because external sends are irreversible |
| Sequential response collection | PASS (code/test) | Real guest responses remain NOT_RUN |
| Persistent account-session module | PASS | Each provider maps to its isolated `persist:` partition; startup probe visibly classified ChatGPT `AUTH_REQUIRED`, Gemini `READY`, and left uncertain Claude as `UNKNOWN`; no credentials inspected |

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

## 2026-09-03 Chat/Work and history revision

| Check | Result | Evidence boundary |
|---|---|---|
| Chat mode forces web transport | PASS | Store policy test and visible Chat mode |
| Work per-provider web/API choice | PASS | Visible Work mode showed independent WEB chips; ChatGPT was switched to API without sending |
| Draft locks AI and transport selection | PASS (code/test) | Selector and pane close controls become disabled when the local composer is non-empty; no task submitted |
| API settings module | PASS | Full local settings dialog visibly rendered after native web views were temporarily hidden |
| API secret handling | PASS (code/test) | Test confirms plaintext is absent from settings file and renderer sees only `hasApiKey` |
| API protocol adapters | PASS (mocked) | OpenAI-compatible request/parse tested; Anthropic and Gemini real endpoints NOT_RUN |
| New/switch/continue conversations | PASS (code/test/UI) | History sidebar rendered migrated conversation and current task count |
| Folder classification and dynamic rename/move | PASS (code/test) | Physical history directory moved and old empty parent removed |
| Local text/artifact/evidence projection | PASS | Existing local state generated `history/常规/既有对话/` with metadata, messages, artifacts and evidence |
| Generated-file routing | PASS (code/test) | Provider downloads resolve into active conversation `generated/<provider>/`; unsafe and duplicate names are normalized |
| Git privacy boundary | PASS | `history/` ignored; no API key or local history staged |

No real web prompt or API request was submitted during this revision. API integration tests use an in-process mock response.
