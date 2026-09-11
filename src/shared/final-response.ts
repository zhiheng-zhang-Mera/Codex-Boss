import type { AppSnapshot, FinalResponse } from "./contracts";
export function currentArtifactIds(snapshot: AppSnapshot, taskId: string): string[] {
  const runs = snapshot.runs.filter(item => item.taskId === taskId);
  const round = Math.max(0, ...runs.map(item => item.round));
  return runs.filter(item => item.round === round).map(item => item.artifactId ?? "").sort();
}
export function currentFinalResponse(snapshot: AppSnapshot, taskId: string): FinalResponse | undefined {
  const ids = currentArtifactIds(snapshot, taskId);
  if (!ids.length || ids.some(id => !id)) return;
  return snapshot.finalResponses.find(item => item.taskId === taskId && item.sourceArtifactIds.length === ids.length && [...item.sourceArtifactIds].sort().every((id, index) => id === ids[index]));
}

/**
 * WORK_UNIT_3: analysis-only WorkBook tasks complete with no provider run and
 * therefore no artifacts. `currentFinalResponse` correctly returns undefined for
 * them — there is no provider answer and none may be fabricated. This predicate
 * lets the UI show the real deliverable (the compiled Task Contract) instead.
 */
export function isAnalysisOnlyCompletion(task: {
  status?: string;
  workbookDispatch?: { analysis_only?: boolean; stage?: string; contract?: unknown };
}): boolean {
  return task.status === "completed"
    && task.workbookDispatch?.analysis_only === true
    && task.workbookDispatch.contract !== undefined;
}
