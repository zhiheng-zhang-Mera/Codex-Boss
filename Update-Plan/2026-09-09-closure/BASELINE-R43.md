# R43 基线快照（Phase 0）

- 日期：2026-09-09
- 施工分支：`9-2026-09-09-closure`（自 `main` @ `825cd1f` 创建）
- 同步：`main` == `owner-result` @ `825cd1f`（R43 最终验收快照）；DS-Hns 冻结不改造。
- 门禁（Phase 0 复验）：typecheck PASS · vitest **51 文件 / 254 测试 PASS** · full build PASS
  （electron emit exit 0）。证据：`evidence/baseline-r43.json`。
- 锁定项：见 requirement-manifest.json 中 `LOCKED_PASS`（L-01…L-20）——只回归，不重写。
- 当前不得假定完成：manifest 中 `REQUIRED_PENDING / LIVE_REQUIRED` 全部（R-101…R-1003），
  覆盖 R43 plan §1.2 与 §4–§17 的全部 REQUIRED 施工范围。
