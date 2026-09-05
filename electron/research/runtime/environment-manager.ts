import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { executableAllowed, validateCommandSpec, type ResearchCommandSpec } from "../../../src/shared/research-command";

/**
 * Research environment + artifact capture (plan 9-6 Phase 6). Before a command
 * runs: validate the structured spec, reject shell metacharacters and
 * non-allow-listed executables. After it runs: capture the output artifact
 * (bounded, hashed) into the run's research directory for evidence.
 */

export function prepareResearchCommand(spec: ResearchCommandSpec): ResearchCommandSpec {
  validateCommandSpec(spec);
  if (!executableAllowed(spec.executable)) throw new Error(`Executable not allowed for research: ${spec.executable}`);
  return spec;
}

export interface CapturedArtifact {
  file: string;
  sha256: string;
  bytes: number;
}

export function captureResearchArtifact(directory: string, name: string, content: string): CapturedArtifact {
  fs.mkdirSync(directory, { recursive: true });
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "output";
  const file = path.join(directory, safe);
  fs.writeFileSync(file, content, "utf8");
  const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
  return { file, sha256, bytes: content.length };
}

export function hashCommandSpec(spec: ResearchCommandSpec): string {
  const canonical = JSON.stringify({ executable: spec.executable, args: spec.args, cwd: spec.cwd, purpose: spec.purpose, environment: spec.environment });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}