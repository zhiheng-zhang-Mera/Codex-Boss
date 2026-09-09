import type { OwnerDashboardSummary } from "../../shared/owner-dashboard";
import React, { useEffect, useState } from "react";

/**
 * Rev.2 §37 Owner summary strip. Shows ONLY GOAL/STATUS/PROGRESS/RESULT/
 * EVIDENCE/HARD_BLOCKER per task (collapsed by default). Internal decisions
 * never pop up here — they are counted and auditable through the §38 ledger.
 */
export function OwnerSummary() {
  const [dashboard, setDashboard] = useState<OwnerDashboardSummary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = () => {
      void window.boss.ownerDashboard().then(setDashboard).catch(() => {});
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

  return (
    <details className="owner-summary" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary title="Owner-Result 总览（§37）">{headline}{blockers.length > 0 ? ` ⚠ ${blockers[0].hardBlocker}` : ""}</summary>
      <div className="owner-summary-body">
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
