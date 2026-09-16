# Phase 03 — Capability Security & Plugin Boundary / 能力权限与插件边界工程书

> **前置分支：** `platform-foundation/02-durable-state-events`
>
> **本阶段分支：** `platform-foundation/03-capability-security-plugins`
>
> **阶段原则：** 先建立“谁可以对什么做什么”的统一能力安全模型，再允许插件或外部扩展进入 Boss。任何插件化都不得以扩大默认权限为代价。

## 1. 目标

把当前 Execution Gate、Root Authority、Runtime/Provider registry 等分散安全边界统一为 capability-based authorization contract，并为未来社区插件、Computer Use、邮箱、GitHub、云服务、数据库等高权限扩展建立最小权限执行边界。

## 2. 绝对约束

- **Default deny。** Manifest 未声明的权限一律不可用。
- **禁止插件获得 ambient authority。** 不得直接继承主进程的 fs、shell、credential、Cookie、环境变量或 GitHub owner 身份。
- **权限授予必须绑定 subject + scope + action + resource + lifetime。** 不接受单一 `isTrusted=true`。
- **Root/Owner 权限永不由 capability 自行升级。** 自我进化不得修改自己的授权事实后立即生效。
- **UI/主题类插件禁止 shell/fs/network 默认访问。**
- **外部凭据必须通过 capability token/reference 间接使用，不能把 secret 原文传给 Agent 或插件。**
- **插件 crash、超时、恶意行为只能降级对应 capability，不得拖垮 Boss 核心。**
- Phase 01 的 manifest/graph 为唯一 capability 身份来源；Phase 02 的 state/event core 保存授权和审计事实。

## 3. 权限模型

建议统一描述：

```yaml
subject: plugin.wallpaper.example
capability: ui.theme
resource: ui.theme.current
actions:
  - read
  - propose
scope:
  project: global
lifetime:
  mode: session
constraints:
  network: none
  filesystem: none
```

高风险示例：

```yaml
subject: engineering.worker
capability: github.write
resource: repo:zhiheng-zhang-Mera/Codex-Boss
actions:
  - branch.create
  - commit.push
  - pr.create
constraints:
  admin: false
  forcePush: false
  protectedSurface: owner-gated
```

## 4. 施工任务

### Task A — Permission contract

- 定义 Subject、Resource、Action、Scope、Grant、Denial、Decision。
- 所有授权决策必须返回 reason code 和 evidence reference。
- 任何无法解析的 resource/action 一律 DENY。

### Task B — Capability broker

- 单一 broker 负责把“请求能力”转换为具体 adapter handle。
- broker 不保存业务状态，只做鉴权、scope 限制和审计。
- adapter 不能绕过 broker 获取高权限 credential。

### Task C — Plugin execution boundary

先实现最小插件 contract，不追求生态完整：

```text
manifest
entrypoint
capabilities requested
health()
dispose()
```

插件执行环境必须与主 Electron trusted main 隔离；优先 child process / utility process / sandboxed context，禁止任意 Node import 主进程模块。

### Task D — Credential references

- 引入 opaque credential reference。
- 插件只拿到“可调用能力”，不能读取原始 token。
- credential scope 必须可以限制到 provider/repo/account/action。
- revoke 后新调用立即失效。

### Task E — Abuse / escape acceptance

至少覆盖：

- UI 插件尝试读项目文件。
- UI 插件尝试网络访问。
- 普通 worker 尝试 GitHub admin/force push。
- Research worker 尝试调用 email.send。
- 插件尝试读取环境变量中的 secret。
- 插件制造无限子进程或超长任务。
- 插件崩溃后 Boss 其余能力继续 READY。

## 5. 明确不做

- 不建设公开插件商店。
- 不自动安装第三方插件。
- 不开放“用户勾选全部权限”快捷通道。
- 不把现有全部模块强制插件化。
- 不重写 provider/runtime 业务逻辑。

## 6. 验收门槛

1. Phase 01/02 全部门槛继续通过。
2. 所有高权限操作能够映射到显式 capability decision。
3. 无授权的 plugin/worker 对 fs、shell、credential、network、GitHub write 的逃逸测试全部被拒绝。
4. revoke/expiry 在运行中生效。
5. 至少一个低风险内置能力通过插件边界运行并可独立 crash/restart，不影响 Boss 核心。
6. Root/Owner protected surface 仍保持现有人工边界，不因 capability broker 弱化。
7. 生成 `artifacts/platform-foundation/phase-03/permission-surface.json`：subjects、grants、denials、credential refs、plugin isolation evidence。

## 7. 回滚规则

- 失败回到 Phase 02。
- 任何为了兼容旧功能而新增的 `allowAll`、wildcard admin、ambient token 视为阶段失败。
- 如果某现有功能暂时无法适配 broker，可保留 legacy route 并显式标记 debt，但不能伪装为已迁移。

## 8. 完成定义

Boss 获得统一的最小权限能力层；未来新增 Email、Cloud、DB、Computer Use 或社区插件时，默认只能拿到声明过、受 scope 限制、可撤销且有审计的能力，而不是直接进入 trusted main process。
