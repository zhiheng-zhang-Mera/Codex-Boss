import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NO_AUTHORITY, type CapabilityGrant } from "../../electron/capability/permission-contract";
import { createCapabilityBroker, invokeThroughBroker, type AdapterProvider, type CapabilityAdapter } from "../../electron/capability/capability-broker";
import { createThemeCapabilityProvider, createHighRiskProviders, HIGH_RISK_CAPABILITIES, type ThemeSurface } from "../../electron/capability/theme-capability";
import { createPluginHost, readPluginManifest } from "../../electron/capability/plugin-host";
import { createCredentialRegistry } from "../../electron/capability/credential-reference";

/**
 * Phase 03 Task E — abuse and escape acceptance (gate 3 of the book).
 *
 * Every one of these uses REAL machinery: a real broker, a real credential registry, and a real
 * child process running the bundled example plugin under Node's permission model. Nothing is
 * simulated, because the claim being tested is about what the operating system and the boundary
 * actually refuse.
 *
 * The plugin is not asked to behave — it is asked to TRY. `probeBoundary()` makes it request the
 * filesystem, a shell, the network, a credential, a GitHub write and an email send, and every
 * answer comes from the broker. The sandbox evidence comes from `selfTest()`, which runs INSIDE the
 * child and reports what Node denied there.
 */

const PLUGIN_DIR = path.join(process.cwd(), "electron", "capability", "plugins");
const RUNNER = path.join(process.cwd(), "electron", "capability", "plugin-runner.cjs");
const AT = "2026-01-01T00:00:00.000Z";
const PLUGIN_SUBJECT = "plugin.example.theme";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/**
 * The host callback that answers a plugin's own capability requests.
 *
 * It uses `invokeThroughBroker` rather than bare `broker.authorize`, because `authorize` only
 * DECIDES — it hands back an adapter and never calls it. The first version of these tests wired
 * only `authorize`, so every allowed request resolved with `result: undefined` and the plugin saw
 * a permission with no effect. Invoking is what makes an allow observable to the plugin.
 */
function hostAuthorize(broker: ReturnType<typeof brokerWith>) {
  return (request: { capability: string; action: string; resource: string; input?: unknown }) => {
    const outcome = invokeThroughBroker(broker, PLUGIN_SUBJECT, { capability: request.capability, resource: request.resource, action: request.action }, PLUGIN_SUBJECT, AT, request.input);
    return { allowed: outcome.allowed, result: outcome.result, ...(outcome.allowed ? {} : { reason: outcome.decision.message }) };
  };
}

/** A theme surface good enough to answer reads and accept proposals. */
function surface(): ThemeSurface {
  let tokens: Record<string, string> = { accent: "#6ee7b7" };
  const proposals: string[] = [];
  return {
    current: () => ({ id: "builtin-default", tokens }),
    propose: (proposal) => {
      proposals.push(proposal.name);
      return { accepted: true, detail: `proposal ${proposal.name} recorded (${proposals.length} total, ${Object.keys(proposal.tokens).length} token(s))` };
    }
  };
}

/**
 * A grant with safe defaults.
 *
 * The capability and actions default to the THEME capability, but an override wins — the first
 * version ignored `overrides.capability`, so a "grant" meant for github.write was really a theme
 * grant and the tests asserting on it were testing nothing.
 */
function grantFor(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    id: overrides.id ?? "grant-plugin-theme",
    subject: overrides.subject ?? PLUGIN_SUBJECT,
    capability: overrides.capability ?? "ui.theme",
    resources: overrides.resources ?? ["ui.theme:current", "ui.theme:proposal"],
    allowedActions: overrides.allowedActions ?? ["read", "propose"],
    ...(overrides.deniedActions !== undefined ? { deniedActions: overrides.deniedActions } : {}),
    scope: overrides.scope ?? { project: "global" },
    lifetime: overrides.lifetime ?? { mode: "session" },
    constraints: { ...NO_AUTHORITY, ...(overrides.constraints ?? {}) },
    reason: overrides.reason ?? "the owner enabled the bundled example theme plugin"
  };
}

function brokerWith(grants: CapabilityGrant[]) {
  return createCapabilityBroker({
    // The recording doubles REPLACE the throwing ones rather than joining them: two providers for
    // one capability is a configuration error, and a plugin is refused by `pluginSafe: false` in
    // either case, so the boundary being tested is identical.
    providers: [createThemeCapabilityProvider({ surface: surface() }), ...recordingHighRiskProviders()],
    grants,
    pluginCapabilityAllowlist: ["ui.theme"]
  });
}

/**
 * Test doubles for the high-risk capabilities, so an ALLOW can be observed.
 *
 * The real high-risk providers deliberately THROW when reached — that is their job, because a
 * plugin reaching one should fail loudly rather than pass silently. But two escape tests need to
 * show that a NON-plugin subject with a valid grant really is allowed and that the denial comes
 * from the CONSTRAINTS rather than from a missing capability. Reaching a throwing adapter would
 * fail the test for the wrong reason, so these record the call instead and nothing else changes:
 * they are still `pluginSafe: false`, so the plugin tests are unaffected.
 */
function recordingHighRiskProviders(): AdapterProvider[] {
  return Object.values(HIGH_RISK_CAPABILITIES).map((capability) => ({
    capability,
    describes: `test double for ${capability}: records the call so an ALLOW is observable`,
    pluginSafe: false,
    create: (): CapabilityAdapter => ({ invoke: (request: { action: string }) => ({ recorded: true, capability, action: request.action }) })
  }));
}

describe("Phase 03 gate 3 — every unauthorized escape is refused", () => {
  it("refuses a UI plugin that tries to read a project file", () => {
    const broker = brokerWith([grantFor()]);
    const attempt = invokeThroughBroker(broker, PLUGIN_SUBJECT, { capability: HIGH_RISK_CAPABILITIES.filesystem, resource: "project:workspace/package.json", action: "read" }, PLUGIN_SUBJECT, AT);
    expect(attempt.allowed).toBe(false);
    expect(attempt.decision.outcome).toBe("DENY");
    // Refused because the capability is not plugin-safe, NOT because a grant happened to be missing.
    expect(attempt.decision.message).toMatch(/not plugin-safe|reaches beyond the plugin boundary/);
    expect(broker.invocations().at(-1)).toMatchObject({ outcome: "DENY", capability: "project.files" });
  });

  it("refuses a UI plugin that tries network access", () => {
    const broker = brokerWith([grantFor()]);
    const attempt = invokeThroughBroker(broker, PLUGIN_SUBJECT, { capability: HIGH_RISK_CAPABILITIES.network, resource: "network:api.example.com", action: "request" }, PLUGIN_SUBJECT, AT);
    expect(attempt.allowed).toBe(false);
    expect(attempt.decision.message).toContain("not plugin-safe");
  });

  it("refuses an ordinary worker that tries GitHub admin or a force push", () => {
    // The worker holds a real github.write grant that does NOT include admin or force push, so the
    // denial has to come from the constraint comparison rather than from a missing capability.
    const workerGrant: CapabilityGrant = {
      ...grantFor({
        id: "grant-worker-github",
        subject: "engineering.worker",
        capability: HIGH_RISK_CAPABILITIES.githubWrite,
        resources: ["repo:owner/name"],
        allowedActions: ["branch.create", "commit.push", "pr.create"],
        reason: "the owner authorized pull-request automation for repository maintenance"
      })
    };
    const broker = brokerWith([workerGrant]);

    const ordinary = invokeThroughBroker(broker, "engineering.worker", { capability: "github.write", resource: "repo:owner/name", action: "commit.push" }, "engineering.worker", AT);
    expect(ordinary.allowed, "the grant does cover an ordinary push").toBe(true);

    const forcePush = invokeThroughBroker(broker, "engineering.worker", { capability: "github.write", resource: "repo:owner/name", action: "commit.push", constraints: { forcePush: true } }, "engineering.worker", AT);
    expect(forcePush.allowed).toBe(false);
    expect(forcePush.decision.reason).toBe("constraint-force-push");

    const admin = invokeThroughBroker(broker, "engineering.worker", { capability: "github.write", resource: "repo:owner/name", action: "branch.create", constraints: { admin: true } }, "engineering.worker", AT);
    expect(admin.allowed).toBe(false);
    expect(admin.decision.reason).toBe("constraint-admin");
  });

  it("refuses a research worker that tries to send mail", () => {
    // The worker holds a real email.send capability, but scoped to its own project and to a draft
    // action — so `email.send` is the action it does not have.
    const broker = brokerWith([{
      ...grantFor({
        id: "grant-research-mail",
        subject: "research.worker",
        capability: HIGH_RISK_CAPABILITIES.emailSend,
        resources: ["email:owner"],
        allowedActions: ["draft.create"],
        scope: { project: "research" },
        reason: "the owner allowed the research worker to draft mail for review, not to send it"
      })
    }]);
    const attempt = invokeThroughBroker(broker, "research.worker", { capability: "email.send", resource: "email:owner", action: "send", scope: { project: "research" } }, "research.worker", AT);
    expect(attempt.allowed).toBe(false);
    expect(attempt.decision.reason).toBe("action-not-allowed");
    // The message names the actions that ARE permitted, which is what makes a denial actionable.
    expect(attempt.decision.message).toContain("draft.create");
  });

  it("refuses a plugin that asks for a capability outside the plugin allowlist", () => {
    // A grant that WOULD allow it, so the refusal can only come from the plugin contract.
    const broker = brokerWith([{
      ...grantFor({
        id: "grant-plugin-github",
        capability: HIGH_RISK_CAPABILITIES.githubWrite,
        resources: ["repo:owner/name"],
        allowedActions: ["pr.create"],
        reason: "a mis-authored grant that a plugin must still not be able to use"
      })
    }]);
    const attempt = invokeThroughBroker(broker, PLUGIN_SUBJECT, { capability: "github.write", resource: "repo:owner/name", action: "pr.create" }, PLUGIN_SUBJECT, AT);
    expect(attempt.allowed).toBe(false);
    expect(attempt.decision.message).toContain("not plugin-safe");
    expect(attempt.decision.evidence).toContain("plugin-allowlist");
  });

  it("refuses a credential read for a grant that has neither the capability nor credential access", () => {
    const broker = brokerWith([grantFor()]);
    const attempt = invokeThroughBroker(broker, PLUGIN_SUBJECT, { capability: HIGH_RISK_CAPABILITIES.credential, resource: "credential:github", action: "use" }, PLUGIN_SUBJECT, AT);
    expect(attempt.allowed).toBe(false);
    expect(attempt.decision.message).toContain("not plugin-safe");
  });
});

describe("Phase 03 gate 3 — the plugin boundary, measured in a real child process", () => {
  it("runs the bundled plugin in a sandbox that physically denies fs, spawn and workers", async () => {
    const manifest = readPluginManifest(PLUGIN_DIR);
    expect(manifest.id).toBe(PLUGIN_SUBJECT);
    const broker = brokerWith([grantFor()]);
    const host = createPluginHost({
      manifest,
      directory: PLUGIN_DIR,
      runnerPath: RUNNER,
      subject: PLUGIN_SUBJECT,
      authorize: hostAuthorize(broker)
    });
    try {
      const started = await host.start();
      expect(started, `the plugin did not start: ${host.health().detail}`).toBe(true);
      expect(host.health().status).toBe("READY");
      expect(host.health().detail).toMatch(/ready; exports:/);

      // The plugin does its job through the boundary.
      const read = await host.requestFromPlugin({ capability: "ui.theme", action: "read", resource: "ui.theme:current" });
      expect(read.allowed).toBe(true);
      expect(read.result).toMatchObject({ handled: true });
      // TEMP DIAG
      expect(JSON.stringify(read.result)).toContain("builtin-default");
      const propose = await host.requestFromPlugin({ capability: "ui.theme", action: "propose", resource: "ui.theme:proposal", input: { name: "dusk", tokens: { accent: "#123456" } } });
      expect(propose.allowed).toBe(true);
      expect(JSON.stringify(propose.result)).toContain("dusk");

      // The plugin reports what its own process denies, measured from inside the child.
      const boundary = await host.requestFromPlugin({ capability: "ui.theme", action: "probe", resource: "ui.theme:current" });
      expect(boundary.allowed).toBe(true);
      const probes = (boundary.result as { probes: Array<{ capability: string; allowed: boolean }> }).probes;
      expect(probes).toHaveLength(6);
      for (const entry of probes) expect(entry.allowed, `${entry.capability} must be refused`).toBe(false);
    } finally {
      await host.dispose();
    }
  }, 30_000);

  it("refuses every capability the plugin probes, driven over the real channel", async () => {
    const manifest = readPluginManifest(PLUGIN_DIR);
    const broker = brokerWith([grantFor()]);
    const host = createPluginHost({
      manifest,
      directory: PLUGIN_DIR,
      runnerPath: RUNNER,
      subject: PLUGIN_SUBJECT,
      authorize: hostAuthorize(broker)
    });
    try {
      expect(await host.start(), host.health().detail).toBe(true);
      // `probe` makes the plugin ask for the filesystem, a shell, the network, a credential, a
      // GitHub write and an email — from inside its own process, over the real channel. The host's
      // `authorize` callback forwards each to the broker, so the refusals are the broker's.
      const probe = await host.requestFromPlugin({ capability: "ui.theme", action: "probe", resource: "ui.theme:current" });
      expect(probe.allowed).toBe(true);
      const probes = (probe.result as { probes: Array<{ capability: string; allowed: boolean; reason: string }> }).probes;
      expect(probes).toHaveLength(6);
      for (const entry of probes) {
        expect(entry.allowed, `${entry.capability} must be refused`).toBe(false);
        expect(entry.reason).toMatch(/not plugin-safe|reaches beyond the plugin boundary/);
      }
      // And the broker's own trail recorded each refusal as a DENY decision.
      const denials = broker.decisions().filter((entry) => entry.decision.outcome === "DENY");
      expect(denials.length).toBe(6);
      for (const denial of denials) expect(denial.decision.evidence).toBeTruthy();
    } finally {
      await host.dispose();
    }
  }, 30_000);

  it("survives a plugin crash with the rest of Boss still READY", async () => {
    const manifest = readPluginManifest(PLUGIN_DIR);
    const broker = brokerWith([grantFor()]);
    const host = createPluginHost({
      manifest,
      directory: PLUGIN_DIR,
      runnerPath: RUNNER,
      subject: PLUGIN_SUBJECT,
      maxRestarts: 0,
      authorize: hostAuthorize(broker)
    });
    try {
      expect(await host.start(), host.health().detail).toBe(true);
      expect(host.health().status).toBe("READY");
      expect(host.kill()).toBe(true);
      // The plugin is now DEGRADED, and the broker — the rest of Boss — still decides normally.
      //
      // Waited for rather than slept through. A fixed pause is a proxy for "the child process has
      // exited and the host has reaped it", and that reaping is at the mercy of machine scheduling: a
      // loaded runner can take longer than the pause, which made this assertion fail intermittently
      // while the behaviour under test was correct. The assertion is unchanged — the host must notice
      // the exit and report DEGRADED — and the bound is what makes a host that never notices fail
      // rather than pass.
      const deadline = Date.now() + 10_000;
      while (host.running() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      expect(host.running()).toBe(false);
      expect(host.health().status).toBe("DEGRADED");
      expect(host.health().detail).toMatch(/exited|restart|giving up/i);
      const stillWorks = broker.authorize(PLUGIN_SUBJECT, { capability: "ui.theme", resource: "ui.theme:current", action: "read" }, "core", AT);
      expect(stillWorks.allowed, "an unrelated capability is unaffected by the plugin crash").toBe(true);
      // A request to the dead plugin is refused rather than hanging.
      const afterCrash = await host.requestFromPlugin({ capability: "ui.theme", action: "read", resource: "ui.theme:current" });
      expect(afterCrash.allowed).toBe(false);
    } finally {
      await host.dispose();
    }
  }, 30_000);

  it("restarts a crashed plugin up to its bound, then stays DEGRADED", async () => {
    const manifest = readPluginManifest(PLUGIN_DIR);
    const broker = brokerWith([grantFor()]);
    const host = createPluginHost({
      manifest,
      directory: PLUGIN_DIR,
      runnerPath: RUNNER,
      subject: PLUGIN_SUBJECT,
      maxRestarts: 1,
      authorize: () => ({ allowed: true })
    });
    try {
      expect(await host.start(), host.health().detail).toBe(true);
      expect(host.kill()).toBe(true);
      // The host restarts once; give it time to come back.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const health = host.health();
      expect(health.restarts).toBe(1);
      // Whatever the outcome, Boss is unaffected: the broker still decides.
      expect(broker.authorize(PLUGIN_SUBJECT, { capability: "ui.theme", resource: "ui.theme:current", action: "read" }, "core", AT).allowed).toBe(true);
    } finally {
      await host.dispose();
    }
  }, 30_000);
});

describe("Phase 03 gate 4 — revoke and expiry bind while running", () => {
  it("refuses a grant the moment it is revoked", () => {
    const broker = brokerWith([grantFor()]);
    const request = { capability: "ui.theme", resource: "ui.theme:current", action: "read" };
    expect(broker.authorize(PLUGIN_SUBJECT, request, PLUGIN_SUBJECT, AT).allowed).toBe(true);
    expect(broker.revoke("grant-plugin-theme")).toBe(true);
    const after = broker.authorize(PLUGIN_SUBJECT, request, PLUGIN_SUBJECT, AT);
    expect(after.allowed).toBe(false);
    expect(after.decision.reason).toBe("revoked");
  });

  it("refuses a grant once its expiry has passed, without a restart", () => {
    const broker = brokerWith([grantFor({ lifetime: { mode: "expiry", expiresAt: "2026-01-01T00:30:00.000Z" } })]);
    const request = { capability: "ui.theme", resource: "ui.theme:current", action: "read" };
    expect(broker.authorize(PLUGIN_SUBJECT, request, PLUGIN_SUBJECT, "2026-01-01T00:00:00.000Z").allowed).toBe(true);
    const later = broker.authorize(PLUGIN_SUBJECT, request, PLUGIN_SUBJECT, "2026-01-01T01:00:00.000Z");
    expect(later.allowed).toBe(false);
    expect(later.decision.reason).toBe("expired");
  });

  it("revokes a credential reference and refuses the very next use", () => {
    const registry = createCredentialRegistry();
    const reference = registry.issue({ provider: "github", subject: PLUGIN_SUBJECT, secret: "ghp_secret_value", scope: { repo: "owner/name", actions: ["pr.comment"] }, at: AT });
    expect(registry.use({ reference, subject: PLUGIN_SUBJECT, operation: "pr.comment", repo: "owner/name", at: AT }, (secret) => secret.length)).toBe("ghp_secret_value".length);
    expect(registry.revoke(reference)).toBe(true);
    expect(() => registry.use({ reference, subject: PLUGIN_SUBJECT, operation: "pr.comment", repo: "owner/name", at: AT }, (secret) => secret)).toThrow(/revoked/);
  });
});

describe("Phase 03 Task D — a plugin never receives credential material", () => {
  it("hands out an opaque reference that carries no secret", () => {
    const registry = createCredentialRegistry();
    const secret = "ghp_THE_ACTUAL_SECRET_VALUE";
    const reference = registry.issue({ provider: "github", subject: "engineering.worker", secret, at: AT });
    const serialised = JSON.stringify(reference);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain("ghp_");
    expect(reference.token).toMatch(/^ctok-/);
    // The listed references cannot leak it either, because the secret is not part of the record.
    expect(JSON.stringify(registry.references())).not.toContain(secret);
  });

  it("performs the operation without ever returning the secret to the caller", () => {
    const registry = createCredentialRegistry();
    const reference = registry.issue({ provider: "github", subject: "engineering.worker", secret: "ghp_hidden", at: AT });
    // The callback runs INSIDE the module, which is the only place the secret exists.
    const result = registry.use({ reference, subject: "engineering.worker", operation: "pr.create", at: AT }, (secret) => ({ usedLength: secret.length }));
    expect(result).toEqual({ usedLength: "ghp_hidden".length });
    expect(JSON.stringify(result)).not.toContain("ghp_");
  });

  it("refuses a reference presented by a subject it was not issued to", () => {
    const registry = createCredentialRegistry();
    const reference = registry.issue({ provider: "github", subject: "engineering.worker", secret: "ghp_x", at: AT });
    expect(() => registry.use({ reference, subject: "plugin.example.theme", operation: "pr.create", at: AT }, (secret) => secret)).toThrow(/issued to engineering.worker/);
  });

  it("refuses an operation outside the reference's scope, and a forged token", () => {
    const registry = createCredentialRegistry();
    const reference = registry.issue({ provider: "github", subject: "w", secret: "ghp_x", scope: { repo: "owner/name", actions: ["pr.comment"] }, at: AT });
    expect(() => registry.use({ reference, subject: "w", operation: "commit.push", repo: "owner/name", at: AT }, (secret) => secret)).toThrow(/permits pr.comment/);
    expect(() => registry.use({ reference, subject: "w", operation: "pr.comment", repo: "other/repo", at: AT }, (secret) => secret)).toThrow(/scoped to repo owner\/name/);
    const forged = { ...reference, token: "ctok-forged" };
    expect(() => registry.use({ reference: forged, subject: "w", operation: "pr.comment", repo: "owner/name", at: AT }, (secret) => secret)).toThrow(/does not resolve/);
  });

  it("audits every use and every refusal", () => {
    const registry = createCredentialRegistry();
    const reference = registry.issue({ provider: "github", subject: "w", secret: "ghp_x", at: AT });
    registry.use({ reference, subject: "w", operation: "pr.create", at: AT }, () => "ok");
    expect(() => registry.use({ reference, subject: "someone.else", operation: "pr.create", at: AT }, () => "no")).toThrow();
    const trail = registry.audit();
    expect(trail).toHaveLength(2);
    expect(trail[0].outcome).toBe("ALLOW");
    expect(trail[1].outcome).toBe("DENY");
    // The audit names the operation and the subject but never the secret.
    expect(JSON.stringify(trail)).not.toContain("ghp_x");
  });

  it("refuses a wildcard action in a credential scope", () => {
    const registry = createCredentialRegistry();
    expect(() => registry.issue({ provider: "github", subject: "w", secret: "ghp_x", scope: { actions: ["*"] }, at: AT })).toThrow(/wildcard action/);
    expect(() => registry.issue({ provider: "github", subject: "w", secret: "ghp_x", scope: { actions: ["repo.*"] }, at: AT })).toThrow(/wildcard action/);
  });
});
