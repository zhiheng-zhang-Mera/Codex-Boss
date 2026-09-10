import React, { useEffect, useState } from "react";
import type { ProviderIntelligencePanel } from "../../shared/provider-intelligence";

/**
 * Engine §18/§11 — Provider intelligence panel.
 *
 * Owner-facing projection of the learning layer: observed model identity with
 * explicit provenance (observed / declared / inferred / unknown), behaviour
 * metrics, behaviour epochs, routing explanations and learning controls.
 *
 * The panel is deliberately read-only and failure-isolated: any IPC error hides
 * the panel, it never affects background work. Numbers are rendered only when
 * they were actually observed (confidence/samples are always shown alongside).
 */
export function ProviderIntelligence({ onClose }: { onClose?: () => void }) {
  const [panel, setPanel] = useState<ProviderIntelligencePanel | null>(null);
  const [error, setError] = useState("");
  const [drill, setDrill] = useState<{ episodeId: string; lines: string[] } | null>(null);

  const refresh = () => {
    void window.boss
      .providerIntelligence()
      .then((value) => {
        setPanel(value);
        setError("");
      })
      .catch(() => setError("provider intelligence unavailable"));
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const control = (action: "rebuild" | "reset" | "set-adaptive-routing" | "set-learning", enabled?: boolean) => {
    void window.boss
      .learningControl(action, enabled)
      .then(() => refresh())
      .catch(() => setError("learning control failed"));
  };

  const drilldown = (episodeId: string) => {
    void window.boss
      .learningEpisode(episodeId)
      .then((value) => {
        if (!value) {
          setDrill({ episodeId, lines: ["episode not found"] });
          return;
        }
        setDrill({
          episodeId,
          lines: [
            `runtime ${value.runtimeId} · role ${value.role} · ${value.runtimeStatus}${value.runtimeFailureCode ? ` (${value.runtimeFailureCode})` : ""}`,
            `outcome ${value.semanticOutcome ?? "unclassified"} · evaluator ${value.evaluatorVersion ?? "n/a"} · feeds profile: ${value.contributesToProfile ? "yes" : "no"}`,
            `model ${value.modelSnapshotId ?? "unknown"} · epoch ${value.behaviourEpochId ?? "none"}`,
            `artifacts ${value.artifactRefs.join(", ") || "none"} · evidence ${value.evidenceRefs.join(", ") || "none"}`
          ]
        });
      })
      .catch(() => setDrill({ episodeId, lines: ["drill-down unavailable"] }));
  };

  if (!panel) return error ? <div className="provider-intel error">{error}</div> : null;
  const degraded = panel.controls.degraded.filter(Boolean);

  return (
    <div className="provider-intel">
      <header>
        <strong>Provider intelligence</strong>
        <span className="provider-intel-controls">
          <label>
            <input type="checkbox" checked={panel.controls.learningEnabled} onChange={(event) => control("set-learning", event.target.checked)} /> learning
          </label>
          <label>
            <input type="checkbox" checked={panel.controls.adaptiveRoutingEnabled} onChange={(event) => control("set-adaptive-routing", event.target.checked)} /> adaptive routing
          </label>
          <button type="button" onClick={() => control("rebuild")}>rebuild profiles</button>
          <button type="button" onClick={() => control("reset")}>reset derived</button>
          {onClose && <button type="button" onClick={onClose}>close</button>}
        </span>
      </header>

      {error && <div className="provider-intel-degraded">{error}</div>}
      {degraded.length > 0 && <div className="provider-intel-degraded">degraded: {degraded.join("; ")}</div>}
      {panel.controls.profileStale && <div className="provider-intel-degraded">derived profiles are stale — rebuild recommended</div>}

      <table>
        <thead>
          <tr>
            <th>provider</th>
            <th>observed model</th>
            <th>epoch</th>
            <th>samples</th>
            <th>completion</th>
            <th>restriction</th>
            <th>signals</th>
          </tr>
        </thead>
        <tbody>
          {panel.providers.map((row) => (
            <tr key={`${row.runtimeId}-${row.behaviourEpochId ?? "none"}`}>
              <td title={row.runtimeId}>{row.provider ?? row.runtimeId}</td>
              <td>
                {row.observedModelId ?? "unknown"}
                <small>
                  {row.observedModelProvenance.toLowerCase()}
                  {typeof row.observedModelConfidence === "number" ? ` · conf ${row.observedModelConfidence.toFixed(2)}` : ""}
                </small>
              </td>
              <td>{row.behaviourEpochId ?? "—"}</td>
              <td>{row.sampleCount}</td>
              <td>{renderMetric(row.metrics.completion)}</td>
              <td>{renderMetric(row.metrics.restrictionImpact)}</td>
              <td>{row.strongSignals.length ? row.strongSignals.join("; ") : "—"}</td>
            </tr>
          ))}
          {panel.providers.length === 0 && (
            <tr>
              <td colSpan={7}>no learned provider data yet (learning is off or no episodes recorded)</td>
            </tr>
          )}
        </tbody>
      </table>

      {panel.epochs.length > 0 && (
        <section>
          <strong>Behaviour epochs</strong>
          <ul>
            {panel.epochs.map((epoch) => (
              <li key={epoch.epochId}>
                {epoch.epochId} · {epoch.trigger.toLowerCase().replace(/_/g, " ")} · {epoch.open ? "open" : `closed ${epoch.endedAt}`}
                {epoch.observedModelId ? ` · ${epoch.observedModelId}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {panel.routing.length > 0 && (
        <section>
          <strong>Routing explanations</strong>
          <ul>
            {panel.routing.slice(-3).map((decision) => (
              <li key={decision.decisionId}>
                {decision.taskId}: selected {decision.selectedRuntimeId ?? "none"}
                {decision.usedFallbackRouter ? " (deterministic fallback)" : ""}
                {decision.exploration?.enabled ? " (exploration)" : ""}
                <ul>
                  {decision.candidates.map((candidate) => (
                    <li key={candidate.runtimeId}>
                      <span className="provider-intel-candidate">{candidate.runtimeId}</span> utility {candidate.expectedUtility ?? "n/a"} · {candidate.explanation[0] ?? ""}
                    </li>
                  ))}
                </ul>
                {decision.episodeIds.length > 0 && (
                  <span className="provider-intel-episodes">
                    episodes:{" "}
                    {decision.episodeIds.map((episodeId) => (
                      <button key={episodeId} type="button" onClick={() => drilldown(episodeId)}>
                        {episodeId}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {drill && (
        <section className="provider-intel-drill">
          <strong>episode {drill.episodeId}</strong>
          <ul>
            {drill.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function renderMetric(metric?: { mean: number; confidence: number; samples: number }): string {
  if (!metric || metric.samples === 0) return "—";
  return `${metric.mean.toFixed(2)} (n=${metric.samples}, conf ${metric.confidence.toFixed(2)})`;
}
