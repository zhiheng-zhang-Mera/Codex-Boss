import { describe, expect, it } from "vitest";
import type { ThemeKnowledgeScope } from "../../electron/theme/theme-knowledge";
import type { KnowledgeScope } from "../../src/shared/tenx/knowledge";

/**
 * CC-119 boundary test.
 *
 * `electron/theme/theme-knowledge.ts` (owner `theme`) imported `KnowledgeScope` from `src/shared/tenx/knowledge.ts`
 * (owner `tenx`) — the ONLY edge that file has onto the tenx capability, and type-only — which made `theme|tenx` one
 * of the mutual capability pairs for the sake of a four-literal union with no behaviour.
 *
 * The file now declares its own union, and this suite pins the two to each other IN BOTH DIRECTIONS AT COMPILE TIME:
 * a scope shape added on one side only stops the build. That is the same guarantee CC-114 (protocol roles) and
 * CC-118 (the recovery port) used, and it is available because both sides are types with no behaviour.
 */
describe("the theme knowledge scope is not a divergence from the tenx KnowledgeScope", () => {
  it("pins the two unions to each other at compile time", () => {
    type ThemeIsAssignableToTenx = ThemeKnowledgeScope extends KnowledgeScope ? true : never;
    type TenxIsAssignableToTheme = KnowledgeScope extends ThemeKnowledgeScope ? true : never;
    const themeToTenx: ThemeIsAssignableToTenx = true;
    const tenxToTheme: TenxIsAssignableToTheme = true;
    expect(themeToTenx).toBe(true);
    expect(tenxToTheme).toBe(true);
  });

  it("keeps the four template-literal shapes the record needs", () => {
    const scopes: readonly ThemeKnowledgeScope[] = ["global", "project:boss", "task:t-1", "user:owner"];
    expect(scopes).toHaveLength(4);
    expect(new Set(scopes).size).toBe(4);
  });
});
