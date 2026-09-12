/**
 * Update-Plan/checkpoint-2.md §6.1/§6.2 — the versioned desktop black-box contract.
 *
 * The real Electron smoke is the only evidence that the shipped product path works,
 * so its claims are no longer an anonymous array indexed at runtime: every claim has
 * a stable id, the contract has a version that must bump when a claim is added,
 * removed or reworded, and the root auditor requires the report to carry exactly this
 * claim set. §6.4: this contract deliberately does not include live third-party AI
 * providers — those stay Post-Prestart.
 *
 * Pure: no fs, no clock, no process.
 */
import { sha256Hex } from "./hash";

export const DESKTOP_BLACK_BOX_CONTRACT_VERSION = "desktop-blackbox-1" as const;

/** One black-box claim: a stable id and the exact title the harness asserts. */
export interface DesktopBlackBoxRequirement {
  id: string;
  title: string;
}

/** The complete claim set the real-application smoke must establish. */
export const DESKTOP_BLACK_BOX_REQUIREMENTS: readonly DesktopBlackBoxRequirement[] = [
  { id: "DB-001", title: "renderer step renderer_ready" },
  { id: "DB-002", title: "renderer step enter_work_mode" },
  { id: "DB-003", title: "renderer step select_workspace" },
  { id: "DB-004", title: "renderer step add_bounded_provider" },
  { id: "DB-005", title: "renderer step attach_workbook" },
  { id: "DB-006", title: "renderer step blank_prompt" },
  { id: "DB-007", title: "renderer step submit" },
  { id: "DB-008", title: "renderer step workbook_rendered" },
  { id: "DB-009", title: "Work mode was entered through the real nav button" },
  { id: "DB-010", title: "the dropped WorkBook appears as a real attachment chip" },
  { id: "DB-011", title: "exactly one provider is selected through the real composer form" },
  { id: "DB-012", title: "the WorkBook status panel is rendered" },
  { id: "DB-013", title: "the rendered classification is the executable WorkBook" },
  { id: "DB-014", title: "a durable task carries a WorkBook record" },
  { id: "DB-015", title: "classification is EXECUTABLE_WORKBOOK" },
  { id: "DB-016", title: "the WorkBook is auto-run eligible" },
  { id: "DB-017", title: "the ingested document is the dropped file" },
  { id: "DB-018", title: "the WorkBook hash is a content hash" },
  { id: "DB-019", title: "exactly one document was ingested" },
  { id: "DB-020", title: "the document was parsed into sections" },
  { id: "DB-021", title: "a Task Contract was compiled" },
  { id: "DB-022", title: "the contract carries executable goal items" },
  { id: "DB-023", title: "the contract carries acceptance criteria from the WorkBook" },
  { id: "DB-024", title: "the compiled objective never embeds the document body" },
  { id: "DB-025", title: "the objective is the compiled contract, not the raw attachment" },
  { id: "DB-026", title: "repository discovery ran against the selected workspace" },
  { id: "DB-027", title: "discovery found the workspace test files" },
  { id: "DB-028", title: "intake stage INPUT_RECEIVED was recorded" },
  { id: "DB-029", title: "intake stage INGESTING was recorded" },
  { id: "DB-030", title: "intake stage CLASSIFYING was recorded" },
  { id: "DB-031", title: "intake stage COMPILING was recorded" },
  { id: "DB-032", title: "intake stage DISCOVERING was recorded" },
  { id: "DB-033", title: "intake stage PLANNING was recorded" },
  { id: "DB-034", title: "intake stage READY was recorded" },
  { id: "DB-035", title: "the dispatch boundary was entered (RUNNING after READY)" },
  { id: "DB-036", title: "a dispatch checkpoint exists for the task" },
  { id: "DB-037", title: "the checkpoint expected the selected provider" },
  { id: "DB-038", title: "the checkpoint was rolled back" },
  { id: "DB-039", title: "the rollback carries a real reason" },
  { id: "DB-040", title: "the rollback needs no reconciliation (nothing was sent)" },
  { id: "DB-041", title: "provider runs were created for the task" },
  { id: "DB-042", title: "provider runs were restored to their pre-send baseline" },
  { id: "DB-043", title: "no artifact was fabricated" },
  { id: "DB-044", title: "no final response was fabricated" },
  { id: "DB-045", title: "the task never claims completion" },
  { id: "DB-046", title: "the registry revision is linked to the real task id" },
  { id: "DB-047", title: "the registry revision is the ingested content hash" },
  { id: "DB-048", title: "the bounded provider was refused honestly, not silently" },
  { id: "DB-049", title: "the real app recorded project knowledge for this dispatch" },
  { id: "DB-050", title: "every recorded object is ACTIVE" },
  { id: "DB-051", title: "every recorded object carries provenance" },
  { id: "DB-052", title: "the knowledge write gate logged the decision" },
  { id: "DB-053", title: "nothing was quarantined or rejected for this dispatch" },
  { id: "DB-054", title: "the recorded knowledge names a real knowledge type" },
  { id: "DB-055", title: "the real app recorded a repository world model for this dispatch" },
  { id: "DB-056", title: "the world model is content-addressed and identifies the workspace" },
  { id: "DB-057", title: "the world model names the workspace package manager" },
  { id: "DB-058", title: "the world model was persisted for later phases" },
  { id: "DB-059", title: "the real app summarized the UI surface registry" },
  { id: "DB-060", title: "the UI surface registry was persisted" },
  { id: "DB-061", title: "no world model diagnostic was recorded" },
  { id: "DB-062", title: "phase one needed no debugger reconnect" },
  { id: "DB-063", title: "the restarted app serves the theme panel from the real UI" },
  { id: "DB-064", title: "the theme registry survived the restart (active theme restored)" },
  { id: "DB-065", title: "the canvas shows the restored theme token on boot" },
  { id: "DB-066", title: "activating Light through the panel switches the active theme" },
  { id: "DB-067", title: "the canvas token really changed" },
  { id: "DB-068", title: "the Light token is the value the engine shipped" },
  { id: "DB-069", title: "the rendered surface colour follows the token" },
  { id: "DB-070", title: "restoring Dark returns the original canvas" },
  { id: "DB-071", title: "no layout overflow after the theme switch" },
  { id: "DB-072", title: "the composer survives the theme switch (no blank screen)" },
  { id: "DB-073", title: "both built-ins are listed in the panel" },
  { id: "DB-074", title: "the theme registry was persisted by the real app" },
  { id: "DB-075", title: "the persisted active theme is back to the built-in default" },
  { id: "DB-076", title: "both built-ins are registered and locked" },
  { id: "DB-077", title: "built-in validation passed in the real app" },
  { id: "DB-078", title: "a prompt produced a theme draft in the real app" },
  { id: "DB-079", title: "the preview renders in its own layer (never as the active theme)" },
  { id: "DB-080", title: "the active theme is untouched while previewing" },
  { id: "DB-081", title: "a natural-language revision changed the draft" },
  { id: "DB-082", title: "the visual check ran and reported a verdict" },
  { id: "DB-083", title: "accepting the preview activated the generated theme" },
  { id: "DB-084", title: "the preview layer was cleared after acceptance" },
  { id: "DB-085", title: "the app returned to the locked default afterwards" },
  { id: "DB-086", title: "the generated theme is durably registered" },
  { id: "DB-087", title: "the generated theme is a validated custom package" },
  { id: "DB-088", title: "the preview state was cleaned up after acceptance" },
  { id: "DB-089", title: "the visual capture directory was created by the real app" },
];

/** §6.1: the count comes from the contract, never from a hard-coded 89. */
export const DESKTOP_BLACK_BOX_REQUIRED_CLAIMS = DESKTOP_BLACK_BOX_REQUIREMENTS.length;

/** The ids in contract order. */
export const DESKTOP_BLACK_BOX_REQUIRED_IDS: readonly string[] = DESKTOP_BLACK_BOX_REQUIREMENTS.map((requirement) => requirement.id);

/** The id a claim title belongs to, or undefined when the title is not in the contract. */
export function desktopClaimId(title: string): string | undefined {
  return DESKTOP_BLACK_BOX_REQUIREMENTS.find((requirement) => requirement.title === title)?.id;
}

/**
 * §2.7: the digest of the contract itself. A report that was produced under a
 * different claim set cannot claim this digest, so a silent contract change is
 * visible to the root auditor.
 */
export const DESKTOP_BLACK_BOX_CONTRACT_HASH = sha256Hex(JSON.stringify({
  version: DESKTOP_BLACK_BOX_CONTRACT_VERSION,
  requirements: DESKTOP_BLACK_BOX_REQUIREMENTS.map((requirement) => [requirement.id, requirement.title])
}));
