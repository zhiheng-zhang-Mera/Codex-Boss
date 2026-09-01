import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppSnapshot, ProviderId, ViewBounds } from "../shared/contracts";
import { emptySnapshot, shortTime } from "./state";
import "./styles.css";

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  const [selectedProviders, setSelectedProviders] = useState<ProviderId[]>(["chatgpt"]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const surfaceRefs = useRef<Partial<Record<ProviderId, HTMLDivElement | null>>>({});
  const openProviders = snapshot.providers.filter((provider) => provider.windowOpen);
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

  function toggleProvider(providerId: ProviderId) {
    setSelectedProviders((current) => current.includes(providerId)
      ? current.length === 1 ? current : current.filter((id) => id !== providerId)
      : [...current, providerId]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const title = prompt.trim().split(/\r?\n/, 1)[0].slice(0, 48);
      const created = await window.boss.createTask({ title, prompt: prompt.trim(), providerIds: selectedProviders });
      setSnapshot(await window.boss.launchTask(created.tasks[0].id));
      setPrompt("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }

  async function openSelected() {
    setError("");
    try {
      let next = snapshot;
      for (const providerId of selectedProviders) next = await window.boss.openProvider(providerId);
      setSnapshot(next);
    } catch (reason) { setError(String(reason)); }
  }

  return <div className="desktop-shell">
    <section className="chat-half">
      <header className="chat-header">
        <div className="app-brand"><span>B</span><div><strong>Codex Boss</strong><small>LOCAL MULTI-AI WORKSPACE</small></div></div>
        <div className="workspace-pill"><i /> 本地工作区</div>
      </header>

      <div className="conversation">
        <div className="welcome-card">
          <div className="welcome-mark">⌘</div>
          <h1>今天要处理什么？</h1>
          <p>在左侧输入一次任务，右侧会按所选网页版 AI 数量自动分屏。每个页面保持独立登录状态，并始终可见。</p>
        </div>

        {activeTasks.map((task) => <article className="conversation-turn" key={task.id}>
          <div className="user-message"><span>你</span><p>{task.prompt}</p></div>
          <div className="boss-message">
            <div className="boss-avatar">B</div>
            <div><strong>已分派到 {task.providerIds.map((id) => snapshot.providers.find((item) => item.id === id)?.name ?? id).join("、")}</strong>
              <p>网页处理器已在右侧显式运行。当前状态：{task.status}。</p>
              <small>{shortTime(task.updatedAt)} · {task.providerIds.length} 个独立页面</small>
            </div>
          </div>
        </article>)}
      </div>

      <div className="composer-zone">
        <div className="provider-picker">
          <span>调用页面</span>
          {snapshot.providers.map((provider) => <button type="button" key={provider.id} className={selectedProviders.includes(provider.id) ? "selected" : ""} onClick={() => toggleProvider(provider.id)}>
            <i style={{ background: provider.accent }} />{provider.name}
          </button>)}
          <button type="button" className="open-only" onClick={() => void openSelected()}>仅打开页面</button>
        </div>
        <form className="prompt-composer" onSubmit={submit}>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="向多个网页 AI 发起任务…" rows={3} />
          <div className="composer-footer"><span>本阶段打开可见页面，任务内容不会自动提交给第三方</span><button type="submit" disabled={!prompt.trim() || sending}>{sending ? "…" : "↑"}</button></div>
        </form>
        {error && <div className="inline-error">{error}</div>}
      </div>
    </section>

    <section className="browser-half">
      <header className="browser-header"><div><strong>网页处理器</strong><span>{openProviders.length} / {snapshot.providers.length} 页面运行中</span></div><div className="window-dots"><i /><i /><i /></div></header>
      {openProviders.length === 0 ? <div className="browser-empty">
        <div className="snap-illustration"><span /><span /><span /></div>
        <h2>等待打开网页页面</h2><p>选择左侧一个或多个 AI，然后发送任务或点击“仅打开页面”。</p>
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
