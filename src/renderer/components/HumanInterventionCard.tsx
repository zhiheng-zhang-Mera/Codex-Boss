import React, { useState } from "react";
import type { HumanInterventionRequest, InterventionKind } from "../../shared/intervention";

/** Attention card shown when a research/work task pauses for a user decision (Phase 4). */
export function HumanInterventionCard({ request, onResolve }: { request: HumanInterventionRequest; onResolve: (kind: InterventionKind, answer: string) => Promise<void> }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const kindLabel: Record<InterventionKind, string> = {
    DIRECTION: "需要选择研究方向", AUTHORIZATION: "需要授权", LOGIN: "需要登录", CAPTCHA: "需要验证码",
    BUDGET: "需要预算决定", RESEARCH_SCOPE: "研究范围需要确认", EXTERNAL_ACTION: "外部动作需要确认"
  };
  return <section className="intervention-card" role="alert" aria-live="polite">
    <div className="intervention-head"><b>需要你决定 · {kindLabel[request.kind]}</b><span>{request.taskId.slice(0, 8)}</span></div>
    <p>{request.question}</p>
    <small>{request.contextSummary.slice(0, 240)}</small>
    {request.options && <div className="intervention-options">{request.options.map((option) => <button key={option} disabled={busy} onClick={() => void onResolve(request.kind, option).catch(() => {})}>{option}</button>)}</div>}
    <form onSubmit={(event) => { event.preventDefault(); if (!answer.trim() || busy) return; setBusy(true); void onResolve(request.kind, answer.trim()).catch(() => {}).finally(() => setBusy(false)); setAnswer(""); }}>
      <input aria-label="你的决定" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="输入决定…" disabled={busy} />
      <button type="submit" disabled={!answer.trim() || busy}>{busy ? "提交中…" : "提交决定"}</button>
    </form>
  </section>;
}
