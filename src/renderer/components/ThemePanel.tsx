import { useState } from "react";
import type { ThemeSnapshot } from "../../shared/theme";

/**
 * checkpoint-1 §54 — Theme Manager surface (CP4 subset).
 *
 * List / Active theme / Create (duplicate) / Delete / Restore default. Preview
 * and prompt-driven creation belong to CP5 (the generator + preview sandbox);
 * this panel only drives the lifecycle the CP4 engine already enforces, and it
 * reports the engine's reason when an action is refused (for example deleting a
 * locked built-in) instead of silently doing nothing.
 */
export function ThemePanel({ theme, onTheme, onError }: {
  theme: ThemeSnapshot;
  onTheme: (next: ThemeSnapshot) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [customName, setCustomName] = useState("My Theme");

  async function run(action: () => Promise<ThemeSnapshot>): Promise<void> {
    if (busy) return;
    setBusy(true);
    try { onTheme(await action()); }
    catch (reason) { onError(String(reason instanceof Error ? reason.message : reason)); }
    finally { setBusy(false); }
  }

  return <section className="remote-settings theme-settings">
    <div className="settings-section-title">
      <b>主题</b>
      <span>当前：{theme.activeName}（{theme.activeThemeId}）{theme.fallback ? " · 已回退到内置主题" : ""}</span>
    </div>
    <div className="theme-list">
      {theme.themes.map((record) => <div className={`theme-row ${record.id === theme.activeThemeId ? "active" : ""}`} key={record.id}>
        <span className="theme-name">
          <b>{record.name}</b>
          <small>{record.builtIn ? "内置 · 锁定" : "自定义"} · {record.state}{record.validation?.ok === false ? " · 校验未通过" : ""}</small>
        </span>
        <button type="button" disabled={busy || record.id === theme.activeThemeId} onClick={() => void run(() => window.boss.themeActivate(record.id))}>激活</button>
        <button type="button" disabled={busy} title="复制为独立的自定义主题（§11：不产生依赖关系）" onClick={() => void run(() => window.boss.themeDuplicate(record.id, { id: `copy-${record.id}`, name: `${record.name} 副本` }))}>复制</button>
        <button type="button" disabled={busy || !record.deletable} title={record.deletable ? "删除该主题（活动主题会先回退到内置主题，§22）" : "内置主题不可删除（§12）"} onClick={() => void run(() => window.boss.themeDelete(record.id))}>删除</button>
      </div>)}
    </div>
    <div className="theme-actions">
      <label>新主题名称 <input aria-label="新主题名称" value={customName} maxLength={60} onChange={(event) => setCustomName(event.target.value)} /></label>
      <button type="button" disabled={busy || !customName.trim()} onClick={() => void run(() => window.boss.themeDuplicate(theme.activeThemeId, { id: `custom-${Date.now().toString(36)}`, name: customName.trim() }))}>基于当前主题新建自定义主题</button>
      <button type="button" disabled={busy} onClick={() => void run(() => window.boss.themeRestoreDefault())}>恢复默认（Dark）</button>
    </div>
    {theme.diagnostics.length > 0 && <details className="theme-diagnostics"><summary>主题引擎日志 · {theme.diagnostics.length}</summary>
      <ol>{theme.diagnostics.slice(-8).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
    </details>}
  </section>;
}
