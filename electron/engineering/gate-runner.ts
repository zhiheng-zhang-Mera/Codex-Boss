import fs from "node:fs";
import path from "node:path";
import { runAllowedCommand } from "./command-runner";

/**
 * R43 Phase A (R-101): real engineering gate execution (seam v2).
 *
 * The validator does not merely plan gates — it triggers and collects evidence
 * for typecheck / build / unit / integration / acceptance / runtime-smoke with
 * actual allow-listed commands over the workspace. Capability resolution is
 * explicit and honest:
 *   - typecheck/build  require a tsconfig + a local typescript binary;
 *   - unit/integration require discovered test files;
 *   - acceptance/runtime-smoke require acceptance-/smoke-marked test files.
 * Anything else is UNAVAILABLE (reported, never faked). A failing gate yields
 * FAIL evidence; a runner that throws yields ERROR — both make the verdict
 * REWORK (fail-closed) and never crash the supervisor (failure isolation §4.4).
 */

export type RepoGate = "typecheck" | "build" | "unit" | "integration" | "acceptance" | "runtime-smoke";

export interface GateRun {
  gate: RepoGate;
  status: "PASS" | "FAIL" | "ERROR" | "UNAVAILABLE";
  evidence?: string;
  error?: string;
}

const TEST_FILE = /\.(test|spec)\.(c?js|mjs|ts|jsx|tsx)$/i;
const TOKEN_TEST = /(^|[\\/_.-])(test|tests|spec|specs)([\\/_.-]|$)/i;
const TOKEN_ACCEPTANCE = /(^|[\\/_.-])(acceptance|accept|e2e|endtoend)([\\/_.-]|$)/i;
const TOKEN_SMOKE = /(^|[\\/_.-])smoke([\\/_.-]|$)/i;
const SKIP_DIR = /(^|[\\/])(node_modules|\.git|\.cache|\.codex-boss|dist|dist-electron|coverage|runtime-data|artifacts|live-acceptance|history|\.boss)([\\/]|$)/i;

function walk(root: string, out: string[], depth: number): void {
  if (depth > 7) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SKIP_DIR.test(entry.name)) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) walk(target, out, depth + 1);
    else if (TEST_FILE.test(entry.name)) out.push(target);
  }
}

export function discoveredTestFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, out, 0);
  return out.sort();
}

function filesMatching(root: string, token: RegExp): string[] {
  return discoveredTestFiles(root).filter((file) => token.test(file));
}

export function toolAvailable(root: string): boolean {
  return fs.existsSync(path.join(root, "tsconfig.json")) && fs.existsSync(path.join(root, "node_modules", "typescript", "bin", "tsc"));
}

export function gateCapability(root: string, gate: RepoGate): { available: boolean; reason?: string } {
  switch (gate) {
    case "typecheck":
    case "build":
      if (!fs.existsSync(path.join(root, "tsconfig.json"))) return { available: false, reason: "no tsconfig.json" };
      if (!fs.existsSync(path.join(root, "node_modules", "typescript", "bin", "tsc"))) return { available: false, reason: "no local typescript toolchain" };
      return { available: true };
    case "unit":
    case "integration":
      return discoveredTestFiles(root).length > 0 ? { available: true } : { available: false, reason: "no test files" };
    case "acceptance":
      return filesMatching(root, TOKEN_ACCEPTANCE).length > 0 ? { available: true } : { available: false, reason: "no acceptance/e2e tests" };
    case "runtime-smoke":
      return filesMatching(root, TOKEN_SMOKE).length > 0 ? { available: true } : { available: false, reason: "no smoke tests" };
  }
}

function toGateRun(gate: RepoGate, result: { passed: boolean; output: string }): GateRun {
  return { gate, status: result.passed ? "PASS" : "FAIL", evidence: result.output.slice(0, 1600) };
}

/**
 * Executes one gate over the workspace. Never throws for workspace-level
 * failures: command failures become FAIL, absence becomes UNAVAILABLE, and
 * unexpected runner errors become ERROR (caller records REWORK; Boss survives).
 */
export async function runRepoGate(root: string, gate: RepoGate, files: string[] = []): Promise<GateRun> {
  const capability = gateCapability(root, gate);
  if (!capability.available) return { gate, status: "UNAVAILABLE", error: capability.reason };
  try {
    switch (gate) {
      case "typecheck":
      case "build": {
        const result = await runAllowedCommand(root, gate === "build" ? "build" : "typecheck");
        return toGateRun(gate, result);
      }
      case "unit": {
        const targeted = files.length ? files : discoveredTestFiles(root);
        if (!targeted.length) return { gate, status: "UNAVAILABLE", error: "no test files" };
        const result = await runAllowedCommand(root, "test", targeted.length <= 50 ? targeted : []);
        return toGateRun(gate, result);
      }
      case "integration": {
        const all = discoveredTestFiles(root);
        if (!all.length) return { gate, status: "UNAVAILABLE", error: "no test files" };
        // Full regression sweep without file targeting (node --test discovery /
        // vitest project run) — the whole discovered suite is the integration gate.
        const result = await runAllowedCommand(root, "test", []);
        return toGateRun(gate, result);
      }
      case "acceptance": {
        const candidates = filesMatching(root, TOKEN_ACCEPTANCE);
        if (!candidates.length) return { gate, status: "UNAVAILABLE", error: "no acceptance tests" };
        const result = await runAllowedCommand(root, "test", candidates.length <= 50 ? candidates : []);
        return toGateRun(gate, result);
      }
      case "runtime-smoke": {
        const candidates = filesMatching(root, TOKEN_SMOKE);
        if (!candidates.length) return { gate, status: "UNAVAILABLE", error: "no smoke tests" };
        const result = await runAllowedCommand(root, "test", candidates.length <= 50 ? candidates : []);
        return toGateRun(gate, result);
      }
    }
  } catch (error) {
    return { gate, status: "ERROR", error: String(error instanceof Error ? error.message : error).slice(0, 800) };
  }
}
