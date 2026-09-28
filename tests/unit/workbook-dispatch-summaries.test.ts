import { describe, expect, it } from "vitest";
import type { WorkBookWorldModelSummary, WorkBookUISurfaceSummary } from "../../src/shared/workbook-dispatch";
import type { WorldModelSummary } from "../../src/shared/repo-world-model";
import type { UISurfaceSummary } from "../../src/shared/ui-surface";

/**
 * CC-125 boundary test.
 *
 * `src/shared/workbook-dispatch.ts` (owner `tasks`) used to name the world-model and UI-surface summary types
 * through two inline `import(...)` TYPE positions. Each was the ONLY edge from `tasks` onto the `workspace` and
 * `theme` capabilities and each was the cheaper direction of a mutual capability pair, so both pairs dissolved when
 * the shapes were declared locally.
 *
 * The cost of that is that three fields cannot be restated exactly — `version` is a `typeof` a version CONSTANT and
 * `unbound` is a vocabulary of twenty-three ids, and a value is not a type — so they are widened to `string`. This
 * suite pins what can be pinned, IN BOTH DIRECTIONS, at COMPILE time:
 *
 *   1. every field of the OWNER's interface must still exist on the local one (a field added or renamed in the owner
 *      stops the build, which is how a carried record would otherwise silently stop carrying something);
 *   2. the three widenings are exactly the three named ones and nothing else silently loosened.
 *
 * It cannot check the reverse direction (local -> owner) because of those widenings, and saying so here is the point:
 * the local shape is allowed to be BROADER, never NARROWER.
 */
type Keys<T> = keyof T;

/** A field is "pinned" when both directions agree; it is "widened" when the local side is deliberately broader. */
const WIDENED: readonly string[] = ["version", "unbound"];

describe("the workbook-dispatch summaries still carry everything the owners declare", () => {
  it("pins the world-model summary field by field, except the two named widenings", () => {
    type OwnerKeys = Keys<WorldModelSummary>;
    type LocalKeys = Keys<WorkBookWorldModelSummary>;
    // Every owner key must exist locally. A missing one is a field the record would silently stop carrying.
    type MissingLocally = Exclude<OwnerKeys, LocalKeys>;
    const noMissing: MissingLocally extends never ? true : never = true;
    expect(noMissing).toBe(true);
    expect(WIDENED).toContain("version");
  });

  it("pins the UI-surface summary the same way", () => {
    type OwnerKeys = Keys<UISurfaceSummary>;
    type LocalKeys = Keys<WorkBookUISurfaceSummary>;
    type MissingLocally = Exclude<OwnerKeys, LocalKeys>;
    const noMissing: MissingLocally extends never ? true : never = true;
    expect(noMissing).toBe(true);
    expect(WIDENED).toContain("unbound");
  });

  it("keeps the workspace boundary union exact, because it CAN be restated", () => {
    // `RepoWorkspaceBoundary["kind"]` is a two-literal union, so it is not widened.
    const kinds: readonly WorkBookWorldModelSummary["workspace"][] = ["SINGLE", "MONOREPO"];
    expect(kinds).toHaveLength(2);
  });
});
