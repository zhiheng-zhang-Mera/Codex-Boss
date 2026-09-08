import React, { useEffect, useRef, useState } from "react";
import type { EngineeringGoalRunResult } from "../../shared/contracts";
import type { EngineeringGoalSnapshot } from "../../shared/engineering-loop";

const SEVERITY: Record<string, string> = { CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low", OPTIONAL: "optional" };

/**
 * U10 (§26–§41): autonomous-engineering goal start surface. One launch form
 * (objective + workspace + convergence policy) and a live monitor over the
 * durable goal-status read-model. Without an injected coding editor the loop
 * honestly audits (typecheck + full tests) and reports; findings it cannot
 * implement abort with a clean rollback — never a fabricated fix.
 */
export function GoalRunPanel({ busy, onBusyChange, onError }: {
  busy: boolean;
  onBusyChange(next: boolean): void;
  onError(message: string): void;
}) {
  const [objective, setObjective] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [agentCount, setAgentCount] = useState<1 | 3 | 5>(1);
  const [maxIterations, setMaxIterations] = useState(1);
  const [cleanRoundsRequired, setCleanRoundsRequired] = useState(1);
  const [allowedScope, setAllowedScope] = useState("fix\nrefactor\nimprove reliability\nimprove tests");
  const [status, setStatus] = useState<EngineeringGoalSnapshot | null>(null);
  const [result, setResult] = useState<EngineeringGoalRunResult | null>(null);
  const [localError, setLocalError] = useState("");
  const runningRef = useRef(false);

  const refreshStatus = () => void window.boss.engineeringGoalStatus().then(setStatus).catch(() => {});
  useEffect(() => { refreshStatus(); }, []);

  // While a goal run is in flight, poll the durable status read-model so the
  // panel shows iteration/stage progress live (no snapshot field carries it).
  useEffect(() => {
    if (!runningRef.current) return;
    const timer = window.setInterval(() => { void window.boss.engineeringGoalStatus().then(setStatus).catch(() => {}); }, 2000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const replaceNeeded = Boolean(status?.goalId && (status.objective !== objective.trim() || status.workspace !== workspace.trim()));

  async function startRun(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setLocalError("");
    try {
      if (!objective.trim()) throw new Error("需要目标（objective）");
      if (!workspace.trim()) throw new Error("需要 workspace 目录");
      onBusyChange(true); runningRef.current = true; setResult(null);
      const goal = {
        objective: objective.trim(),
        workspace: workspace.trim(),
        protectedProductBehavior: ["不改变产品方向与核心业务逻辑"],
        allowedChangeScope: allowedScope.split("\n").map((line) => line.trim()).filter(Boolean),
        forbiddenChangeScope: [],
        verificationPolicy: "standard" as const,
        agentCount,
        convergencePolicy: { cleanRoundsRequired, maxIterations }
      };
      // A different objective/workspace than the frozen goal is an explicit
      // operator replace: the previous goal ledger is archived (never deleted).
      const outcome = await window.boss.engineeringGoalRun({ goal, workspace: workspace.trim(), maxIterations: maxIterations || undefined, replace: replaceNeeded || undefined });
      setResult(outcome as EngineeringGoalRunResult);
    } catch (reason) {
      onError(String(reason)); setLocalError(String(reason));
    } finally {
      runningRef.current = false; onBusyChange(false);
      void window.boss.engineeringGoalStatus().then(setStatus).catch(() => {});
    }
  }

  const findings = status?.openFindings ?? [];
  return <div className="goal-run-panel">
    <form className="goal-launcher" onSubmit={startRun}>
      <label>工程目标（objective）<textarea aria-label="工程目标" value={objective} maxLength={20000} onChange={(event) => setObjective(event.target.value)} rows={2} placeholder="例如：持续自迭代强化当前项目至 production-grade engineering readiness；不要修改产品方向。" /></label>
      <label>Workspace <input aria-label="工程仓库" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="本地仓库目录（如 D:/Git-Projects/Codex-Boss）" /></label>
      <label>Agent count <select aria-label="agent 数" value={agentCount} onChange={(event) => setAgentCount(Number(event.target.value) as 1 | 3 | 5)}><option value={1}>1 AI</option><option value={3}>3 AI</option><option value={5}>5 AI</option></select></label>
      <label>收敛轮数 <input aria-label="clean rounds" type="number" min={1} max={5} value={cleanRoundsRequired} onChange={(event) => setCleanRoundsRequired(Math.max(1, Math.min(5, Number(event.target.value) || 1)))} /></label>
      <label>最大迭代 <input aria-label="max iterations" type="number" min={1} max={10} value={maxIterations} onChange={(event) => setMaxIterations(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label>
      <label>允许改动范围（每行一项）<textarea aria-label="允许改动范围" value={allowedScope} onChange={(event) => setAllowedScope(event.target.value)} rows={3} /></label>
      <div className="goal-run-hint">{status?.goalId ? `当前冻结目标：${status.goalId.slice(0, 12)} · ${status.objective?.slice(0, 40)}…` : "尚未冻结目标"}；未配置 coding editor 时本面板只做真实审计（typecheck + 全量测试），有发现即 ABORT 并回滚，绝不伪造修复。</div>
      {replaceNeeded && !busy && <div className="goal-replace-note">将归档当前目标记录并替换为新目标（旧记录归档保留，不会删除）。</div>}
      <button type="submit" disabled={busy || !objective.trim() || !workspace.trim()} className={busy ? "goal-busy" : ""}>{busy ? "运行中…（审计真实命令，请保持应用运行）" : (status?.goalId ? "再次运行 / 替换并启动" : "启动自主工程目标")}</button>
    </form>

    {localError && <div className="inline-error goal-inline-error">{localError}</div>}

    {status && <div className="goal-status-card">
      <header><b>工程目标状态</b>
        <span className={`goal-settle goal-${status.settled ? "settled" : "running"}`}>{status.settled ? "已收敛/终止" : "进行中"}</span>
      </header>
      {status.goalId && <div className="goal-status-meta"><span>goal {status.goalId.slice(0, 12)}</span><span>iterations {status.iterations}</span><span>clean {status.cleanRounds}/{status.cleanRoundsRequired}</span><span>accepted risks {status.acceptedRiskCount}</span><span>files {status.changedFiles.length}</span></div>}
      {status.objective && <p className="goal-objective">{status.objective}</p>}
      {(status.lastStage || status.lastStatus) && <div className="goal-last"><span>最近迭代：{status.lastStage ?? "—"} / {status.lastStatus ?? "—"}</span>{status.lastRisk && <small>{status.lastRisk.slice(0, 160)}</small>}</div>}
      {status.changedFiles.length > 0 && <div className="goal-changed-files">改动文件：{status.changedFiles.slice(0, 20).map((file) => <code key={file}>{file}</code>)}{status.changedFiles.length > 20 ? `…(+${status.changedFiles.length - 20})` : ""}</div>}
      {findings.length > 0 && <div className="goal-findings"><b>未决发现（{findings.length}）</b>{findings.slice(0, 6).map((finding) => <div className={`goal-finding finding-${SEVERITY[finding.severity] ?? "low"}`} key={finding.id}><span>{finding.severity}</span><b>{finding.area} · {finding.id}</b><small>{finding.description}</small>{finding.evidence && <pre>{finding.evidence.slice(0, 300)}</pre>}</div>)}</div>}
    </div>}

    {result && <div className={`goal-result goal-result-${result.state === "ENGINEERING_CONVERGED" ? "converged" : result.state === "OPTIONAL_IMPROVEMENTS" ? "optional" : "aborted"}`}>
      <b>{result.state}</b>
      <span>{result.iterations} 轮 · {result.changedFiles.length} 个改动文件</span>
      {result.findings.length > 0 && <small>保留发现：{result.findings.map((finding) => `${finding.id}(${finding.severity})`).join("、")}</small>}
    </div>}
  </div>;
}
