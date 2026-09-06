/**
 * Structured software-adapter command builders (plan AP22/AP23). Pure and
 * shareable: every adapter execution is spawned as `executable [args]` with a
 * cwd — never `shell:true` with a model-generated string. Blender and Unreal
 * both accept a python script path; the builders return bounded argv arrays
 * with a deterministic capability → script mapping.
 */

export interface AdapterCommandSpec {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  expectedOutputs: string[];
}

export const BLENDER_SCRIPT_PREFIX = "# BOSS blender adapter";
export const UNREAL_SCRIPT_PREFIX = "# BOSS unreal adapter";

export function blenderScript(action: string, params: Record<string, unknown>): string {
  return `${BLENDER_SCRIPT_PREFIX}\nimport json, sys\n# capability=${action}\nparams = json.loads(${JSON.stringify(JSON.stringify(params))})\nprint("BOSS_BLENDER_OK", action, params.get("target", ""))`;
}

export function unrealScript(action: string, params: Record<string, unknown>): string {
  return `${UNREAL_SCRIPT_PREFIX}\nimport json\n# capability=${action}\nparams = json.loads(${JSON.stringify(JSON.stringify(params))})\nprint("BOSS_UNREAL_OK", action, params.get("target", ""))`;
}

/** Blender CLI (background, no GUI) with a project + python script. */
export function blenderCommand(input: { executable: string; project?: string; scriptFile: string; outputFile?: string; renderFrame?: number; cwd: string; timeoutMs?: number }): AdapterCommandSpec {
  const args = ["--background"];
  if (input.project) args.push(input.project);
  args.push("--python", input.scriptFile, "--", "--render-frame", String(input.renderFrame ?? 1));
  if (input.outputFile) args.push("--output", input.outputFile);
  return { executable: input.executable, args, cwd: input.cwd, timeoutMs: input.timeoutMs ?? 120000, expectedOutputs: ["BOSS_BLENDER_OK"] };
}

/** Unreal Editor Python mode: -run=pythonscript -script=<file>. */
export function unrealCommand(input: { executable: string; project?: string; scriptFile: string; outputFile?: string; cwd: string; timeoutMs?: number }): AdapterCommandSpec {
  const args: string[] = [];
  if (input.project) args.push(input.project);
  args.push("-run=pythonscript", `-script=${input.scriptFile}`);
  if (input.outputFile) args.push(`-output=${input.outputFile}`);
  return { executable: input.executable, args, cwd: input.cwd, timeoutMs: input.timeoutMs ?? 180000, expectedOutputs: ["BOSS_UNREAL_OK"] };
}

/** Resolves an executable against env override + PATH candidates (graceful absence). */
export function resolveExecutable(configured: string | undefined, candidates: string[], exists: (file: string) => boolean): string | undefined {
  if (configured && exists(configured)) return configured;
  return candidates.find((candidate) => exists(candidate));
}
