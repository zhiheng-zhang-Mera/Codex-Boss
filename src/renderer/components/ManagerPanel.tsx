import React, { useEffect, useState } from "react";
import type { AppSnapshot, ApiProtocol, ProviderId, RemoteChannel, WorkspaceViewStatus } from "../../shared/contracts";
import { MAX_ACTIVE_PROVIDERS } from "../../shared/provider-policy";

type Section = "providers" | "api" | "runtime";

function maskedKey(setting: AppSnapshot["apiSettings"][number] | undefined): string {
  if (!setting?.hasApiKey) return "未保存密钥";
  return setting.keyTail ? `密钥已保存 · sk-••••••••${setting.keyTail}` : "密钥已保存";
}

/**
 * U5 (§10.1/§10.2): Web-AI / Provider / Profile-Account / API / Runtime
 * manager surface. One aggregated place to open/close/reload providers, switch
 * the workspace view, inspect account health, edit masked API settings, and
 * steer runtime role routes. Every mutation returns the fresh snapshot.
 */
export function ManagerPanel({ snapshot, onClose, onChanged, onError }: {
  snapshot: AppSnapshot;
  onClose(): void;
  onChanged(next: AppSnapshot): void;
  onError(message: string): void;
}) {
  const [section, setSection] = useState<Section>("providers");
  const [view, setView] = useState<WorkspaceViewStatus | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("https://");
  const openProviders = snapshot.providers.filter((provider) => provider.windowOpen);
  const accountFor = (providerId: string) => snapshot.accounts.find((account) => account.providerId === providerId);

  useEffect(() => {
    void window.boss.getWorkspaceView().then(setView).catch(() => {});
  }, []);

  async function run(action: () => Promise<AppSnapshot>) {
    try { onChanged(await action()); }
    catch (reason) { onError(String(reason)); }
  }

  async function toggleOpen(providerId: ProviderId) {
    const target = snapshot.providers.find((provider) => provider.id === providerId);
    if (!target) return;
    if (!target.windowOpen && openProviders.length >= MAX_ACTIVE_PROVIDERS) { onError(`最多同时打开 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`); return; }
    await run(() => target.windowOpen ? window.boss.closeProvider(providerId) : window.boss.openProvider(providerId));
  }

  async function setWorkspaceView(next: "MERGED" | "DETACHED") {
    try { setView(await window.boss.setWorkspaceView(next)); }
    catch (reason) { onError(String(reason)); }
  }

  async function addCustom(event: React.FormEvent) {
    event.preventDefault();
    try {
      const next = await window.boss.addCustomProvider({ name: customName, url: customUrl });
      const added = next.providers.at(-1);
      onChanged(next);
      if (added?.isCustom && next.providers.filter((item) => item.windowOpen).length < MAX_ACTIVE_PROVIDERS) onChanged(await window.boss.openProvider(added.id));
      setCustomName(""); setCustomUrl("https://"); setCustomOpen(false);
    } catch (reason) { onError(String(reason)); }
  }

  async function saveApiSetting(event: React.FormEvent<HTMLFormElement>, providerId: ProviderId) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(() => window.boss.updateApiSetting({
      providerId,
      enabled: data.get("enabled") === "on",
      protocol: String(data.get("protocol")) as ApiProtocol,
      baseUrl: String(data.get("baseUrl")),
      model: String(data.get("model")),
      apiKey: String(data.get("apiKey") ?? ""),
      clearApiKey: data.get("clearApiKey") === "on"
    }));
  }

  async function saveRemoteChannel(event: React.FormEvent<HTMLFormElement>, channel: RemoteChannel) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(() => window.boss.updateRemoteChannel({ channel, enabled: data.get("enabled") === "on", commandPrefix: String(data.get("commandPrefix") ?? "/boss") }));
  }

  async function saveRuntimeControl(event: React.FormEvent<HTMLFormElement>, runtimeId: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(() => window.boss.updateRuntimeControl(runtimeId, data.get("enabled") === "on", Number(data.get("priority") ?? 100)));
  }

  async function saveRoleRoute(event: React.FormEvent<HTMLFormElement>, route: AppSnapshot["roleRoutes"][number]) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const primary = String(data.get("primary") ?? "");
    const runtimeIds = [primary, ...route.runtimeIds.filter((runtimeId) => runtimeId !== primary)].filter(Boolean);
    await run(() => window.boss.updateRoleRoute(route.role, runtimeIds, data.get("fallback") === "on"));
  }

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-panel manager-panel" aria-label="AI & Provider 管理器">
      <header><div><strong>AI & Provider 管理器</strong><span>启用/打开页面 · 账户健康 · API 密钥（掩码） · 运行时路由</span></div>
        <div className="manager-tabs">
          <button className={section === "providers" ? "active" : ""} onClick={() => setSection("providers")}>Providers</button>
          <button className={section === "api" ? "active" : ""} onClick={() => setSection("api")}>API</button>
          <button className={section === "runtime" ? "active" : ""} onClick={() => setSection("runtime")}>Runtime</button>
        </div>
        <button onClick={onClose}>×</button>
      </header>

      {section === "providers" && <>
        <div className="manager-view-row">
          <b>工作区视图</b>
          <span>DETACHED 模式下网页 AI 移入独立窗口 B，会话保持；关闭窗口 B 自动回到 MERGED</span>
          <div className="manager-view-toggle">
            <button className={view?.view === "MERGED" || !view ? "active" : ""} disabled={view?.view === "MERGED"} onClick={() => void setWorkspaceView("MERGED")}>Merged</button>
            <button className={view?.view === "DETACHED" ? "active" : ""} disabled={view?.view === "DETACHED"} onClick={() => void setWorkspaceView("DETACHED")}>Detached</button>
          </div>
        </div>
        <div className="manager-provider-list">
          {snapshot.providers.map((provider) => {
            const account = accountFor(provider.id);
            const runtime = snapshot.runtimeStatuses.find((item) => item.runtimeId === `web:${provider.id}`);
            return <div className={`manager-provider-row ${provider.windowOpen ? "open" : ""}`} key={provider.id}>
              <i className={`pane-account pane-${(account?.mode ?? "UNKNOWN").toLowerCase()}`} style={{ background: provider.accent }} />
              <div className="manager-provider-main">
                <b>{provider.name}</b>
                <small>{provider.url}</small>
                <span className={`manager-account account-${(account?.mode ?? "UNKNOWN").toLowerCase()}`}>{account?.mode ?? "UNKNOWN"}{provider.windowOpen ? " · 已打开" : " · 已关闭"}</span>
                <small>{account?.message ?? runtime?.message ?? ""}{account?.updatedAt ? ` · ${new Date(account.updatedAt).toLocaleString()}` : ""}</small>
              </div>
              <div className="manager-provider-actions">
                <button onClick={() => void toggleOpen(provider.id)}>{provider.windowOpen ? "关闭" : "打开"}</button>
                <button disabled={!provider.windowOpen} onClick={() => void window.boss.reloadProvider(provider.id).catch((reason) => onError(String(reason)))} title="重载登录页面">重载</button>
                {provider.isCustom && <button className="menu-danger" onClick={() => void run(() => window.boss.removeCustomProvider(provider.id))}>移除</button>}
              </div>
            </div>;
          })}
          <button className="add-provider" onClick={() => setCustomOpen((value) => !value)}>＋ 添加自定义网页 AI</button>
          {customOpen && <form className="custom-provider-form" onSubmit={addCustom}>
            <input value={customName} maxLength={50} onChange={(event) => setCustomName(event.target.value)} placeholder="AI 名称" autoFocus />
            <input value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} placeholder="https://example.com/chat" type="url" />
            <button type="submit" disabled={!customName.trim() || !customUrl.trim()}>添加</button>
            <button type="button" onClick={() => setCustomOpen(false)}>取消</button>
          </form>}
        </div>
      </>}

      {section === "api" && <div className="api-settings-list">
        <div className="settings-section-title"><b>API 通道（密钥掩码显示，明文仅存于本地安全存储）</b></div>
        {snapshot.providers.map((provider) => {
          const setting = snapshot.apiSettings.find((item) => item.providerId === provider.id);
          return <form key={`manager-api-${provider.id}-${setting?.updatedAt ?? "new"}`} onSubmit={(event) => void saveApiSetting(event, provider.id)} className="api-setting-card">
            <div className="api-setting-title"><b>{provider.name}</b><span>{maskedKey(setting)}</span><label><input name="enabled" type="checkbox" defaultChecked={setting?.enabled} /> 启用</label></div>
            <div className="api-setting-fields">
              <select name="protocol" defaultValue={setting?.protocol ?? "openai-compatible"}><option value="openai-compatible">OpenAI-compatible</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select>
              <input name="baseUrl" type="url" required defaultValue={setting?.baseUrl ?? "https://"} placeholder="API Base URL" />
              <input name="model" required defaultValue={setting?.model ?? ""} placeholder="模型名称" />
              <input name="apiKey" type="password" placeholder={setting?.hasApiKey ? "留空保留现有密钥" : "API Key"} />
            </div>
            <div className="api-setting-actions"><label><input name="clearApiKey" type="checkbox" /> 清除已有密钥</label><button type="submit">保存</button></div>
          </form>;
        })}
        <section className="remote-settings"><div className="settings-section-title"><b>PC 远程指令</b><span>先登录桌面客户端；仅识别前缀消息并进入人工确认队列</span></div>
          {snapshot.remoteChannels.map((setting) => <form key={`${setting.channel}-${setting.updatedAt}`} className="remote-setting-card" onSubmit={(event) => void saveRemoteChannel(event, setting.channel)}>
            <div><b>{setting.channel === "wechat" ? "微信" : "QQ"}</b><i className={`remote-status status-${setting.status}`} /> <span>{setting.status}</span><small>{setting.message}</small></div>
            <label>前缀 <input name="commandPrefix" defaultValue={setting.commandPrefix} pattern="/[^\\s]{1,19}" required /></label>
            <label><input name="enabled" type="checkbox" defaultChecked={setting.enabled} /> 启用</label>
            <button type="submit">保存</button>
          </form>)}
        </section>
      </div>}

      {section === "runtime" && <div className="api-settings-list">
        <div className="settings-section-title"><b>运行时可用性（窗口打开 = 可见，≠ 健康；可用性来自最近账户探测）</b></div>
        <div className="runtime-status-grid manager-runtime-grid">{snapshot.runtimeStatuses.map((runtime) => <form key={runtime.runtimeId} onSubmit={(event) => void saveRuntimeControl(event, runtime.runtimeId)}>
          <span className={`runtime-${runtime.availability.toLowerCase()}`}><i />{runtime.label}<small>{runtime.availability} · {runtime.budget}</small></span>
          <label><input name="enabled" type="checkbox" defaultChecked={runtime.enabled} /> 启用</label>
          <label>优先级 <input name="priority" type="number" min="0" max="999" defaultValue={runtime.priority} /></label>
          <button type="submit">保存</button>
        </form>)}</div>
        <div className="settings-section-title"><b>角色路由（默认自动映射；实现者 ≠ 验收者）</b></div>
        <div className="role-route-grid manager-role-grid">{snapshot.roleRoutes.map((route) => <form key={route.role} onSubmit={(event) => void saveRoleRoute(event, route)}>
          <b>{route.role}</b>
          <select name="primary" defaultValue={route.runtimeIds[0]}>{snapshot.runtimeStatuses.filter((runtime) => runtime.enabled).map((runtime) => <option key={runtime.runtimeId} value={runtime.runtimeId}>{runtime.label}</option>)}</select>
          <label><input name="fallback" type="checkbox" defaultChecked={route.fallback} /> fallback</label>
          <button type="submit">设为首选</button>
        </form>)}</div>
      </div>}
    </section>
  </div>;
}
