import { readJson, writeJson } from "../commander/durable-json";
import { HARDENING_SCENARIOS, summarizeHardening, type HardeningReport, type HardeningResult } from "../../src/shared/hardening-matrix";

/**
 * Full-system hardening runner (plan AP30). Runs the deterministic subset of
 * the §30 matrix in-process using the real modules (each check is a concrete
 * fail-closed behavior probe), and records live-only rows as NOT_RUN with the
 * documented reason. Output is a durable evidence report the same shape as the
 * other acceptance evidence files.
 */

export interface HardeningProbe {
  id: string;
  run: () => Promise<boolean>;
}

export type HardeningProbeMap = Record<string, () => Promise<boolean> | boolean>;

export async function runHardeningMatrix(probes: HardeningProbeMap = {}, reportFile?: string): Promise<HardeningReport> {
  const results: Record<string, HardeningResult> = {};
  for (const scenario of HARDENING_SCENARIOS) {
    if (scenario.coverage === "live") { results[scenario.id] = "NOT_RUN"; continue; }
    const probe = probes[scenario.id];
    if (!probe) { results[scenario.id] = "NOT_RUN"; continue; }
    try { results[scenario.id] = (await probe()) ? "PASS" : "FAIL"; }
    catch { results[scenario.id] = "FAIL"; }
  }
  const report = summarizeHardening({ results });
  if (reportFile) writeJson(reportFile, report);
  return report;
}

export function loadHardeningReport(file: string): HardeningReport {
  const value = readJson<HardeningReport>(file);
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.rows)) throw new Error("Invalid hardening report");
  return value;
}
