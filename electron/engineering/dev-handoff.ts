import fs from "node:fs";
import path from "node:path";
import { buildAutoHandoff, validateAutoHandoffInput, type AutoHandoffInput } from "../../src/shared/auto-handoff";
import { writeJson } from "../commander/durable-json";

/**
 * Development-plane auto handoff persistence (plan AP04 / §18 step 9). Writes
 * the compact checkpoint handoff markdown beside a durable metadata JSON so a
 * fresh Harness session can resume from `docs/<pack>-<date>.md` without
 * re-reading the repo. Fail-closed: invalid input never writes.
 */

export interface HandoffPersistResult {
  markdownFile: string;
  metaFile: string;
}

export function persistAutoHandoff(directory: string, input: AutoHandoffInput): HandoffPersistResult {
  validateAutoHandoffInput(input);
  fs.mkdirSync(directory, { recursive: true });
  const safeId = input.packId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const stamp = new Date().toISOString().slice(0, 10);
  const document = buildAutoHandoff(input);
  const markdownFile = path.join(directory, `${safeId}-${stamp}.md`);
  fs.writeFileSync(markdownFile, document.markdown, "utf8");
  const metaFile = path.join(directory, `${safeId}-${stamp}.json`);
  writeJson(metaFile, { schemaVersion: 1, packId: input.packId, title: input.title, createdAt: new Date().toISOString(), filesChanged: input.filesChanged });
  return { markdownFile, metaFile };
}
