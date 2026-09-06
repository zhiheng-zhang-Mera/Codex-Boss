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
