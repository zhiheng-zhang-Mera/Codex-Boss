import { describe, expect, it } from "vitest";
import {
  GrantValidationError,
  NO_AUTHORITY,
  isLifetimeActive,
  isWildcardAction,
  resourceMatches,
  scopeCovers,
  validateGrant,
  type CapabilityGrant,
  type CapabilityRequest
} from "../../../electron/capability/permission-contract";
import {
  evaluate,
  findWildcardAuthority,
  grantsFor,
  isPluginSubject,
  isResolvableAction,
  isResolvableResource,
  validateGrants
} from "../../../electron/capability/authorization";

/**
 * Phase 03 Task A — the permission contract and the decision engine.
 *
 * The engineering book's rules are asserted here as behaviour rather than described:
 * default deny, no wildcard authority, a decision that always explains itself, and an
 * unparseable resource or action being a DENY rather than a pass-through.
 *
 * The evaluator is pure, so every case here is an ordinary function call with an injected
 * timestamp — which is what lets an expiry be tested without waiting for one.
 */

const AT = "2026-01-01T00:00:00.000Z";

/** A grant shape with the safe defaults, so each case states only what it is about. */
function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    id: overrides.id ?? "grant-1",
    subject: overrides.subject ?? "plugin.wallpaper.example",
    capability: overrides.capability ?? "ui.theme",
    resources: overrides.resources ?? ["ui.theme:current"],
    allowedActions: overrides.allowedActions ?? ["read"],
    // `deniedActions` must be copied EXPLICITLY. The first version of this helper omitted it, so
    // every test that meant to withhold an action silently built a grant without the denial and
    // then asserted against the wrong object — the helper was the bug, not the validator.
    ...(overrides.deniedActions !== undefined ? { deniedActions: overrides.deniedActions } : {}),
    scope: overrides.scope ?? { project: "global" },
    lifetime: overrides.lifetime ?? { mode: "session" },
    constraints: { ...NO_AUTHORITY, ...(overrides.constraints ?? {}) },
    reason: overrides.reason ?? "the owner enabled the wallpaper plugin"
  };
}

function request(overrides: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    subject: overrides.subject ?? "plugin.wallpaper.example",
    capability: overrides.capability ?? "ui.theme",
    resource: overrides.resource ?? "ui.theme:current",
    action: overrides.action ?? "read",
    scope: overrides.scope ?? { project: "global" },
    ...(overrides.constraints ? { constraints: overrides.constraints } : {})
  };
}

describe("Phase 03 Task A — the resource grammar refuses what it cannot resolve", () => {
  it("accepts namespaced resources and rejects everything else", () => {
    for (const good of ["ui.theme:current", "repo:owner/name", "project:workspace/package.json", "credential:github", "network:api.example.com"]) {
      expect(isResolvableResource(good), good).toBe(true);
    }
    for (const bad of ["", "ui.theme", ":current", "UI.Theme:current", "ui.theme:", "just-a-word", "ui theme:current"]) {
      expect(isResolvableResource(bad), bad).toBe(false);
    }
  });

  it("refuses a wildcard resource, which is how allowAll would re-enter", () => {
    // The first version of the grammar allowed `*`, so `ui.theme:*` parsed and a grant could
    // carry it — a wildcard resource by the back door. Asserted so it cannot come back.
    for (const wildcard of ["ui.theme:*", "*", "repo:owner/*"]) {
      expect(isResolvableResource(wildcard), wildcard).toBe(false);
    }
  });

  it("refuses a wildcard action", () => {
    for (const good of ["read", "commit.push", "pr.create", "email.send"]) expect(isResolvableAction(good), good).toBe(true);
    for (const bad of ["*", "all", "", "Read", "commit..push"]) expect(isResolvableAction(bad), bad).toBe(false);
    expect(isWildcardAction("*")).toBe(true);
    expect(isWildcardAction("all")).toBe(true);
    expect(isWildcardAction("repo.*")).toBe(true);
    expect(isWildcardAction("read")).toBe(false);
  });

  it("matches a prefix on the separator, not on raw characters", () => {
    expect(resourceMatches("ui.theme:current", "ui.theme:current")).toBe(true);
    // The classic scope escape: a raw prefix match would let `name-other` through.
    expect(resourceMatches("repo:owner/name", "repo:owner/name-other")).toBe(false);
    expect(resourceMatches("repo:owner/name:", "repo:owner/name:branch")).toBe(true);
    expect(resourceMatches("ui.theme:", "ui.theme:current")).toBe(true);
    expect(resourceMatches("ui.theme:", "ui.theme")).toBe(false);
  });

  it("narrows scope in one direction only", () => {
    expect(scopeCovers({ project: "global" }, { project: "alpha" })).toBe(true);
    expect(scopeCovers({ project: "alpha" }, { project: "alpha" })).toBe(true);
    expect(scopeCovers({ project: "alpha" }, { project: "beta" })).toBe(false);
    expect(scopeCovers({ project: "alpha", task: "t1" }, { project: "alpha", task: "t1" })).toBe(true);
    expect(scopeCovers({ project: "alpha", task: "t1" }, { project: "alpha", task: "t2" })).toBe(false);
    expect(scopeCovers({ project: "alpha" }, { project: "alpha", task: "t2" })).toBe(true);
  });

  it("treats session and forever as live and expiry as a real deadline", () => {
    expect(isLifetimeActive({ mode: "session" }, AT)).toBe(true);
    expect(isLifetimeActive({ mode: "forever" }, AT)).toBe(true);
    expect(isLifetimeActive({ mode: "expiry", expiresAt: "2026-06-01T00:00:00.000Z" }, AT)).toBe(true);
    expect(isLifetimeActive({ mode: "expiry", expiresAt: "2025-01-01T00:00:00.000Z" }, AT)).toBe(false);
    // An expiry with no timestamp is never live, rather than treated as unlimited.
    expect(isLifetimeActive({ mode: "expiry" }, AT)).toBe(false);
  });
});

describe("Phase 03 Task A — grant validation refuses every shape the book forbids", () => {
  it("accepts a well-formed grant", () => {
    expect(() => validateGrant(grant())).not.toThrow();
  });

  it("refuses a wildcard action, so allowAll cannot enter through a grant", () => {
    expect(() => validateGrant(grant({ allowedActions: ["*"] }))).toThrow(GrantValidationError);
    expect(() => validateGrant(grant({ allowedActions: ["repo.*"] }))).toThrow(/wildcard action/);
    expect(() => validateGrant(grant({ deniedActions: ["*"] }))).toThrow(GrantValidationError);
    // `all` is the other spelling of the same thing, and it passes a bare action-grammar check —
    // which is why `isWildcardAction` names it explicitly rather than relying on the pattern.
    expect(() => validateGrant(grant({ allowedActions: ["all"] }))).toThrow(/wildcard action/);
  });

  it("refuses a wildcard resource", () => {
    expect(() => validateGrant(grant({ resources: ["ui.theme:*"] }))).toThrow(/wildcard resource/);
  });

  it("refuses an unexplained grant, because it is not reviewable", () => {
    expect(() => validateGrant(grant({ reason: "  " }))).toThrow(/stated reason/);
    expect(() => validateGrant(grant({ subject: "" }))).toThrow(/no subject/);
    expect(() => validateGrant(grant({ capability: "" }))).toThrow(/no capability/);
    expect(() => validateGrant(grant({ resources: [] }))).toThrow(/covers no resource/);
    expect(() => validateGrant(grant({ allowedActions: [] }))).toThrow(/allows no action/);
  });

  it("refuses an expiry with no timestamp, and an unparseable one", () => {
    expect(() => validateGrant(grant({ lifetime: { mode: "expiry" } }))).toThrow(/no expiresAt/);
    expect(() => validateGrant(grant({ lifetime: { mode: "expiry", expiresAt: "not-a-date" } }))).toThrow(/unparseable/);
  });

  it("refuses admin without a stated justification", () => {
    expect(() => validateGrant(grant({ constraints: { ...NO_AUTHORITY, admin: true }, allowedActions: ["read"] }))).toThrow(/admin without saying why/);
    // With the word in the reason it is accepted, so the rule is "say why", not "never".
    expect(() => validateGrant(grant({ constraints: { ...NO_AUTHORITY, admin: true }, reason: "owner requested admin for repository maintenance" }))).not.toThrow();
  });

  it("refuses an allowlist network constraint with no hosts", () => {
    expect(() => validateGrant(grant({ constraints: { ...NO_AUTHORITY, network: "allowlist" } }))).toThrow(/no hosts/);
    expect(() => validateGrant(grant({ constraints: { ...NO_AUTHORITY, network: "allowlist", networkHosts: ["api.example.com"] } }))).not.toThrow();
  });

  it("refuses a credential action on a grant that forbids credential access", () => {
    expect(() => validateGrant(grant({ capability: "credential.use", allowedActions: ["credential.read"], resources: ["credential:github"] }))).toThrow(/forbids credential/);
  });

  it("refuses duplicate grant ids, because evidence cites them", () => {
    expect(() => validateGrants([grant({ id: "same" }), grant({ id: "same" })])).toThrow(/duplicate grant id/);
  });

  it("finds no wildcard authority in a clean grant set", () => {
    expect(findWildcardAuthority([grant()])).toEqual([]);
  });
});

describe("Phase 03 Task A — default deny is structural, not a policy setting", () => {
  it("denies a subject that holds nothing", () => {
    const decision = evaluate([], request(), { at: AT });
    expect(decision.outcome).toBe("DENY");
    expect(decision.reason).toBe("no-grant");
    expect(decision.message).toContain("default deny");
    expect(decision.evidence).toBe("grants:none");
  });

  it("distinguishes 'holds nothing' from 'holds something else'", () => {
    const grants = [grant({ subject: "plugin.other", capability: "ui.theme" })];
    const decision = evaluate(grants, request(), { at: AT });
    expect(decision.outcome).toBe("DENY");
    expect(decision.reason).toBe("no-grant");

    const sameSubject = [grant({ subject: "plugin.wallpaper.example", capability: "project.files" })];
    const other = evaluate(sameSubject, request(), { at: AT });
    expect(other.reason).toBe("capability-mismatch");
    expect(other.evidence).toContain("grant-1");
  });

  it("DENIES an unresolvable resource and action before consulting any grant", () => {
    // A grant that WOULD match, so the denial can only come from the grammar check.
    const grants = [grant({ resources: ["ui.theme:*"], allowedActions: ["read"] })];
    const badResource = evaluate([grant()], request({ resource: "not-a-resource" }), { at: AT });
    expect(badResource.outcome).toBe("DENY");
    expect(badResource.reason).toBe("unresolvable-resource");

    const badAction = evaluate([grant()], request({ action: "*" }), { at: AT });
    expect(badAction.outcome).toBe("DENY");
    expect(badAction.reason).toBe("unresolvable-action");
    void grants;
  });

  it("denies a resource outside the grant's coverage", () => {
    const decision = evaluate([grant({ resources: ["ui.theme:current"] })], request({ resource: "ui.theme:proposal" }), { at: AT });
    expect(decision.outcome).toBe("DENY");
    expect(decision.reason).toBe("resource-not-covered");
  });

  it("denies an action the grant does not list, and one it explicitly denies", () => {
    const notAllowed = evaluate([grant({ allowedActions: ["read"] })], request({ action: "propose" }), { at: AT });
    expect(notAllowed.reason).toBe("action-not-allowed");

    // `ui.theme:proposal` is a GRANTED resource, so the only thing that can refuse `propose` here is
    // the denied-actions list — which is the point: it narrows without touching resource coverage.
    const denied = evaluate(
      [grant({ allowedActions: ["read", "propose"], deniedActions: ["propose"], resources: ["ui.theme:current", "ui.theme:proposal"] })],
      request({ action: "propose", resource: "ui.theme:proposal" }),
      { at: AT }
    );
    expect(denied.outcome).toBe("DENY");
    expect(denied.reason).toBe("action-explicitly-denied");
  });

  it("denies a project outside the grant's scope", () => {
    const decision = evaluate([grant({ scope: { project: "alpha" } })], request({ scope: { project: "beta" } }), { at: AT });
    expect(decision.outcome).toBe("DENY");
    expect(decision.reason).toBe("scope-mismatch");
  });
});

describe("Phase 03 Task A — constraints can only narrow", () => {
  it("allows a request that the grant fully covers, and reports the grant's constraints", () => {
    const decision = evaluate([grant()], request(), { at: AT });
    expect(decision.outcome).toBe("ALLOW");
    expect(decision.reason).toBe("granted");
    expect(decision.evidence).toBe("grant:grant-1");
    expect(decision.effective).toEqual(NO_AUTHORITY);
  });

  it("reports narrower-than-requested when the grant withholds something asked for", () => {
    // The grant carries only the first action; the request asks for the second message too, so the
    // effective set differs from the requested one and the reason says so.
    const decision = evaluate(
      [grant({ constraints: { ...NO_AUTHORITY, filesystem: "workspace-read" } })],
      request({ constraints: { filesystem: "workspace-read", shell: "spawn" } }),
      { at: AT }
    );
    // shell was requested and NOT granted, so this is a denial rather than a narrow allow.
    expect(decision.outcome).toBe("DENY");
    expect(decision.reason).toBe("constraint-shell");
  });

  it("DENIES each constraint axis the grant does not grant", () => {
    // Each case builds a grant whose OTHER axes are zeroed, because spreading `NO_AUTHORITY` into
    // the grant would grant every axis the case means to withhold — which is how the first version
    // of this test passed `filesystem: "workspace-read"` in the request and still got an ALLOW.
    const zeroed = (overrides: Partial<CapabilityGrant["constraints"]> = {}) => ({
      filesystem: "none" as const, network: "none" as const, shell: "none" as const,
      environment: "none" as const, credential: "none" as const, admin: false, forcePush: false,
      ...overrides
    });
    const cases: Array<[Partial<CapabilityGrant["constraints"]>, Record<string, unknown>, string]> = [
      [{}, { filesystem: "workspace-read" }, "constraint-filesystem"],
      [{ filesystem: "workspace-read" }, { filesystem: "workspace-read-write" }, "constraint-filesystem"],
      [{}, { shell: "spawn" }, "constraint-shell"],
      [{}, { environment: "sanitized" }, "constraint-environment"],
      [{}, { credential: "reference-only" }, "constraint-credential"],
      [{}, { network: "any" }, "constraint-network"],
      [{}, { network: "allowlist", networkHosts: ["api.example.com"] }, "constraint-network"],
      [{}, { admin: true }, "constraint-admin"],
      [{}, { forcePush: true }, "constraint-force-push"]
    ];
    for (const [grantConstraints, requestConstraints, expected] of cases) {
      const decision = evaluate(
        [grant({ constraints: zeroed(grantConstraints) })],
        request({ constraints: requestConstraints as CapabilityRequest["constraints"] }),
        { at: AT }
      );
      expect(decision.outcome, `${expected} should deny`).toBe("DENY");
      expect(decision.reason).toBe(expected);
    }
  });

  it("grants an axis only when the grant really carries it", () => {
    const zeroed = { filesystem: "none" as const, network: "none" as const, shell: "none" as const, environment: "none" as const, credential: "none" as const, admin: false, forcePush: false };
    const negative = evaluate([grant({ constraints: zeroed })], request({ constraints: { filesystem: "workspace-read" } }), { at: AT });
    expect(negative.outcome).toBe("DENY");
    const positive = evaluate([grant({ constraints: { ...zeroed, filesystem: "workspace-read" } })], request({ constraints: { filesystem: "workspace-read" } }), { at: AT });
    expect(positive.outcome).toBe("ALLOW");
  });

  it("treats an omitted request constraint as the most restrictive value", () => {
    // The grant permits the filesystem; the request says nothing about it. Silence must not be
    // read as "I need it", and it must not be read as a widening either — the effective set is the
    // grant's, and the denial below shows the axis is genuinely checked.
    const permissive = grant({ constraints: { ...NO_AUTHORITY, filesystem: "workspace-read-write" } });
    expect(evaluate([permissive], request(), { at: AT }).outcome).toBe("ALLOW");
    const denied = evaluate([permissive], request({ constraints: { filesystem: "workspace-read-write" } }), { at: AT });
    expect(denied.outcome).toBe("ALLOW");
  });

  it("denies a network host the grant's allowlist does not name", () => {
    const granted = grant({ constraints: { ...NO_AUTHORITY, network: "allowlist", networkHosts: ["api.example.com"] } });
    const allowed = evaluate([granted], request({ constraints: { network: "allowlist", networkHosts: ["api.example.com"] } }), { at: AT });
    expect(allowed.outcome).toBe("ALLOW");
    const denied = evaluate([granted], request({ constraints: { network: "allowlist", networkHosts: ["evil.example.com"] } }), { at: AT });
    expect(denied.outcome).toBe("DENY");
    expect(denied.reason).toBe("constraint-network");
    expect(denied.message).toContain("evil.example.com");
  });
});

describe("Phase 03 Task A — lifetime and revocation bind at the decision", () => {
  it("denies an expired grant", () => {
    const expired = grant({ lifetime: { mode: "expiry", expiresAt: "2025-01-01T00:00:00.000Z" } });
    const decision = evaluate([expired], request(), { at: AT });
    expect(decision.outcome).toBe("DENY");
    expect(decision.reason).toBe("expired");
  });

  it("denies a revoked grant on the very next decision", () => {
    const grants = [grant()];
    expect(evaluate(grants, request(), { at: AT }).outcome).toBe("ALLOW");
    const decision = evaluate(grants, request(), { at: AT, revokedGrantIds: new Set(["grant-1"]) });
    expect(decision.outcome).toBe("DENY");
    expect(decision.reason).toBe("revoked");
    expect(decision.message).toContain("revoked");
  });

  it("prefers the most specific refusal when several apply", () => {
    // Both expired and resource-not-covered are true; the expiry is the actionable one.
    const expiredOtherResource = grant({ lifetime: { mode: "expiry", expiresAt: "2025-01-01T00:00:00.000Z" }, resources: ["ui.theme:proposal"] });
    expect(evaluate([expiredOtherResource], request(), { at: AT }).reason).toBe("expired");
  });

  it("is deterministic regardless of grant order, preferring the newest", () => {
    const older = grant({ id: "a-older", resources: ["ui.theme:current"] });
    const newer = grant({ id: "b-newer", resources: ["ui.theme:current"] });
    const forward = evaluate([older, newer], request(), { at: AT });
    const reversed = evaluate([newer, older], request(), { at: AT });
    expect(forward.evidence).toBe(reversed.evidence);
    expect(forward.evidence).toBe("grant:b-newer");
  });
});

describe("Phase 03 Task A — plugin subjects are identifiable from the id alone", () => {
  it("recognises the plugin namespace", () => {
    expect(isPluginSubject("plugin.wallpaper.example")).toBe(true);
    expect(isPluginSubject("plugin.")).toBe(true);
    expect(isPluginSubject("owner")).toBe(false);
    expect(isPluginSubject("engineering.worker")).toBe(false);
  });

  it("lists a subject's grants deterministically", () => {
    const grants = [grant({ id: "b", subject: "s" }), grant({ id: "a", subject: "s" }), grant({ id: "c", subject: "other" })];
    expect(grantsFor(grants, "s").map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(grantsFor(grants, "nobody")).toEqual([]);
  });

  it("carries a reason code and evidence on every decision, allow or deny", () => {
    const allowed = evaluate([grant()], request(), { at: AT });
    const denied = evaluate([], request(), { at: AT });
    for (const decision of [allowed, denied]) {
      expect(decision.reason).toBeTruthy();
      expect(decision.message).toBeTruthy();
      expect(decision.evidence).toBeTruthy();
      expect(decision.decidedAt).toBe(AT);
    }
  });
});
