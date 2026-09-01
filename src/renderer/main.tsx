import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppSnapshot, BossTask, ProviderId, TaskMode, ViewBounds } from "../shared/contracts";
import { isDispatchGroupSize, MAX_ACTIVE_PROVIDERS } from "../shared/provider-policy";
import { emptySnapshot, shortTime } from "./state";
import "./styles.css";

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<TaskMode>("direct");
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("https://");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const surfaceRefs = useRef<Partial<Record<ProviderId, HTMLDivElement | null>>>({});
  const openProviders = snapshot.providers.filter((provider) => provider.windowOpen);
  const selectedProviders = openProviders.map((provider) => provider.id);
  const openKey = openProviders.map((provider) => provider.id).join(",");

  useEffect(() => {
    void window.boss.snapshot().then(setSnapshot).catch((reason) => setError(String(reason)));
    return window.boss.onSnapshot(setSnapshot);
  }, []);

  useEffect(() => {
    const sendLayout = () => {
      const layout: Partial<Record<ProviderId, ViewBounds>> = {};
      for (const provider of openProviders) {
        const element = surfaceRefs.current[provider.id];
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        layout[provider.id] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      void window.boss.layoutViews(layout);
    };
    const frame = requestAnimationFrame(sendLayout);
    const observer = new ResizeObserver(sendLayout);
    for (const provider of openProviders) {
      const element = surfaceRefs.current[provider.id];
      if (element) observer.observe(element);
    }
    window.addEventListener("resize", sendLayout);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sendLayout);
    };
  }, [openKey]);

  const activeTasks = useMemo(() => snapshot.tasks.slice(0, 20).reverse(), [snapshot.tasks]);

  async function toggleProvider(providerId: ProviderId) {
    setError("");
    try {
      const target = snapshot.providers.find((provider) => provider.id === providerId);
      if (!target) throw new Error(`Unknown provider: ${providerId}`);
      if (!target.windowOpen && openProviders.length >= MAX_ACTIVE_PROVIDERS) throw new Error(`最多同时打开 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`);
      setSnapshot(target.windowOpen ? await window.boss.closeProvider(providerId) : await window.boss.openProvider(providerId));
    } catch (reason) { setError(String(reason)); }
  }

  async function addCustomProvider(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const next = await window.boss.addCustomProvider({ name: customName, url: customUrl });
      const added = next.providers.at(-1);
      setSnapshot(next);
      if (added?.isCustom && openProviders.length < MAX_ACTIVE_PROVIDERS) setSnapshot(await window.boss.openProvider(added.id));
      setCustomName("");
      setCustomUrl("https://");
      setCustomOpen(false);
    } catch (reason) { setError(String(reason)); }
  }

  async function removeCustomProvider(providerId: ProviderId) {
    setError("");
    try {
      setSnapshot(await window.boss.removeCustomProvider(providerId));
    } catch (reason) { setError(String(reason)); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const title = prompt.trim().split(/\r?\n/, 1)[0].slice(0, 48);
      setSnapshot(await window.boss.dispatchTask({ title, prompt: prompt.trim(), providerIds: selectedProviders, mode }));
      setPrompt("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }

  async function taskAction(taskId: string, action: "dispatch" | "capture" | "advance" | "evidence" | "rehydrate" | "codex") {
    setError("");
    setSending(true);
    try {
      const next = action === "dispatch" ? await window.boss.sendTask(taskId)
        : action === "capture" ? await window.boss.captureTask(taskId)
            : action === "advance" ? await window.boss.advanceCouncil(taskId)
              : action === "evidence" ? await window.boss.buildEvidence(taskId)
                : action === "rehydrate" ? await window.boss.rehydrateEvidence(taskId)
                  : await window.boss.runCodexReview(taskId);
      setSnapshot(next);
    } catch (reason) { setError(String(reason)); }
    finally { setSending(false); }
  }

  function latestRuns(task: BossTask) {
    const runs = snapshot.runs.filter((run) => run.taskId === task.id);
    const round = Math.max(0, ...runs.map((run) => run.round));
    return runs.filter((run) => run.round === round);
  }

  return <div className={`desktop-shell ${openProviders.length === 5 ? "layout-five" : ""}`}>
    <section className="chat-half">
      <header className="chat-header">
        <div className="app-brand"><span>B</span><div><strong>Codex Boss</strong><small>LOCAL MULTI-AI WORKSPACE</small></div></div>
        <div className="header-status"><div className="controller-pill"><i className={snapshot.controller.accountMode === "CHATGPT" ? "online" : ""} /> Codex: {snapshot.controller.accountMode}</div><div className="workspace-pill"><i /> 本地工作区</div></div>
      </header>

      <div className="conversation">
        <div className="welcome-card">
          <div className="welcome-mark">⌘</div>
          <h1>今天要处理什么？</h1>
          <p>在左侧输入一次任务，右侧会按所选网页版 AI 数量自动分屏。每个页面保持独立登录状态，并始终可见。</p>
        </div>

        {activeTasks.map((task) => {
          const runs = latestRuns(task);
          const council = snapshot.councils.find((item) => item.taskId === task.id);
          const evidence = snapshot.evidenceBundles.find((item) => item.taskId === task.id);
          const checkpoint = snapshot.dispatchCheckpoints.find((item) => item.taskId === task.id && item.round === (council?.round ?? runs[0]?.round ?? 1));
          const artifactCount = snapshot.artifacts.filter((artifact) => artifact.taskId === task.id).length;
          const allComplete = runs.length > 0 && runs.every((run) => run.phase === "completed");
          const canCapture = runs.some((run) => run.phase === "waiting");
          const canRetry = checkpoint?.status === "ROLLED_BACK" && !checkpoint.requiresReconciliation;
          const roundCommitted = checkpoint?.status === "COMMITTED" && !checkpoint.requiresReconciliation;
          return <article className="conversation-turn" key={task.id}>
          <div className="user-message"><span>你</span><p>{task.prompt}</p></div>
          <div className="boss-message">
            <div className="boss-avatar">B</div>
            <div><strong>已分派到 {task.providerIds.map((id) => snapshot.providers.find((item) => item.id === id)?.name ?? id).join("、")}</strong>
              <p>{task.mode === "council" ? `Council · ${council?.stage ?? "初始化"} · 第 ${council?.round ?? 1} 轮` : "Direct"}，任务状态：{task.status}。</p>
              <div className="run-statuses">{runs.map((run) => <span className={`run-${run.phase}`} key={run.id}>{snapshot.providers.find((item) => item.id === run.providerId)?.name ?? run.providerId}: {run.phase}{run.outcome ? ` · ${run.outcome}` : ""}</span>)}</div>
              {checkpoint && <div className={`dispatch-checkpoint checkpoint-${checkpoint.status.toLowerCase()}`}><b>{checkpoint.status}</b><span>{checkpoint.successfulProviderIds.length}/{checkpoint.expectedProviderIds.length} 成功 · {checkpoint.message}</span></div>}
              {runs.map((run) => run.message && <small className="run-message" key={`${run.id}-message`}>{run.providerId} — {run.message}</small>)}
              <div className="task-actions">
                {canRetry && <button className="confirm-send" onClick={() => void taskAction(task.id, "dispatch")} disabled={sending}>重新提交整组</button>}
                {canCapture && <button onClick={() => void taskAction(task.id, "capture")} disabled={sending}>采集下一个回答</button>}
                {task.mode === "council" && allComplete && roundCommitted && council && ["proposals", "peer_review", "synthesis"].includes(council.stage) && <button onClick={() => void taskAction(task.id, "advance")} disabled={sending}>提交下一轮到全部 AI</button>}
                {artifactCount > 0 && roundCommitted && <button onClick={() => void taskAction(task.id, "evidence")} disabled={sending}>生成 Phase 4 证据包</button>}
                {evidence && <button onClick={() => void taskAction(task.id, "codex")} disabled={sending || evidence.codexReview.status === "RUNNING"}>Codex 账户审查</button>}
                {evidence?.claims.some((claim) => claim.status === "DISPUTED" || claim.status === "INSUFFICIENT") && <button onClick={() => void taskAction(task.id, "rehydrate")} disabled={sending}>选择性回填</button>}
              </div>
              {council && (council.conflicts.length > 0 || council.minorityOpinions.length > 0) && <div className="council-findings"><b>保留的争议</b><span>{council.conflicts.length} 个冲突 · {council.minorityOpinions.length} 个少数意见</span></div>}
              {evidence && <div className="evidence-card"><div><b>{evidence.decision}</b><code>{evidence.integrityRoot.slice(0, 12)}</code></div><span>{evidence.manifest.length} artifacts · {evidence.claims.length} claims · {evidence.disputes.length} disputes · 缺失 {evidence.missingProviderIds.length}</span><small>Codex review: {evidence.codexReview.status}</small>{evidence.codexReview.content && <p>{evidence.codexReview.content.slice(0, 500)}</p>}</div>}
              <small>{shortTime(task.updatedAt)} · {task.providerIds.length} 个独立页面 · {artifactCount} 份原始证据</small>
            </div>
          </div>
        </article>; })}
      </div>

      <div className="composer-zone">
        <div className="mode-switch"><button className={mode === "direct" ? "active" : ""} onClick={() => setMode("direct")}>Direct</button><button className={mode === "council" ? "active" : ""} onClick={() => setMode("council")}>Council</button><span>{mode === "council" ? "独立提案 → 匿名评审 → 冲突保留 → 综合" : "一次任务分派到所选页面"}</span></div>
        <div className="provider-picker">
          <div className="picker-label"><span>调用页面</span><b>{selectedProviders.length} / {MAX_ACTIVE_PROVIDERS}</b></div>
          <div className="provider-options">{snapshot.providers.map((provider) => <div className={`provider-choice ${provider.windowOpen ? "selected" : ""}`} key={provider.id}>
            <button type="button" className="provider-toggle" onClick={() => void toggleProvider(provider.id)}><i style={{ background: provider.accent }} />{provider.name}</button>
            {provider.isCustom && <button type="button" className="provider-remove" aria-label={`移除 ${provider.name}`} onClick={() => void removeCustomProvider(provider.id)}>×</button>}
          </div>)}</div>
          <button type="button" className="add-provider" onClick={() => setCustomOpen((value) => !value)}>＋ 自定义</button>
        </div>
        <div className="account-module"><b>账户会话</b>{openProviders.map((provider) => { const account = snapshot.accounts.find((item) => item.providerId === provider.id); return <span key={provider.id}><i className={`account-${(account?.mode ?? "UNKNOWN").toLowerCase()}`} />{provider.name}: {account?.mode ?? "UNKNOWN"}</span>; })}</div>
        {customOpen && <form className="custom-provider-form" onSubmit={addCustomProvider}>
          <input value={customName} maxLength={50} onChange={(event) => setCustomName(event.target.value)} placeholder="AI 名称" autoFocus />
          <input value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} placeholder="https://example.com/chat" type="url" />
          <button type="submit" disabled={!customName.trim() || !customUrl.trim()}>添加</button>
          <button type="button" onClick={() => setCustomOpen(false)}>取消</button>
        </form>}
        <form className="prompt-composer" onSubmit={submit}>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="向多个网页 AI 发起任务…" rows={3} />
          <div className="composer-footer"><span>一次提交到全部已打开 AI；仅 3 或 5 个全员成功后允许下一步</span><button type="submit" title={`提交到全部 ${selectedProviders.length} 个 AI`} disabled={!prompt.trim() || sending || !isDispatchGroupSize(selectedProviders.length)}>{sending ? "…" : "↑"}</button></div>
        </form>
        {error && <div className="inline-error">{error}</div>}
      </div>
    </section>

    <section className="browser-half">
      <header className="browser-header"><div><strong>网页处理器</strong><span>{openProviders.length} / {MAX_ACTIVE_PROVIDERS} 页面运行中</span></div><div className="window-dots"><i /><i /><i /></div></header>
      {openProviders.length === 0 ? <div className="browser-empty">
        <div className="snap-illustration"><span /><span /><span /></div>
        <h2>等待打开网页页面</h2><p>在主控页选中 AI 时会直接打开；取消选中或点击页面标题栏 × 会立即关闭。</p>
      </div> : <div className={`provider-grid count-${openProviders.length}`}>
        {openProviders.map((provider) => <article className="provider-pane" key={provider.id}>
          <div className="pane-title"><div><i style={{ background: provider.accent }} /><strong>{provider.name}</strong><span>独立会话</span></div><button onClick={() => void window.boss.closeProvider(provider.id)}>×</button></div>
          <div className="web-surface" ref={(element) => { surfaceRefs.current[provider.id] = element; }}><span>正在载入 {provider.name}…</span></div>
        </article>)}
      </div>}
    </section>
  </div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
