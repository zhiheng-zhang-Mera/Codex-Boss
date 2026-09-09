import type { OwnerDashboardSummary } from "../../shared/owner-dashboard";
import React, { useEffect, useState } from "react";

/**
 * Rev.2 §37 Owner summary strip. Shows ONLY GOAL/STATUS/PROGRESS/RESULT/
 * EVIDENCE/HARD_BLOCKER per task (collapsed by default). Internal decisions
 * never pop up here — they are counted and auditable through the §38 ledger.
 */
export function OwnerSummary() {
  const [dashboard, setDashboard] = useState<OwnerDashboardSummary | null>(null);
  const [runtime, setRuntime] = useState<{ node: string; modules: number; waiting: number; recovery: number; blocked: number } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = () => {
      void window.boss.ownerDashboard().then(setDashboard).catch(() => {});
      // R-903: module/provider/node/task status line (degraded modules, waiting
      // tasks, recovery activity, blocked deps) — never lets UI errors break the strip.
      void Promise.all([window.boss.nodeStatus().catch(() => undefined), window.boss.snapshot().catch(() => undefined)]).then(([node, snap]) => {
        if (!snap) return;
        const runtimeStatuses = snap.runtimeStatuses ?? [];
        const degraded = runtimeStatuses.filter((item) => item.enabled === false || ["DOWN", "RATE_LIMITED", "BUDGET_EXHAUSTED", "AUTH_REQUIRED"].includes((item as { availability?: string }).availability ?? "")).length;
        const tasks = snap.tasks ?? [];
        setRuntime({
          node: node?.state ?? "unknown",
          modules: degraded,
          waiting: tasks.filter((task) => task.status === "waiting").length,
          recovery: tasks.filter((task) => (task.recoveryAt ?? 0) > 0).length,
          blocked: dashboard?.counts?.hardBlockers ?? 0
        });
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, []);

  if (!dashboard) return null;
  const { counts } = dashboard;
  const blockers = dashboard.tasks.filter((card) => card.hardBlocker !== "NONE");
  const headline = `Owner · ${counts.total} 任务（进行 ${counts.active} · 完成 ${counts.completed} · 失败 ${counts.failed}）· 硬阻塞 ${counts.hardBlockers} · 内部自动决策 ${counts.internalAutoDecisions}`;
  const visible = dashboard.tasks.slice(0, open ? 8 : 3);
  const statusLine = runtime
    ? `模块降级/禁用 ${runtime.modules} · 等待 ${runtime.waiting} · 恢复 ${runtime.recovery} · 阻塞依赖 ${runtime.blocked} · Node ${runtime.node}`
    : "…";

  return (
    <details className="owner-summary" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary title="Owner-Result 总览（§37）">{headline}{blockers.length > 0 ? ` ⚠ ${blockers[0].hardBlocker}` : ""}</summary>
      <div className="owner-summary-body">
        <small className="owner-statusline">{statusLine}</small>
        {visible.length === 0 && <small>暂无任务</small>}
        {visible.map((card) => (
          <div key={card.taskId} className={`owner-card owner-${card.hardBlocker === "NONE" ? "ok" : "blocker"}`}>
            <span className="owner-status">{card.status} · {card.runMode}</span>
            <b title={card.goal}>{card.goal.slice(0, 80)}</b>
            <small>{card.progressLabel}</small>
            {card.hardBlocker !== "NONE" && <small className="owner-blocker">{card.hardBlocker}{card.blockerDetail ? `：${card.blockerDetail.slice(0, 140)}` : ""}</small>}
            {card.evidence && <small>EVIDENCE {card.evidence.decision} · {card.evidence.artifacts} artifacts{card.evidence.heldClaims > 0 ? ` · ${card.evidence.heldClaims} held` : ""}</small>}
            {card.result && <small>RESULT {card.result.source} @ {card.result.finalizedAt.slice(0, 19).replace("T", " ")}</small>}
          </div>
        ))}
        {!open && dashboard.tasks.length > 3 && <small className="owner-more">展开查看其余 {dashboard.tasks.length - 3} 项…</small>}
      </div>
    </details>
  );
}
