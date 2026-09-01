import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppSnapshot, ProviderId, TaskStatus } from "../shared/contracts";
import { emptySnapshot, shortTime, taskCounts } from "./state";
import "./styles.css";

const statusLabels: Record<TaskStatus, string> = {
  queued: "待运行", running: "运行中", waiting: "等待确认", completed: "已完成", failed: "失败"
};

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  const [selectedId, setSelectedId] = useState<string>();
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState<ProviderId>("chatgpt");
  const [error, setError] = useState("");

  useEffect(() => {
    void window.boss.snapshot().then(setSnapshot).catch((reason) => setError(String(reason)));
    return window.boss.onSnapshot(setSnapshot);
  }, []);
  useEffect(() => {
    if (!selectedId && snapshot.tasks[0]) setSelectedId(snapshot.tasks[0].id);
  }, [snapshot.tasks, selectedId]);

  const selected = snapshot.tasks.find((task) => task.id === selectedId);
  const counts = useMemo(() => taskCounts(snapshot.tasks), [snapshot.tasks]);

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    try {
      const next = await window.boss.createTask({ title, prompt, providerId });
      setSnapshot(next); setSelectedId(next.tasks[0]?.id); setTitle(""); setPrompt(""); setComposerOpen(false);
    } catch (reason) { setError(String(reason)); }
  }
  async function act(action: () => Promise<AppSnapshot>) {
    setError("");
    try { setSnapshot(await action()); } catch (reason) { setError(String(reason)); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">B</span><div><strong>Codex Boss</strong><small>LOCAL CONTROL PLANE</small></div></div>
      <button className="new-task" onClick={() => setComposerOpen(true)}>＋ 新建任务</button>
      <nav><button className="nav-active"><span>⌁</span>任务工作台<em>{snapshot.tasks.length}</em></button><button><span>◫</span>证据仓库</button><button><span>⌘</span>运行记录</button></nav>
      <div className="sidebar-label">网页处理器</div>
      <div className="provider-list">{snapshot.providers.map((item) => <button key={item.id} onClick={() => void act(() => window.boss.openProvider(item.id))}>
        <i style={{ background: item.accent }} /><span>{item.name}<small>{item.windowOpen ? "窗口已打开" : "点击显式打开"}</small></span><b className={item.windowOpen ? "online" : ""} />
      </button>)}</div>
      <div className="local-note"><span>●</span><div><strong>本地优先</strong><small>登录与任务数据留在本机</small></div></div>
    </aside>

    <main>
      <header><div><small>工作区 /</small><h1>任务工作台</h1></div><div className="header-status"><span>控制平面在线</span><button onClick={() => setComposerOpen(true)}>新建任务</button></div></header>
      <section className="metrics">
        <article><span>排队任务</span><strong>{counts.queued}</strong><small>等待分派至网页窗口</small></article>
        <article><span>正在运行</span><strong>{counts.running}</strong><small>{snapshot.providers.filter((p) => p.windowOpen).length} 个处理器窗口在线</small></article>
        <article><span>需要确认</span><strong>{counts.waiting}</strong><small>始终由用户保留最终控制</small></article>
      </section>
      <section className="workspace">
        <div className="task-column">
          <div className="section-heading"><div><h2>任务</h2><p>每项工作都保留状态和审计事件</p></div><span>{snapshot.tasks.length} TOTAL</span></div>
          <div className="task-list">
            {snapshot.tasks.length === 0 && <div className="empty"><b>还没有任务</b><span>创建第一项任务，然后在一个可见的网页子窗口中运行。</span><button onClick={() => setComposerOpen(true)}>创建任务</button></div>}
            {snapshot.tasks.map((task) => { const provider = snapshot.providers.find((p) => p.id === task.providerId); return <button className={`task-card ${selectedId === task.id ? "selected" : ""}`} key={task.id} onClick={() => setSelectedId(task.id)}>
              <i style={{ background: provider?.accent }} /><div><strong>{task.title}</strong><span>{provider?.name} · {shortTime(task.updatedAt)}</span></div><em className={`status ${task.status}`}>{statusLabels[task.status]}</em>
            </button>; })}
          </div>
        </div>
        <aside className="inspector">{selected ? <>
          <div className="eyebrow">TASK DETAIL</div><h2>{selected.title}</h2><div className={`big-status ${selected.status}`}>{statusLabels[selected.status]}</div>
          <label>任务指令</label><div className="prompt-box">{selected.prompt}</div>
          <label>目标处理器</label><div className="processor-row"><i style={{ background: snapshot.providers.find((p) => p.id === selected.providerId)?.accent }} /><strong>{snapshot.providers.find((p) => p.id === selected.providerId)?.name}</strong><span>独立会话分区</span></div>
          <button className="launch" onClick={() => void act(() => window.boss.launchTask(selected.id))}>↗ 打开窗口并运行</button>
          <div className="action-row"><button onClick={() => void act(() => window.boss.updateTask(selected.id, "waiting"))}>等待确认</button><button onClick={() => void act(() => window.boss.updateTask(selected.id, "completed"))}>标记完成</button></div>
          <label>最近事件</label><div className="timeline">{snapshot.events.filter((event) => !event.taskId || event.taskId === selected.id).slice(0, 5).map((event) => <div key={event.id}><i /><span>{event.message}<small>{shortTime(event.at)}</small></span></div>)}</div>
        </> : <div className="empty-inspector">选择一项任务查看详情</div>}</aside>
      </section>
    </main>

    {composerOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setComposerOpen(false); }}><form className="composer" onSubmit={createTask}>
      <div className="composer-head"><div><small>NEW TASK</small><h2>把工作交给一个可见窗口</h2></div><button type="button" onClick={() => setComposerOpen(false)}>×</button></div>
      <label>任务名称<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：独立评审技术方案" required /></label>
      <label>完整任务指令<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="写下目标、约束和期望输出。窗口打开后，第一阶段由你确认页面与登录状态。" required /></label>
      <label>网页处理器<select value={providerId} onChange={(event) => setProviderId(event.target.value as ProviderId)}>{snapshot.providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="composer-actions"><button type="button" onClick={() => setComposerOpen(false)}>取消</button><button type="submit">创建任务</button></div>
    </form></div>}
    {error && <div className="toast" onClick={() => setError("")}>{error}</div>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
