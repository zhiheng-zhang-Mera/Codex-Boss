import React from "react";
import type { ProgressSummary } from "../../shared/progress";

/** Collapsible detailed research/work progress timeline (Phase 3/5 UI). */
export function ResearchProgress({ summaries }: { summaries: ProgressSummary[] }) {
  if (!summaries.length) return null;
  return <section className="research-progress" aria-label="研究/任务实时进度">
    {summaries.map((summary) => (
      <div className={`research-progress-row progress-${summary.status.toLowerCase()}`} key={summary.taskId}>
        <i />
        <div><b>{summary.label}</b><small>{summary.taskId.slice(0, 8)} · {summary.stage}</small></div>
        {summary.detail && <p>{summary.detail.slice(0, 200)}</p>}
      </div>
    ))}
  </section>;
}
