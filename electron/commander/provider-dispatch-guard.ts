/**
 * Dispatch group-size guard (REPAIR_BATCH_3).
 *
 * `compileIntent("")` rejects an empty objective, so the bridge must not run an
 * attachment-only request (blank prompt) through it just to decide whether a
 * multi-provider group is allowed.
 *
 * Kept in its own module so the rule is testable against the real helper
 * boundary without importing electron/main.ts.
 */
import { compileIntent } from "../../src/shared/task-ir";
import { isDispatchGroupSize } from "../../src/shared/provider-policy";

/** Legacy bilingual message the bridge has always shown. */
export const DISPATCH_GROUP_ERROR = "请选择 1–5 个 AI；默认使用单 AI";

/**
 * Enforces the 1–5 provider selection requirement.
 *
 * - a valid selection (1–5) always passes;
 * - otherwise the intent is taken from the user's message, or from the compiled
 *   WorkBook objective when the message is blank;
 * - with no intent text at all there is no evidence of a trivially simple (L0)
 *   task, so the selection is required rather than assumed valid.
 */
export function assertDispatchGroupSize(prompt: string, objective: string, providerCount: number): void {
  if (isDispatchGroupSize(providerCount)) return;
  const intentText = (prompt ?? "").trim() || (objective ?? "").trim();
  const trivial = intentText.length > 0 && compileIntent(intentText).estimatedComplexity === "L0";
  if (trivial) return;
  throw new Error(DISPATCH_GROUP_ERROR);
}
