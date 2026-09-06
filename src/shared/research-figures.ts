/**
 * Deterministic figure generation (plan 9-6 Phase 11 / Final Acceptance J).
 * Pure and shareable.
 *
 * `figures/` must contain real, reproducible artifacts. This module renders a
 * simple, deterministic SVG bar chart from recorded run metrics — no LLM, no
 * randomness, same input → same bytes — so a figure for a paper is traceable
 * to the exact recorded runs it plots. Charts keep labels bounded and escape
 * user-controlled text to stay valid SVG.
 */

export interface FigureBar {
  label: string;
  value: number;
}

export interface FigureOptions {
  title?: string;
  width?: number;
  height?: number;
  yLabel?: string;
}

export function metricFigureSvg(bars: FigureBar[], options: FigureOptions = {}): string {
  const width = options.width ?? 480;
  const height = options.height ?? 260;
  const title = (options.title ?? "Metric").slice(0, 80);
  const yLabel = (options.yLabel ?? "").slice(0, 40);
  const margin = { top: 34, right: 16, bottom: 40, left: 64 };
  const plotW = Math.max(80, width - margin.left - margin.right);
  const plotH = Math.max(60, height - margin.top - margin.bottom);
  const values = bars.map((bar) => Number.isFinite(bar.value) ? bar.value : 0);
  const max = Math.max(1, ...values);
  const visible = bars.slice(0, 40); // bounded rows
  const slot = plotW / Math.max(1, visible.length);
  const barWidth = Math.max(1, Math.min(48, slot * 0.6));
  const esc = (text: string) => text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[char] as string);

  const rows = visible.map((bar, index) => {
    const barHeight = Math.max(1, (bar.value / max) * plotH);
    const x = margin.left + index * slot + (slot - barWidth) / 2;
    const y = margin.top + plotH - barHeight;
    const label = esc((bar.label ?? "").slice(0, 24));
    const value = Number.isFinite(bar.value) ? bar.value.toFixed(3) : "n/a";
    return [
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="#3d7ea6"/>`,
      `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(margin.top + plotH + 14).toFixed(1)}" font-size="9" text-anchor="middle" fill="#cfd8d0">${label}</text>`,
      `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="9" text-anchor="middle" fill="#e6e2c8">${value}</text>`
    ].join("\n");
  }).join("\n");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#141a12"/>`,
    `<text x="${margin.left}" y="20" font-size="13" fill="#e6e2c8">${esc(title)}</text>`,
    `<text x="14" y="${(height / 2).toFixed(0)}" font-size="9" fill="#9fb3a2" transform="rotate(-90 14 ${(height / 2).toFixed(0)})" text-anchor="middle">${esc(yLabel)}</text>`,
    rows,
    "</svg>",
    ""
  ].join("\n");
}

/** Deterministic SVG figure for a paper figure id (real recorded metrics only). */
export function figureForRuns(title: string, values: Array<{ label: string; value: number }>): { name: string; svg: string } {
  return { name: "runs.svg", svg: metricFigureSvg(values, { title }) };
}
