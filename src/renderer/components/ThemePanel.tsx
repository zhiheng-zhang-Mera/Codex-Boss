import { useState } from "react";
import type { ThemeGenerationOutcome, ThemePreviewView, ThemeSnapshot } from "../../shared/theme";
import type { VisualCheckReport } from "../../shared/theme-visual-check";

/**
 * checkpoint-1 §54 / §14 / §17 / §26 — Theme Manager surface (CP5).
 *
 * List · Active theme · Create from a prompt · Preview (accept / revise /
 * cancel) · Delete · Restore default · Visual check. The panel drives the engine
 * that already enforces the rules; it never decides anything itself, and every
 * refusal is shown with the engine's own reason (a locked built-in, a failed
 * validation, or a §19 escalation to UI engineering).
 */
export function ThemePanel({ theme, onTheme, onError, onPreview }: {
  theme: ThemeSnapshot;
  onTheme: (next: ThemeSnapshot) => void;
  onError: (message: string) => void;
  onPreview: (preview: ThemePreviewView | undefined) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [customName, setCustomName] = useState("My Theme");
  const [prompt, setPrompt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [draft, setDraft] = useState<ThemeGenerationOutcome | undefined>();
  const [visual, setVisual] = useState<VisualCheckReport | undefined>();

  async function run<T>(action: () => Promise<T>, apply: (value: T) => void): Promise<void> {
    if (busy) return;
    setBusy(true);
    try { apply(await action()); }
    catch (reason) { onError(String(reason instanceof Error ? reason.message : reason)); }
    finally { setBusy(false); }
  }

  function acceptDraft(outcome: ThemeGenerationOutcome | undefined): void {
    setDraft(outcome);
    onPreview?.(outcome?.preview);
  }

  return <section className="remote-settings theme-settings">
    <div className="settings-section-title">
      <b>主题</b>
      <span>当前：{theme.activeName}（{theme.activeThemeId}）{theme.fallback ? " · 已回退到内置主题" : ""}</span>
    </div>

    <form className="theme-generator" onSubmit={(event) => {
      event.preventDefault();
      if (!prompt.trim()) return;
      void run(() => window.boss.themeGenerate({ prompt: prompt.trim(), name: customName.trim() || undefined }), acceptDraft);
    }}>
      <label>用一句话描述你想要的主题
        <textarea aria-label="主题提示词" rows={2} maxLength={500} value={prompt} onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：做一个类似 macOS 风格、偏冷、半透明、紧凑一点的主题" />
      </label>
      <label>主题名称 <input aria-label="主题名称" value={customName} maxLength={60} onChange={(event) => setCustomName(event.target.value)} /></label>
      <button type="submit" disabled={busy || !prompt.trim()}>{busy ? "…" : "生成预览"}</button>
    </form>

    {draft && <div className={`theme-draft ${draft.escalated ? "escalated" : draft.ok ? "ok" : "invalid"}`} role="status">
      <b>{draft.escalated ? "这不是主题任务（§19）" : draft.ok ? "预览已生成" : "草稿未通过校验"}</b>
      <p>{draft.reason}</p>
      {draft.references.length > 0 && <p className="theme-references">参考风格：{draft.references.join("、")}</p>}
      {draft.captureSummary && <p className="theme-capture">视觉取证：{draft.captureSummary}</p>}
      {draft.decisions.length > 0 && <details><summary>推导决策 · {draft.decisions.length}</summary>
        <ol>{draft.decisions.slice(0, 24).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
      </details>}
      {draft.repairs.length > 0 && <details><summary>可读性修复 · {draft.repairs.length}</summary>
        <ol>{draft.repairs.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
      </details>}
      {draft.preview && <>
        {draft.preview.errors.length > 0 && <details className="theme-errors"><summary>校验错误 · {draft.preview.errors.length}</summary><ol>{draft.preview.errors.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol></details>}
        {draft.preview.warnings.length > 0 && <details><summary>校验警告 · {draft.preview.warnings.length}</summary><ol>{draft.preview.warnings.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol></details>}
        <div className="theme-preview-actions">
          <button type="button" disabled={busy || !draft.preview.valid} onClick={() => void run(() => window.boss.themePreviewAccept({ activate: true }), (next) => { onTheme(next); acceptDraft(undefined); })}>接受并激活</button>
          <button type="button" disabled={busy || !draft.preview.valid} onClick={() => void run(() => window.boss.themePreviewAccept({ activate: false }), (next) => { onTheme(next); acceptDraft(undefined); })}>仅安装</button>
          <button type="button" disabled={busy} onClick={() => void run(() => window.boss.themePreviewCancel(), (next) => { onTheme(next); acceptDraft(undefined); })}>取消预览</button>
        </div>
        <form className="theme-feedback" onSubmit={(event) => {
          event.preventDefault();
          if (!feedback.trim()) return;
          const message = feedback.trim();
          setFeedback("");
          void run(() => window.boss.themePreviewRevise({ feedback: message }), acceptDraft);
        }}>
          <label>修改意见（自然语言，例如“再透明一些”“字体不要这么圆”）
            <input aria-label="主题修改意见" value={feedback} maxLength={200} onChange={(event) => setFeedback(event.target.value)} placeholder="再透明一些" />
          </label>
          <button type="submit" disabled={busy || !feedback.trim()}>提交修改</button>
        </form>
      </>}
    </div>}

    <div className="theme-list">
      {theme.themes.map((record) => <div className={`theme-row ${record.id === theme.activeThemeId ? "active" : ""}`} key={record.id}>
        <span className="theme-name">
          <b>{record.name}</b>
          <small>{record.builtIn ? "内置 · 锁定" : "自定义"} · {record.state}{record.validation?.ok === false ? " · 校验未通过" : ""}</small>
        </span>
        <button type="button" disabled={busy || record.id === theme.activeThemeId} onClick={() => void run(() => window.boss.themeActivate(record.id), onTheme)}>激活</button>
        <button type="button" disabled={busy} title="复制为独立的自定义主题（§11：不产生依赖关系）" onClick={() => void run(() => window.boss.themeDuplicate(record.id, { id: `copy-${record.id}`, name: `${record.name} 副本` }), onTheme)}>复制</button>
        <button type="button" disabled={busy || !record.deletable} title={record.deletable ? "删除该主题（活动主题会先回退到内置主题，§22）" : "内置主题不可删除（§12）"} onClick={() => void run(() => window.boss.themeDelete(record.id), onTheme)}>删除</button>
      </div>)}
    </div>

    <div className="theme-actions">
      <button type="button" disabled={busy} onClick={() => void run(() => window.boss.themeDuplicate(theme.activeThemeId, { id: `custom-${Date.now().toString(36)}`, name: customName.trim() || "自定义主题" }), onTheme)}>基于当前主题新建自定义主题</button>
      <button type="button" disabled={busy} onClick={() => void run(() => window.boss.themeRestoreDefault(), onTheme)}>恢复默认（Dark）</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => {
        const { measureForVisualCheck } = await import("../theme-measure");
        return window.boss.themeVisualCheck(measureForVisualCheck(theme.activeThemeId));
      }, setVisual)}>视觉检查（§26）</button>
      <button type="button" disabled={busy} onClick={() => void run(() => window.boss.themeCapture(), (result) => onError(result ? `已生成 ${result.frames.length} 张脱敏界面截图：${result.frames.map((frame) => frame.surface).join("、")}（${result.directory}）` : "当前没有可截取的界面"))}>视觉取证（脱敏）</button>
    </div>

    {visual && <div className={`theme-visual ${visual.ok ? "ok" : "failed"}`} role="status">
      <b>视觉检查 {visual.ok ? "通过" : "未通过"}（{visual.findings.length} 项发现）</b>
      {visual.contrast.length > 0 && <ul>{visual.contrast.map((entry) => <li key={entry.surface}>{entry.surface}: {entry.ratio.toFixed(2)}:1（要求 {entry.required}:1）{entry.ok ? " ✓" : " ✗"}</li>)}</ul>}
      {visual.findings.length > 0 && <ol>{visual.findings.slice(0, 12).map((finding, index) => <li key={`${index}-${finding.rule}`}>{finding.severity} · {finding.rule}: {finding.message}</li>)}</ol>}
    </div>}

    {theme.diagnostics.length > 0 && <details className="theme-diagnostics"><summary>主题引擎日志 · {theme.diagnostics.length}</summary>
      <ol>{theme.diagnostics.slice(-8).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
    </details>}
  </section>;
}
