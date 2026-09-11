/**
 * WORK_UNIT_3: shared WorkBook dispatch boundary predicate.
 *
 * `assertDispatchGroupSize` (provider-dispatch-guard.ts) is the single, stable
 * provider-group entry point; this module deliberately adds no second one.
 */

/**
 * Whether a WorkBook boundary legitimately requires zero provider dispatch.
 * Analysis-only work and non-executable classifications both keep the durable
 * record but must never touch a provider.
 */
export function requiresZeroProviderRuns(classification: string | undefined, analysisOnly: boolean): boolean {
  return analysisOnly || classification !== "EXECUTABLE_WORKBOOK";
}
