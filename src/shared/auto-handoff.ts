/**
 * Development-plane Auto Handoff (plan AP04 / §18 protocol step 9). Pure and
 * shareable: after a plan/step closes, produce the compact checkpoint handoff
 * (why / what changed / verification / boundary notes / next) so a fresh
 * Harness session can resume without re-reading the repo or master plan.
 */

export interface HandoffEvidenceEntry {
  stepId: string;
  passed: boolean;
  output?: string;
}

export interface AutoHandoffInput {
  packId: string;
  title: string;
  why: string;
  filesChanged: string[];
  evidence: HandoffEvidenceEntry[];
  verification?: string;
  boundaryNotes?: string[];
  nextActions?: string[];
  author?: string;
}

export interface AutoHandoffDocument {
  packId: string;
  title: string;
  markdown: string;
}

export function buildAutoHandoff(input: AutoHandoffInput): AutoHandoffDocument {
  const lines: string[] = [];
  lines.push(`# ${input.packId} — ${input.title}`);
  lines.push("");
  lines.push(`Auto handoff for Acceptance Pack **${input.packId}**. ${input.author ? `Author: ${input.author}.` : ""}`);
  lines.push("");
  lines.push("## Why");
  lines.push("");
  lines.push(trim(input.why, 2000));
  lines.push("");
  lines.push("## What was added");
  lines.push("");
  const changed = input.filesChanged.filter(Boolean);
  if (changed.length) changed.forEach((file) => lines.push(`- \`${trim(file, 500)}\``));
  else lines.push("- (no files reported)");
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  const passed = input.evidence.filter((item) => item.passed).length;
  const total = input.evidence.length;
  lines.push(`Verification evidence: ${passed}/${total} passed.`);
  for (const item of input.evidence) {
    lines.push(`- ${item.stepId}: ${item.passed ? "PASS" : "FAIL"}${item.output ? ` — ${trim(item.output, 300)}` : ""}`);
  }
  if (input.verification) { lines.push(""); lines.push(`## Verification`); lines.push(""); lines.push(trim(input.verification, 1000)); }
  if (input.boundaryNotes?.length) { lines.push(""); lines.push("## Boundary notes"); lines.push(""); input.boundaryNotes.forEach((note) => lines.push(`- ${trim(note, 1000)}`)); }
  if (input.nextActions?.length) { lines.push(""); lines.push("## Next actions"); lines.push(""); input.nextActions.forEach((action) => lines.push(`- ${trim(action, 500)}`)); }
  lines.push("");
  return { packId: input.packId, title: input.title, markdown: lines.join("\n") };
}

export function validateAutoHandoffInput(input: AutoHandoffInput): void {
  if (!input || typeof input.packId !== "string" || !input.packId.trim() || input.packId.length > 80) throw new Error("Auto handoff requires a pack id");
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 200) throw new Error("Auto handoff requires a title");
  if (!Array.isArray(input.evidence) || input.evidence.length > 200) throw new Error("Auto handoff evidence must be a bounded array");
}

function trim(value: string, max: number): string {
  const single = value.replace(/\r\n/g, "\n").trim();
  return single.length > max ? single.slice(0, max) + "…" : single;
}
