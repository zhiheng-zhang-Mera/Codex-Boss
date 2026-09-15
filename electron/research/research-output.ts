import path from "node:path";

/**
 * The one user-visible output root inside a workspace (Update-Plan/cleaning.md §5).
 *
 * Task 3 asks for an explicit default save location and says to keep the
 * existing convention when there is one. There is: a finished research run
 * exports its deliverables to `<workspace>/Research/<topic>/` (paper, audits,
 * evidence, experiments), and that is the only place Boss writes user-visible
 * generated output into the user's project. Everything else Boss produces —
 * task state, ledgers, checkpoints, caches, exports — belongs to the app's own
 * runtime data root, not to the workspace.
 *
 * The convention used to be spelled inline at the one call site, with the topic
 * slug in a private helper. Naming both here makes the default deterministic and
 * checkable: same question ⇒ same folder, and never a timestamp in a path.
 */

/** The workspace-relative folder every research deliverable lands in. */
const RESEARCH_OUTPUT_DIRNAME = "Research";

/**
 * ASCII topic folder from a research question: lower-cased tokens joined by
 * `-`, at most six tokens and 60 characters. Falls back to `research` when the
 * question has no ASCII token at all, so the folder name is never empty.
 */
export function researchTopicSlug(question: string): string {
  const tokens = String(question ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return (tokens.slice(0, 6).join("-") || "research").slice(0, 60);
}

/** Deterministic export destination for one finished research run. */
export function researchDeliverablesPath(workspace: string, question: string): string {
  return path.join(workspace, RESEARCH_OUTPUT_DIRNAME, researchTopicSlug(question));
}
