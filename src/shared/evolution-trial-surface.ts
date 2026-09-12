/**
 * Update-Plan/self-evlo.md sec. 72 - the autonomous evolution trial surface.
 *
 * A small, pure, dependency-neutral module: it is the file the trial battery's
 * deterministic catalog changes, so every round produces a real reviewable diff
 * against a frozen baseline. It has no imports, so it stays valid under both the
 * renderer tsconfig and the electron tsconfig.
 */

export type SurfaceTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface SurfaceLabelRule {
  maxLength: number;
  ellipsis: string;
}

export interface SurfaceStateV1 {
  version: number;
  tone: SurfaceTone;
  labels: string[];
  counts: Record<string, number>;
}

export const SURFACE_VERSION = 1;

export const SURFACE_TONES: readonly SurfaceTone[] = ["neutral", "info", "success", "warning", "danger"];

export const DEFAULT_LABEL_RULE: SurfaceLabelRule = { maxLength: 32, ellipsis: "..." };

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function formatDuration(totalMs: number): string {
  const safe = Math.max(0, Math.round(totalMs));
  const seconds = Math.floor(safe / 1000);
  if (seconds < 60) return String(seconds) + "s";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return String(minutes) + "m " + String(rest) + "s";
  const hours = Math.floor(minutes / 60);
  return String(hours) + "h " + String(minutes % 60) + "m";
}

export function normalizeLabel(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function truncateLabel(text: string, rule: SurfaceLabelRule = DEFAULT_LABEL_RULE): string {
  if (text.length < rule.maxLength) return text;
  return text.slice(0, rule.maxLength - 1) + rule.ellipsis;
}

export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round(clamp01(done / total) * 100);
}

export function statusTone(status: string): SurfaceTone {
  if (status === "done" || status === "passed") return "success";
  if (status === "failed" || status === "error") return "danger";
  if (status === "running" || status === "verifying") return "info";
  if (status === "blocked" || status === "stalled") return "warning";
  return "neutral";
}

export function severityRank(severity: string): number {
  if (severity === "critical") return 3;
  if (severity === "high") return 2;
  if (severity === "medium") return 1;
  if (severity === "low") return 0;
  return -1;
}

export function uniquePreservingOrder(items: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

export function summarizeCounts(counts: Record<string, number>): string {
  const keys = Object.keys(counts).sort();
  if (keys.length === 0) return "no counts";
  return keys.map((key) => key + "=" + String(counts[key])).join(", ");
}

export function parseKeyValueLine(line: string): { key: string; value: string } {
  const index = line.indexOf("=");
  if (index < 0) throw new Error("malformed line: " + line);
  return { key: line.slice(0, index).trim(), value: line.slice(index + 1).trim() };
}

export function toCsvLine(fields: readonly (string | number)[]): string {
  return fields.map((field) => String(field)).join(",");
}

export function themeTokenFor(tone: SurfaceTone): string {
  if (tone === "success") return "--tone-success";
  if (tone === "danger") return "--tone-danger";
  if (tone === "warning") return "--tone-warning";
  if (tone === "info") return "--tone-info";
  return "--tone-neutral";
}

export function createSurfaceState(tone: SurfaceTone = "neutral"): SurfaceStateV1 {
  return { version: SURFACE_VERSION, tone, labels: [], counts: {} };
}

export function migrateSurfaceState(raw: unknown): SurfaceStateV1 {
  const value = (raw ?? {}) as Partial<SurfaceStateV1>;
  return {
    version: SURFACE_VERSION,
    tone: value.tone ?? "neutral",
    labels: Array.isArray(value.labels) ? value.labels.slice() : [],
    counts: value.counts && typeof value.counts === "object" ? { ...value.counts } : {}
  };
}
