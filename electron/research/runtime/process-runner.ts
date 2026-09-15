import { superviseProcess } from "../../process/process-gateway";
import type { ResearchCommandSpec } from "../../../src/shared/research-command";

/**
 * Structured research process runner (plan 9-6 Phase 6). Always structured argv with
 * explicit cwd/timeout — never `shell:true` with a model-generated string. The
 * process itself is started by `electron/process/process-gateway.ts` (Phase M): this
 * module states the bounds, maps the outcome to the research contract, and verifies
 * the expected markers, which is research policy rather than process policy.
 */

export interface ProcessResult {
  code: number;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
  passed: boolean;
  durationMs: number;
}

const MAX_STDOUT = 2000000;
const MAX_STDERR = 1000000;

/** The two streams as one transcript, which is what the research contract reports. */
const transcript = (stdout: string, stderr: string): string => `${stdout}\n${stderr}`.trim();

export async function runStructuredProcess(spec: ResearchCommandSpec, signal?: AbortSignal): Promise<ProcessResult> {
  if (signal?.aborted) return { code: -1, output: "cancelled before start", timedOut: false, cancelled: true, passed: false, durationMs: 0 };
  const outcome = await superviseProcess(spec.executable, spec.args, {
    timeoutMs: spec.timeoutMs,
    maxStdoutChars: MAX_STDOUT,
    maxStderrChars: MAX_STDERR,
    cwd: spec.cwd,
    env: { ...process.env, ...(spec.environment ?? {}) },
    ...(signal ? { signal } : {})
  });
  // A child that never ran is reported the way this module always reported it: the
  // reason in the output, code -1, nothing passed.
  if (outcome.spawnError) return { code: -1, output: outcome.spawnError, timedOut: false, cancelled: false, passed: false, durationMs: outcome.durationMs };
  if (outcome.cancelled) return { code: -1, output: "cancelled", timedOut: false, cancelled: true, passed: false, durationMs: outcome.durationMs };
  const output = transcript(outcome.stdout, outcome.stderr);
  if (outcome.timedOut) return { code: -1, output: `${output}\n[timed out]`, timedOut: true, cancelled: false, passed: false, durationMs: outcome.durationMs };
  const code = outcome.code ?? -1;
  const passed = code === 0 && (spec.expectedOutputs?.every((marker) => output.includes(marker)) ?? true);
  return { code, output, timedOut: false, cancelled: false, passed, durationMs: outcome.durationMs };
}
