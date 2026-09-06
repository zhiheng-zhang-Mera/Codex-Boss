/**
 * Project goal-tree view model (plan AP15 seam). Pure and renderer-shareable.
 *
 * `electron/project/project-state.ts` owns the durable record; this module
 * turns that record into the UI tree (children by parent, order, status) so a
 * goal-tree panel can render without shipping the electron store to the
 * renderer. Kept in src/shared for renderer reuse.
 */

export interface GoalView {
  id: string;
  title: string;
  parent?: string;
  status: "open" | "active" | "done" | "abandoned";
  /** Completed / open child counts for progress display. */
  children: GoalView[];
  depth: number;
}

export interface GoalTree {
  roots: GoalView[];
  counts: { total: number; open: number; active: number; done: number; abandoned: number };
  /** Valid? fails closed on cycles or duplicate ids. */
  valid: boolean;
  reason?: string;
}

export function buildGoalTree(goals: Array<{ id: string; title: string; parent?: string; status: GoalView["status"] }>): GoalTree {
  const byId = new Map<string, GoalView>();
  for (const goal of goals) {
    if (!goal.id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(goal.id) || byId.has(goal.id)) return { roots: [], counts: emptyCounts(), valid: false, reason: "duplicate or invalid goal id" };
    if (!["open", "active", "done", "abandoned"].includes(goal.status)) return { roots: [], counts: emptyCounts(), valid: false, reason: `invalid goal status ${String(goal.status)}` };
    byId.set(goal.id, { id: goal.id, title: String(goal.title ?? "").slice(0, 200), parent: goal.parent, status: goal.status, children: [], depth: 0 });
  }
  const roots: GoalView[] = [];
  for (const view of byId.values()) {
    if (view.parent === undefined) { roots.push(view); continue; }
    const parent = byId.get(view.parent);
    if (!parent) return { roots: [], counts: emptyCounts(), valid: false, reason: `missing parent ${view.parent}` };
    parent.children.push(view);
  }
  // Cycle + depth guard (bounded goal tree).
  const counts = emptyCounts();
  const reached = new Set<string>();
  const visit = (node: GoalView, depth: number, seen: Set<string>): GoalView => {
    if (depth > 32 || seen.has(node.id)) throw new Error("goal cycle");
    node.depth = depth;
    counts.total += 1;
    counts[node.status] += 1;
    reached.add(node.id);
    const next = new Set(seen); next.add(node.id);
    node.children.forEach((child) => visit(child, depth + 1, next));
    return node;
  };
  try { roots.forEach((root) => visit(root, 0, new Set())); }
  catch (error) { return { roots: [], counts: emptyCounts(), valid: false, reason: String(error) }; }
  if (reached.size !== byId.size) return { roots: [], counts: emptyCounts(), valid: false, reason: "goal graph contains a cycle or unreachable node" };
  return { roots, counts, valid: true };
}

export function summaryOf(goals: Array<{ id: string; title: string; parent?: string; status: GoalView["status"] }>): string {
  const tree = buildGoalTree(goals);
  if (!tree.valid) return `goal tree invalid: ${tree.reason ?? "unknown"}`;
  return `${tree.roots.length} root goal(s), ${tree.counts.open} open, ${tree.counts.active} active, ${tree.counts.done} done, ${tree.counts.abandoned} abandoned`;
}

export interface ProjectStateSummary {
  workspaceId: string;
  goals: GoalView[];
  decisionCount: number;
  researchCount: number;
  openQuestions: string[];
  nextActions: string[];
  tree: string;
  updatedAt: string;
}

function emptyCounts() { return { total: 0, open: 0, active: 0, done: 0, abandoned: 0 }; }
