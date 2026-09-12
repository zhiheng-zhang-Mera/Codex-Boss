#!/usr/bin/env node
/**
 * One-shot generator: turns the desktop black-box claims a real successful run
 * produced into the frozen, versioned contract at
 * `src/shared/desktop-black-box-contract.ts`. Not part of the acceptance chain.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const source = path.join(root, "artifacts", "acceptance", "desktop-workbook.json");
const target = path.join(root, "src", "shared", "desktop-black-box-contract.ts");
const report = JSON.parse(fs.readFileSync(source, "utf8"));
const requirements = report.requirementResults.map((entry, index) => ({
  id: `DB-${String(index + 1).padStart(3, "0")}`,
  title: entry.title
}));
const lines = [];
lines.push("/**");
lines.push(" * Update-Plan/checkpoint-2.md §6.1/§6.2 — the versioned desktop black-box contract.");
lines.push(" *");
lines.push(" * The real Electron smoke is the only evidence that the shipped product path works,");
lines.push(" * so its claims are no longer an anonymous array indexed at runtime: every claim has");
lines.push(" * a stable id, the contract has a version that must bump when a claim is added,");
lines.push(" * removed or reworded, and the root auditor requires the report to carry exactly this");
lines.push(" * claim set. §6.4: this contract deliberately does not include live third-party AI");
lines.push(" * providers — those stay Post-Prestart.");
lines.push(" *");
lines.push(" * Pure: no fs, no clock, no process.");
lines.push(" */");
lines.push('import { sha256Hex } from "./hash";');
lines.push("");
lines.push(`export const DESKTOP_BLACK_BOX_CONTRACT_VERSION = "desktop-blackbox-1" as const;`);
lines.push("");
lines.push("/** One black-box claim: a stable id and the exact title the harness asserts. */");
lines.push("export interface DesktopBlackBoxRequirement {");
lines.push("  id: string;");
lines.push("  title: string;");
lines.push("}");
lines.push("");
lines.push("/** The complete claim set the real-application smoke must establish. */");
lines.push("export const DESKTOP_BLACK_BOX_REQUIREMENTS: readonly DesktopBlackBoxRequirement[] = [");
for (const requirement of requirements) {
  lines.push(`  { id: ${JSON.stringify(requirement.id)}, title: ${JSON.stringify(requirement.title)} },`);
}
lines.push("];");
lines.push("");
lines.push("/** §6.1: the count comes from the contract, never from a hard-coded 89. */");
lines.push("export const DESKTOP_BLACK_BOX_REQUIRED_CLAIMS = DESKTOP_BLACK_BOX_REQUIREMENTS.length;");
lines.push("");
lines.push("/** The ids in contract order. */");
lines.push("export const DESKTOP_BLACK_BOX_REQUIRED_IDS: readonly string[] = DESKTOP_BLACK_BOX_REQUIREMENTS.map((requirement) => requirement.id);");
lines.push("");
lines.push("/** The id a claim title belongs to, or undefined when the title is not in the contract. */");
lines.push("export function desktopClaimId(title: string): string | undefined {");
lines.push("  return DESKTOP_BLACK_BOX_REQUIREMENTS.find((requirement) => requirement.title === title)?.id;");
lines.push("}");
lines.push("");
lines.push("/**");
lines.push(" * §2.7: the digest of the contract itself. A report that was produced under a");
lines.push(" * different claim set cannot claim this digest, so a silent contract change is");
lines.push(" * visible to the root auditor.");
lines.push(" */");
lines.push("export const DESKTOP_BLACK_BOX_CONTRACT_HASH = sha256Hex(JSON.stringify({");
lines.push("  version: DESKTOP_BLACK_BOX_CONTRACT_VERSION,");
lines.push("  requirements: DESKTOP_BLACK_BOX_REQUIREMENTS.map((requirement) => [requirement.id, requirement.title])");
lines.push("}));");
lines.push("");
fs.writeFileSync(target, lines.join("\n"), "utf8");
console.log(`wrote ${path.relative(root, target)} with ${requirements.length} claims`);
