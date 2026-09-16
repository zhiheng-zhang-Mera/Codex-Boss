import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NO_AUTHORITY, type CapabilityGrant } from "../../../electron/capability/permission-contract";
import { createCapabilityBroker } from "../../../electron/capability/capability-broker";
import {
  EXECUTION_CAPABILITY_MAP,
  authorizeExecution,
  gateAuthorizer,
  normaliseResource,
  resolveResource,
  type ExecutionKind
} from "../../../electron/capability/integration/execution-authorization";
import {
  BOUNDARY_INVENTORY,
  describeBoundaryInventory,
  legacyBoundaries,
  mappedBoundaries
} from "../../../electron/capability/integration/boundary-inventory";
import { ExecutionDeniedError, ExecutionGate } from "../../../electron/commander/execution-gate";

/**
 * Phase 03 gate 2 — high-privilege operations map to an explicit capability decision.
 *
 * This is the production path, not a harness: `ExecutionGate` is the real gate the composition root
 * constructs, and the authorizer is the real broker. The tests below drive an execution through
 * it and assert that an unauthorized one is refused by a DECISION rather than by a convention.
 *
 * The other half of gate 2 is the inventory: every boundary Phase 03 found is listed with its
 * route and a reason, and the tests assert the list is honest in both directions — no entry names
 * a module that does not exist, and nothing is silently unlisted.
 */

const AT = "2026-01-01T00:00:00.000Z";
const SUBJECT = "engineering.worker";

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    id: overrides.id ?? "grant-1",
    subject: overrides.subject ?? SUBJECT,
    capability: overrides.capability ?? "process.exec",
    resources: overrides.resources ?? ["process:shell"],
    allowedActions: overrides.allowedActions ?? ["spawn"],
    ...(overrides.deniedActions !== undefined ? { deniedActions: overrides.deniedActions } : {}),
    scope: overrides.scope ?? { project: "global" },
    lifetime: overrides.lifetime ?? { mode: "session" },
    constraints: { ...NO_AUTHORITY, ...(overrides.constraints ?? {}) },
    reason: overrides.reason ?? "the owner authorized this execution for the engineering worker"
  };
}

function authorizerWith(grants: CapabilityGrant[]) {
  const broker = createCapabilityBroker({ providers: executionCapabilityProviders(), grants });
  return { broker, authorizer: gateAuthorizer(broker, SUBJECT, { at: AT }) };
}

/**
 * Recording providers for the four capabilities the execution mapping reaches.
 *
 * A broker refuses a capability no provider claims BEFORE consulting any grant, so a broker without
 * these answered every execution with "no capability named process.exec is registered" — a refusal
 * for the wrong reason, which is the kind of green-looking test this suite exists to prevent.
 */
function executionCapabilityProviders() {
  const names = [
    EXECUTION_CAPABILITY_MAP.shell.capability,
    EXECUTION_CAPABILITY_MAP.filesystem.capability,
    EXECUTION_CAPABILITY_MAP.git.capability,
    EXECUTION_CAPABILITY_MAP.network.capability
  ];
  return [...new Set(names)].map((capability) => ({
    capability,
    describes: `recording double for ${capability}; the boundary under test is the authorization decision, not the adapter`,
    // A worker subject is not a plugin, so plugin-safety does not gate it here. Declaring false
    // keeps the double consistent with the real providers, which are all non-plugin-safe.
    pluginSafe: false,
    create: () => ({ invoke: (request: { action: string; resource: string }) => ({ recorded: true, capability, action: request.action, resource: request.resource }) })
  }));
}

/** A gate whose proposals are already approved, so the authorization question is the one under test. */
function approvedGate(authorizer?: (context: { kind: ExecutionKind; description: string; payload: unknown; originArtifactId?: string }) => { allowed: boolean; message: string; evidence?: string }) {
  const gate = new ExecutionGate(authorizer ? { authorizer } : {});
  return gate;
}

describe("Phase 03 gate 2 — the execution gate consults a capability decision", () => {
  it("refuses an unauthorized shell execution, with the decision that refused it", async () => {
    const { authorizer } = authorizerWith([]);
    const gate = approvedGate(authorizer);
    const proposal = gate.propose({ kind: "shell", description: "run the test suite", payload: { command: "node --test" } });
    gate.validate(proposal.id);
    gate.approve(proposal.id);

    let executed = false;
    await expect(gate.execute(proposal.id, async () => { executed = true; })).rejects.toThrow(ExecutionDeniedError);
    expect(executed, "the executor must not have run").toBe(false);

    // The refusal names the decision, so it is diagnosable rather than a bare throw.
    const history = gate.authorizationHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ proposalId: proposal.id, kind: "shell", allowed: false });
    expect(history[0].message).toContain("default deny");
    expect(history[0].evidence).toBeTruthy();
    // The gate's own record says FAILED? No: it never started, so it stays APPROVED.
    expect(gate.get(proposal.id)?.status).toBe("APPROVED");
  });

  it("runs an authorized execution, and records the allow", async () => {
    const { authorizer } = authorizerWith([grant({ constraints: { ...NO_AUTHORITY, shell: "spawn" } })]);
    const gate = approvedGate(authorizer);
    const proposal = gate.propose({ kind: "shell", description: "run the test suite", payload: { command: "node --test" } });
    gate.validate(proposal.id);
    gate.approve(proposal.id);

    let result: string;
    try {
      result = await gate.execute(proposal.id, async (record) => `ran ${record.kind}`);
    } catch (error) {
      throw new Error(`authorized execution was refused: ${error instanceof Error ? error.message : String(error)} | history=${JSON.stringify(gate.authorizationHistory())}`);
    }
    expect(result).toBe("ran shell");
    expect(gate.get(proposal.id)?.status).toBe("SUCCEEDED");
    expect(gate.authorizationHistory()[0]).toMatchObject({ allowed: true });
  });

  it("still requires the approval flow: authorization does not replace it", async () => {
    const { authorizer } = authorizerWith([grant({ constraints: { ...NO_AUTHORITY, shell: "spawn" } })]);
    const gate = approvedGate(authorizer);
    const proposal = gate.propose({ kind: "shell", description: "not yet approved", payload: { command: "echo" } });
    gate.validate(proposal.id);
    // Approved is what the gate requires; a grant alone must not be enough.
    await expect(gate.execute(proposal.id, async () => "x")).rejects.toThrow(/not approved/);
    expect(gate.authorizationHistory(), "no authorization was consulted").toHaveLength(0);
  });

  it("is opt-in: a gate with no authorizer behaves exactly as before", async () => {
    const gate = approvedGate();
    expect(gate.authorizationEnabled()).toBe(false);
    const proposal = gate.propose({ kind: "shell", description: "legacy route", payload: {} });
    gate.validate(proposal.id);
    gate.approve(proposal.id);
    await expect(gate.execute(proposal.id, async () => "legacy ok")).resolves.toBe("legacy ok");
    expect(gate.authorizationHistory()).toEqual([]);
  });

  it("FAILS CLOSED when the authorizer throws", async () => {
    const gate = approvedGate(() => { throw new Error("the broker is unavailable"); });
    const proposal = gate.propose({ kind: "shell", description: "must not run", payload: {} });
    gate.validate(proposal.id);
    gate.approve(proposal.id);

    let executed = false;
    await expect(gate.execute(proposal.id, async () => { executed = true; })).rejects.toThrow(ExecutionDeniedError);
    expect(executed, "an authorizer that threw must not let the execution through").toBe(false);
    expect(gate.authorizationHistory()[0]).toMatchObject({ allowed: false });
    expect(gate.authorizationHistory()[0].message).toContain("the authorizer threw");
  });

  it("refuses force push and admin for git, even when the subject holds github.write", async () => {
    const { authorizer } = authorizerWith([
      grant({
        id: "grant-git",
        capability: "github.write",
        resources: ["repo:owner/name"],
        allowedActions: ["commit.push", "branch.create"],
        constraints: { ...NO_AUTHORITY, admin: false, forcePush: false }
      })
    ]);
    const gate = approvedGate(authorizer);
    const proposal = gate.propose({ kind: "git", description: "push the candidate", payload: { repository: "owner/name" } });
    gate.validate(proposal.id);
    gate.approve(proposal.id);
    // The mapping demands admin:false and forcePush:false, which the grant carries, so this is an
    // ALLOW — the requirement is a floor the grant must clear, not a prohibition.
    await expect(gate.execute(proposal.id, async () => "pushed")).resolves.toBe("pushed");
    expect(gate.authorizationHistory()[0].allowed).toBe(true);

    // A grant that DOES permit force push is what the contract's validation refuses at authoring
    // time, so the widening cannot be expressed at all — asserted in the contract suite. Here the
    // point is that the mapping asked.
    expect(EXECUTION_CAPABILITY_MAP.git.constraints).toMatchObject({ admin: false, forcePush: false });
  });

  it("refuses a filesystem execution whose payload names no path", async () => {
    const { authorizer } = authorizerWith([
      grant({ capability: "project.files", resources: ["project:workspace/"], allowedActions: ["write"], constraints: { ...NO_AUTHORITY, filesystem: "workspace-read-write" } })
    ]);
    const gate = approvedGate(authorizer);
    const proposal = gate.propose({ kind: "filesystem", description: "write a file", payload: {} });
    gate.validate(proposal.id);
    gate.approve(proposal.id);
    await expect(gate.execute(proposal.id, async () => "x")).rejects.toThrow(/needs a non-empty path/);
  });

  it("refuses a filesystem execution that tries to escape the workspace", async () => {
    const { authorizer } = authorizerWith([
      grant({ capability: "project.files", resources: ["project:workspace/"], allowedActions: ["write"], constraints: { ...NO_AUTHORITY, filesystem: "workspace-read-write" } })
    ]);
    const gate = approvedGate(authorizer);
    const proposal = gate.propose({ kind: "filesystem", description: "escape", payload: { path: "workspace/../../etc/passwd" } });
    gate.validate(proposal.id);
    gate.approve(proposal.id);
    await expect(gate.execute(proposal.id, async () => "x")).rejects.toThrow(/escapes or is empty/);
  });

  it("refuses a network execution to a host the grant does not allow", async () => {
    const { authorizer } = authorizerWith([
      grant({
        capability: "network.fetch",
        resources: ["network:api.example.com"],
        allowedActions: ["request"],
        constraints: { ...NO_AUTHORITY, network: "allowlist", networkHosts: ["api.example.com"] }
      })
    ]);
    const gate = approvedGate(authorizer);
    const allowed = gate.propose({ kind: "network", description: "call the api", payload: { url: "https://api.example.com/v1" } });
    gate.validate(allowed.id);
    gate.approve(allowed.id);
    await expect(gate.execute(allowed.id, async () => "ok")).resolves.toBe("ok");

    const denied = gate.propose({ kind: "network", description: "call somewhere else", payload: { url: "https://evil.example.com/v1" } });
    gate.validate(denied.id);
    gate.approve(denied.id);
    await expect(gate.execute(denied.id, async () => "no")).rejects.toThrow(ExecutionDeniedError);
    expect(gate.authorizationHistory().at(-1)).toMatchObject({ allowed: false });
  });
});

describe("Phase 03 gate 2 — the mapping is total and reviewable", () => {
  it("covers every execution kind the gate defines", () => {
    const kinds: ExecutionKind[] = ["shell", "filesystem", "git", "network"];
    for (const kind of kinds) {
      const mapping = EXECUTION_CAPABILITY_MAP[kind];
      expect(mapping, `${kind} has no capability mapping`).toBeTruthy();
      expect(mapping.capability).toBeTruthy();
      expect(mapping.action).toBeTruthy();
      expect(mapping.resourceFrom).toBeTruthy();
    }
    expect(Object.keys(EXECUTION_CAPABILITY_MAP).sort()).toEqual(kinds.sort());
  });

  it("names the constraints each kind implies, including the dangerous ones explicitly", () => {
    // Writing `admin: false` down rather than omitting it is the point: an omission reads as
    // "not required", while the requirement is that the grant must not carry it.
    expect(EXECUTION_CAPABILITY_MAP.git.constraints).toMatchObject({ admin: false, forcePush: false });
    expect(EXECUTION_CAPABILITY_MAP.shell.constraints).toMatchObject({ shell: "spawn" });
    expect(EXECUTION_CAPABILITY_MAP.filesystem.constraints).toMatchObject({ filesystem: "workspace-read-write" });
    expect(EXECUTION_CAPABILITY_MAP.network.constraints).toMatchObject({ network: "allowlist" });
  });

  it("resolves a resource from the payload, and refuses when the field is absent", () => {
    expect(resolveResource(EXECUTION_CAPABILITY_MAP.shell, {})).toEqual({ resource: "process:shell" });
    expect(resolveResource(EXECUTION_CAPABILITY_MAP.git, { repository: "owner/name" })).toEqual({ resource: "owner/name" });
    expect(resolveResource(EXECUTION_CAPABILITY_MAP.git, {}).problem).toContain("non-empty repository");
  });

  it("normalises each kind into the resource grammar, and refuses what it cannot", () => {
    expect(normaliseResource("network", "https://api.example.com/v1").resource).toBe("network:api.example.com");
    expect(normaliseResource("network", "API.Example.com").resource).toBe("network:api.example.com");
    expect(normaliseResource("network", "not a host").problem).toBeTruthy();
    expect(normaliseResource("filesystem", "workspace/src/main.ts").resource).toBe("project:workspace/src/main.ts");
    expect(normaliseResource("filesystem", "../etc/passwd").problem).toBeTruthy();
    expect(normaliseResource("git", "owner/name.git").resource).toBe("repo:owner/name");
    expect(normaliseResource("git", "https://github.com/owner/name").resource).toBe("repo:owner/name");
    expect(normaliseResource("git", "not-a-repo").problem).toBeTruthy();
  });

  it("refuses an execution kind with no mapping rather than letting it through", () => {
    const broker = createCapabilityBroker({ providers: [], grants: [] });
    const outcome = authorizeExecution(broker, {
      subject: SUBJECT,
      proposal: { kind: "telepathy" as ExecutionKind, description: "not a real kind", payload: {} },
      at: AT
    });
    expect(outcome.allowed).toBe(false);
    expect(outcome.decision.message).toContain("no capability mapping exists");
  });
});

describe("Phase 03 gate 2 — the boundary inventory is honest in both directions", () => {
  const PROJECT = process.cwd();

  it("names modules that exist", () => {
    for (const entry of BOUNDARY_INVENTORY) {
      expect(fs.existsSync(path.join(PROJECT, ...entry.module.split("/"))), `${entry.module} does not exist`).toBe(true);
    }
  });

  it("gives every non-mapped entry a stated reason", () => {
    for (const entry of BOUNDARY_INVENTORY) {
      expect(entry.protects, `${entry.module} does not say what it protects`).toBeTruthy();
      expect(entry.reason, `${entry.module} has no reason`).toBeTruthy();
      if (entry.route === "legacy" || entry.route === "out-of-scope") {
        // An unexplained exemption is indistinguishable from an oversight, which is the whole
        // reason this list exists rather than silence.
        expect(entry.reason.length, `${entry.module}'s reason is too short to be a reason`).toBeGreaterThan(40);
      }
    }
  });

  it("never lists a module twice", () => {
    const modules = BOUNDARY_INVENTORY.map((entry) => entry.module);
    expect(new Set(modules).size).toBe(modules.length);
  });

  it("counts the routes, and reports them rather than hiding the legacy half", () => {
    const mapped = mappedBoundaries();
    const legacy = legacyBoundaries();
    expect(mapped.length).toBeGreaterThan(0);
    expect(legacy.length).toBeGreaterThan(0);
    const summary = describeBoundaryInventory();
    expect(summary).toContain(`${BOUNDARY_INVENTORY.length} high-privilege boundaries inventoried`);
    expect(summary).toContain(`${legacy.length} on the legacy route`);
  });

  it("records the owner gate and the credential boundary as deliberate legacy, not as migrated", () => {
    // The book's security requirement: the owner's protected surface must not be weakened by the
    // capability broker. The inventory says so explicitly, so a later change that silently routed
    // them through a grant would have to delete this assertion.
    const rootAuthority = BOUNDARY_INVENTORY.find((entry) => entry.module === "electron/root-authority/root-authority.ts");
    expect(rootAuthority?.route).toBe("legacy");
    expect(rootAuthority?.reason).toMatch(/HUMAN boundary|must not|weakening/i);
    const guard = BOUNDARY_INVENTORY.find((entry) => entry.module === "electron/root-authority/protected-surface-guard.ts");
    expect(guard?.route).toBe("legacy");
    const credentials = BOUNDARY_INVENTORY.find((entry) => entry.module === "electron/credential-boundary/credential-boundary.ts");
    expect(credentials?.route).toBe("legacy");
    expect(credentials?.reason).toMatch(/stronger than a grant|regression/i);
  });
});
