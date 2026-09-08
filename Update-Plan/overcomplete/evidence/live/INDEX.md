# evidence/live — Live 验收证据索引（9-8-overcomplete）

> 证据由 CDP 驱动已登录的 Codex-Boss 实况采集；所有 item 均为真实可见网页 AI 回答/真实工程与研究执行，非 mock。

| 类别 | 文件 | 结果 |
|---|---|---|
| 连接/快照 | `live-cdp-connect-*.json` | ChatGPT/Gemini/DeepSeek/Qwen/Grok READY；`web:chatgpt` AVAILABLE；`codex:cli` AVAILABLE |
| 1-AI | `live-1ai-echo-*`（chatgpt）、`live-deepseek-enter-*`、`live-grok-echo-*`、`live-copilot-echo-*` | PASS（各 `<brand>-OK`，审查通过） |
| 3-AI | `live-3ai-echo-*` | PASS（OpenAI/Google/DeepSeek） |
| 4-AI | `live-4ai-echo-*` | PASS（+xAI/Grok） |
| 5-AI | `live-5ai-full-*` | **FULL PASS**（5/5 artifacts + final；resilience 修复后可靠） |
| Chat 延续 | `live-chat-continuation-*` | PASS（同会话 URL + 上下文记忆 CHAT-CONT-A/B） |
| Chat vs Work | `live-chat-vs-work-*` | PASS（Chat 同 URL 延续；Work fresh 每任务独立 URL） |
| Council | `live-council-3-*` | COMPLETED（proposals→peer_review→synthesis，9 runs） |
| 工程 Goal | `live-engineering-goal-*` | **CONVERGED**（真实 AI coder：`"not-a-number"→0`；typecheck/tests PASS；reviewer） |
| Research live | `live-research-chain-*` | 语义链到 manuscript；paper reviewer council **真实否决**（n=2 功效不足）→ 诚实 FAILED（无 TeX） |
| 外部归档 | `live-external-archive-*` | fail-closed pass（10 attempted/0 archived/10 deferred，无假 ARCHIVED） |
| 稳定性 finding | `live-finding-wedge-*`、`live-finding-chatgpt-send-*`、`live-finding-qwen-*` | 卡死/发送/采集问题 + 修复链（busy 顾问化、重试、就绪等待、cancel 释放、monitor 25 分钟） |
| 适配器代码 | `electron/adapters/registry.ts`、`page-scripts.ts`、`provider-automation.ts` | DeepSeek/Copilot enter 模式、通用默认规则、journal、韧性修复 |

关联提交（节选）：`0d65210` 1-AI · `52d11b8` 3-AI · `3126570` grok · `621827f` 4-AI · `fe5930c` deepseek enter · `e458be5` copilot · `4ab5fb9` council · `1fe2d4b` goal · `4c2ebc3` archive+wedge · `7387a82` chat 延续 · `8280752` 5-AI FULL · `33de05c` research live · `ef50428` resilience · `8bba643/aa0e5bc/0eda890/ed00698` 适配器+journal+修复。
| Research READY+PDF | live-research-ready-* | **PASS_READY**��tectonic paper.pdf, 6 seeds, final audit PASS, �ɹ������� |
