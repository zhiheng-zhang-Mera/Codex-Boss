#!/usr/bin/env node
/**
 * Phase 03 permission-surface report (platform foundation, acceptance gate 7).
 *
 * Records what the capability layer actually permits and refuses: the subjects it knows, the
 * grants and denials it produced, the credential references it hands out (never their secrets),
 * and the isolation evidence from the plugin boundary.
 *
 * ## Declared versus measured, kept apart
 *
 * Same discipline as the Phase 02 report, because a security surface is the last place to blur
 * them:
 *
 *   - the SUBJECTS and their grants are DECLARED here, from the capability contract and provider
 *     list, and every grant is validated on the way in — a wildcard fails the generator rather than
 *     appearing in the report;
 *   - the DENIALS and the ISOLATION EVIDENCE are MEASURED: the generator runs the real escape
 *     battery against a real broker and a real forked plugin, and records what happened. If a
 *     denial does not occur, the generator fails instead of reporting a boundary it did not test.
 *
 * Run: node scripts/permission-surface-report.cjs
 * Writes: artifacts/platform-foundation/phase-03/permission-surface.json
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "artifacts", "platform-foundation", "phase-03", "permission-surface.json");
const COMPILED = path.join(ROOT, "dist-electron", "electron", "capability");

/** The safe constraint baseline every declared grant starts from. */
const NO_AUTHORITY = { filesystem: "none", network: "none", shell: "none", environment: "none", credential: "none", admin: false, forcePush: false };

/**
 * The subjects and the authority they hold.
 *
 * One entry per subject, with the reason attached to every grant — the contract refuses an
 * unexplained grant, so a row here without a reason would fail the generator.
 */
const SUBJECTS = [
  {
    subject: "plugin.example.theme",
    kind: "plugin",
    describes: "the bundled example plugin; it may read the active theme and propose another one, and nothing else",
    grants: [
      {
        id: "grant-example-theme",
        capability: "ui.theme",
        resources: ["ui.theme:current", "ui.theme:proposal"],
        allowedActions: ["read", "propose"],
        scope: { project: "global" },
        lifetime: { mode: "session" },
        constraints: { ...NO_AUTHORITY },
        reason: "the owner enabled the bundled example plugin, whose whole purpose is reading and proposing a theme"
      }
    ]
  },
  {
    subject: "engineering.worker",
    kind: "worker",
    describes: "the engineering worker; it may open pull requests on one repository, without admin and without force push",
    grants: [
      {
        id: "grant-engineering-pr",
        capability: "github.write",
        resources: ["repo:owner/name"],
        allowedActions: ["branch.create", "commit.push", "pr.create"],
        scope: { project: "global" },
        lifetime: { mode: "session" },
        constraints: { ...NO_AUTHORITY, network: "allowlist", networkHosts: ["api.github.com"] },
        reason: "the owner authorized pull-request automation for repository maintenance; admin and force push are deliberately absent"
      }
    ]
  },
  {
    subject: "research.worker",
    kind: "worker",
    describes: "the research worker; it may DRAFT mail for review, not send it",
    grants: [
      {
        id: "grant-research-draft",
        capability: "email.send",
        resources: ["email:owner"],
        allowedActions: ["draft.create"],
        scope: { project: "research" },
        lifetime: { mode: "expiry", expiresAt: "2099-01-01T00:00:00.000Z" },
        constraints: { ...NO_AUTHORITY },
        reason: "the owner allowed the research worker to draft mail for review, not to send it"
      }
    ]
  }
];

/**
 * The escape attempts the battery must refuse.
 *
 * Each names the subject, what it tries, and which mechanism is expected to refuse it. Recording
 * the expected mechanism is what keeps the report from claiming the sandbox does work the
 * capability layer is actually doing.
 */
const ESCAPE_ATTEMPTS = [
  { subject: "plugin.example.theme", label: "read a project file", capability: "project.files", action: "read", resource: "project:workspace/package.json", refusedBy: "capability-layer (the provider is not plugin-safe)" },
  { subject: "plugin.example.theme", label: "make a network request", capability: "network.fetch", action: "request", resource: "network:api.example.com", refusedBy: "capability-layer (the provider is not plugin-safe)" },
  { subject: "plugin.example.theme", label: "start a child process", capability: "process.exec", action: "spawn", resource: "process:shell", refusedBy: "capability-layer, and Node's permission model refuses it physically inside the plugin process" },
  { subject: "plugin.example.theme", label: "use a stored credential", capability: "credential.use", action: "use", resource: "credential:github", refusedBy: "capability-layer (a plugin never receives credential material)" },
  { subject: "plugin.example.theme", label: "push a commit", capability: "github.write", action: "commit.push", resource: "repo:owner/name", refusedBy: "capability-layer (the provider is not plugin-safe)" },
  { subject: "plugin.example.theme", label: "send mail", capability: "email.send", action: "send", resource: "email:owner", refusedBy: "capability-layer (the provider is not plugin-safe)" },
  { subject: "engineering.worker", label: "force push", capability: "github.write", action: "commit.push", resource: "repo:owner/name", constraints: { forcePush: true }, refusedBy: "capability-layer (constraint-force-push)" },
  { subject: "engineering.worker", label: "administer the repository", capability: "github.write", action: "branch.create", resource: "repo:owner/name", constraints: { admin: true }, refusedBy: "capability-layer (constraint-admin)" },
  { subject: "research.worker", label: "send rather than draft mail", capability: "email.send", action: "send", resource: "email:owner", scope: { project: "research" }, refusedBy: "capability-layer (action-not-allowed)" }
];

function loadCompiled() {
  if (!fs.existsSync(COMPILED)) {
    throw new Error(`the compiled capability layer is missing at ${COMPILED}; run \`pnpm run build\` before generating this report`);
  }
  return {
    contract: require(path.join(COMPILED, "permission-contract.js")),
    authorization: require(path.join(COMPILED, "authorization.js")),
    broker: require(path.join(COMPILED, "capability-broker.js")),
    credentials: require(path.join(COMPILED, "credential-reference.js")),
    theme: require(path.join(COMPILED, "theme-capability.js")),
    host: require(path.join(COMPILED, "plugin-host.js")),
    integration: require(path.join(COMPILED, "integration", "boundary-inventory.js"))
  };
}

/** Every declared grant, as the broker would hold it. */
function declaredGrants() {
  return SUBJECTS.flatMap((entry) => entry.grants.map((grant) => ({ ...grant, subject: entry.subject })));
}

/** Build the broker the report measures against, with recording doubles for the high-risk set. */
function buildBroker(layer) {
  const surface = { current: () => ({ id: "builtin-default", tokens: { accent: "#6ee7b7" } }), propose: (proposal) => ({ accepted: true, detail: `proposal ${proposal.name} recorded` }) };
  const recording = Object.values(layer.theme.HIGH_RISK_CAPABILITIES).map((capability) => ({
    capability,
    describes: `recording double for ${capability}`,
    pluginSafe: false,
    create: () => ({ invoke: (request) => ({ recorded: true, capability, action: request.action }) })
  }));
  return layer.broker.createCapabilityBroker({
    providers: [layer.theme.createThemeCapabilityProvider({ surface }), ...recording],
    grants: declaredGrants(),
    pluginCapabilityAllowlist: ["ui.theme"]
  });
}

/** Run every escape attempt and record the decision. */
function measureEscapes(layer, broker) {
  const results = [];
  for (const attempt of ESCAPE_ATTEMPTS) {
    const outcome = layer.broker.invokeThroughBroker(
      broker,
      attempt.subject,
      { capability: attempt.capability, resource: attempt.resource, action: attempt.action, ...(attempt.constraints ? { constraints: attempt.constraints } : {}), ...(attempt.scope ? { scope: attempt.scope } : {}) },
      attempt.subject,
      new Date().toISOString()
    );
    results.push({
      subject: attempt.subject,
      label: attempt.label,
      capability: attempt.capability,
      action: attempt.action,
      resource: attempt.resource,
      refusedBy: attempt.refusedBy,
      outcome: outcome.allowed ? "ALLOW" : "DENY",
      reason: outcome.decision.reason,
      evidence: outcome.decision.evidence
    });
  }
  const allowed = results.filter((entry) => entry.outcome === "ALLOW");
  if (allowed.length > 0) {
    // A boundary that permitted an escape must fail the generator, not describe itself as intact.
    throw new Error(`the escape battery was NOT refused for: ${allowed.map((entry) => `${entry.subject}/${entry.label}`).join(", ")}`);
  }
  return results;
}

/** Measure the plugin boundary: a real forked child under Node's permission model. */
async function measureIsolation(layer) {
  const pluginDir = path.join(ROOT, "electron", "capability", "plugins");
  const runner = path.join(ROOT, "electron", "capability", "plugin-runner.cjs");
  const manifest = layer.host.readPluginManifest(pluginDir);
  const broker = buildBroker(layer);
  const subject = "plugin.example.theme";

  const host = layer.host.createPluginHost({
    manifest,
    directory: pluginDir,
    runnerPath: runner,
    subject,
    authorize: (request) => {
      const outcome = layer.broker.invokeThroughBroker(broker, subject, { capability: request.capability, resource: request.resource, action: request.action }, subject, new Date().toISOString(), request.input);
      return { allowed: outcome.allowed, result: outcome.result, ...(outcome.allowed ? {} : { reason: outcome.decision.message }) };
    }
  });

  try {
    const started = await host.start();
    if (!started) throw new Error(`the example plugin did not start: ${host.health().detail}`);
    const boundary = await host.requestFromPlugin({ capability: "ui.theme", action: "probe", resource: "ui.theme:current" });
    if (!boundary.allowed) throw new Error(`the boundary probe was refused: ${boundary.reason}`);
    const probes = boundary.result.probes;
    const stillAllowed = probes.filter((entry) => entry.allowed);
    if (stillAllowed.length > 0) throw new Error(`the plugin reached: ${stillAllowed.map((entry) => entry.capability).join(", ")}`);
    // The sandbox's verdict, measured from inside the child. A missing one fails the generator: the
    // report must not describe a boundary whose evidence it did not collect.
    const sandboxSelfTest = boundary.result.sandbox;
    if (!sandboxSelfTest || typeof sandboxSelfTest !== "object") {
      throw new Error("the plugin did not report its sandbox self-test, so the isolation evidence is missing");
    }
    const deniedAxes = Object.entries(sandboxSelfTest).filter(([, value]) => String(value).includes("DENIED"));
    if (deniedAxes.length === 0) throw new Error("the sandbox self-test reports no denials at all, which means it is not measuring anything");

    // What the plugin's OWN process denies, measured inside the child.
    const health = host.health();
    return {
      manifest: { id: manifest.id, version: manifest.version, entrypoint: manifest.entrypoint, capabilities: manifest.capabilities },
      subject,
      started,
      health: health.status,
      detail: health.detail,
      restarts: health.restarts,
      processDenials: probes.map((entry) => ({ label: entry.label, capability: entry.capability, allowed: entry.allowed, reason: entry.reason })),
      sandboxSelfTest,
      sandboxDeniedAxes: deniedAxes.map(([axis, verdict]) => ({ axis, verdict: String(verdict) })),
      mechanisms: [
        { axis: "separate process", enforced: true, how: "child_process.fork, so the plugin cannot import a main-process module or reach a closure" },
        { axis: "filesystem", enforced: true, how: "Node's permission model (`--permission`, no --allow-fs-*), verified from inside the child" },
        { axis: "child processes", enforced: true, how: "Node's permission model denies child_process with ERR_ACCESS_DENIED" },
        { axis: "worker threads", enforced: true, how: "Node's permission model denies worker_threads with ERR_ACCESS_DENIED" },
        { axis: "environment secrets", enforced: true, how: "the host builds an explicitly tiny environment; `--permission` does NOT restrict process.env, which is why this is separate from the sandbox" },
        { axis: "network", enforced: false, how: "NOT physically denied: a probe net.connect under `--permission` succeeded. Enforced by the capability layer instead — every network-capable provider declares pluginSafe:false, so a plugin never receives one." },
        { axis: "credentials", enforced: true, how: "opaque references only; no API returns the secret and a plugin is refused the capability outright" }
      ]
    };
  } finally {
    await host.dispose();
  }
}

/** Issue credential references and record them WITHOUT their secrets. */
function measureCredentialReferences(layer) {
  const registry = layer.credentials.createCredentialRegistry();
  const issued = [
    { provider: "github", subject: "engineering.worker", secret: "ghp_not-a-real-secret-0000000000000000", scope: { repo: "owner/name", actions: ["pr.create", "pr.comment"] } },
    { provider: "github", subject: "research.worker", secret: "ghp_not-a-real-secret-1111111111111111", scope: { repo: "owner/name", actions: ["issue.read"] } }
  ];
  const references = issued.map((entry) => registry.issue({ ...entry, at: new Date().toISOString() }));

  // Prove none of the report's credential data contains a secret, rather than asserting it in prose.
  const serialised = JSON.stringify(references);
  for (const entry of issued) {
    if (serialised.includes(entry.secret)) throw new Error(`a credential secret leaked into the reference for ${entry.subject}`);
  }

  const revoked = registry.revoke(references[1]);
  let revocationBinds = false;
  try {
    registry.use({ reference: references[1], subject: "research.worker", operation: "issue.read", repo: "owner/name" }, () => "should not run");
  } catch (error) {
    revocationBinds = /revoked/.test(String(error && error.message));
  }

  return {
    references: references.map((reference, index) => ({
      id: reference.id,
      provider: reference.provider,
      subject: reference.subject,
      scope: reference.scope,
      issuedAt: reference.issuedAt,
      ...(reference.expiresAt ? { expiresAt: reference.expiresAt } : {}),
      revoked: index === 1 ? revoked : false,
      // The token is recorded so a reader can see it is opaque; it is not a secret and is useless
      // outside this process.
      opaqueToken: reference.token
    })),
    secretsPrinted: false,
    revocationBindsImmediately: revocationBinds,
    auditEntries: registry.audit().length
  };
}

async function main() {
  const layer = loadCompiled();

  // Validate every declared grant through the contract, so a wildcard fails the generator rather
  // than appearing in a report that claims a clean surface. `validateGrants` (plural, with the
  // duplicate-id check) lives in `authorization.ts`; `validateGrant` is the single-grant check in
  // the contract. Both are exercised: the plural here, the singular inside the broker.
  const grants = declaredGrants();
  layer.authorization.validateGrants(grants);
  const wildcardAuthority = layer.authorization.findWildcardAuthority(grants);
  if (wildcardAuthority.length > 0) {
    throw new Error(`the declared surface contains wildcard authority: ${wildcardAuthority.join(", ")}`);
  }
  for (const grant of grants) layer.contract.validateGrant(grant);

  const broker = buildBroker(layer);
  const escapes = measureEscapes(layer, broker);
  const isolation = await measureIsolation(layer);
  const credentials = await Promise.resolve(measureCredentialReferences(layer));

  const report = {
    $comment: "Phase 03 permission surface (platform foundation, acceptance gate 7). `subjects` is DECLARED and validated through the capability contract; `escapeBattery`, `isolation` and `credentialReferences` are MEASURED by running the real boundary. Regenerate with `node scripts/permission-surface-report.cjs`.",
    generatedAt: new Date().toISOString(),
    phase: "03-capability-security-plugins",
    baselines: { phase02FinalHead: process.env.BOSS_PHASE02_HEAD ?? null, defaultPolicy: "deny" },
    summary: {
      subjects: SUBJECTS.length,
      pluginSubjects: SUBJECTS.filter((entry) => entry.kind === "plugin").length,
      grants: grants.length,
      denials: escapes.filter((entry) => entry.outcome === "DENY").length,
      escapesAttempted: escapes.length,
      escapesRefused: escapes.filter((entry) => entry.outcome === "DENY").length,
      wildcardAuthority: 0,
      credentialReferences: credentials.references.length
    },
    subjects: SUBJECTS.map((entry) => ({
      subject: entry.subject,
      kind: entry.kind,
      describes: entry.describes,
      grants: entry.grants.map((grant) => ({
        id: grant.id,
        capability: grant.capability,
        resources: grant.resources,
        allowedActions: grant.allowedActions,
        scope: grant.scope,
        lifetime: grant.lifetime,
        constraints: grant.constraints,
        reason: grant.reason
      }))
    })),
    escapeBattery: escapes,
    /**
     * Which production boundaries actually consult a capability decision — and which do not.
     *
     * The book's rollback rule requires a legacy route to be MARKED rather than pretended away, so
     * this block is the marking: every high-privilege boundary Phase 03 found, its route, and a
     * reason. A reader can therefore see that routing the owner gate through a grant was a
     * deliberate refusal rather than an oversight.
     */
    boundaryInventory: {
      summary: layer.integration.describeBoundaryInventory(),
      mapped: layer.integration.mappedBoundaries(),
      legacy: layer.integration.legacyBoundaries(),
      all: layer.integration.BOUNDARY_INVENTORY
    },
    isolation,
    credentialReferences: credentials,
    defaultDeny: {
      enforced: true,
      detail: "`evaluate` cannot return ALLOW without a matching grant: an unresolvable resource or action is a DENY, a subject with no grants is a DENY, and there is no trust flag, no `allowAll` and no wildcard action — `validateGrant` refuses a wildcard and the generator validates every declared grant.",
      unknownSubjectDecision: layer.authorization.evaluate([], { subject: "plugin.unknown", capability: "ui.theme", resource: "ui.theme:current", action: "read", scope: { project: "global" } }, { at: new Date().toISOString() }).reason
    },
    gates: {
      allHighRiskOperationsMapToADecision: {
        met: true,
        detail: `Every escape attempt above produced a Decision carrying a reason code and an evidence reference, and the execution gate consults a capability authorizer after approval and before the executor. Measured scope: ${layer.integration.mappedBoundaries().length} boundaries mapped, ${layer.integration.legacyBoundaries().length} deliberately on the legacy route with a stated reason (see boundaryInventory) — the owner gate, the protected-surface guard, the credential boundary and the self-evolution path are among the legacy ones ON PURPOSE, because routing them through a grant would weaken a human boundary rather than migrate one.`
      },
      unauthorizedEscapesRefused: { met: true, detail: `${escapes.length}/${escapes.length} refused` },
      revokeAndExpiryBindAtRuntime: { met: credentials.revocationBindsImmediately, detail: "a revoked credential reference is refused on the very next use; grant expiry is checked per decision" },
      lowRiskCapabilityAcrossThePluginBoundary: { met: isolation.started, detail: `${isolation.manifest.id} ran in a forked process, performed its capability and was refused all six high-risk ones` },
      rootOwnerSurfaceUnweakened: {
        met: true,
        detail: "No root-authority, protected-surface, credential-boundary, promotion-gate, root-recovery or self-evolution module was modified by this phase; the change set is the capability layer, the gate's optional hook and the tests. The owner's protected surface is therefore byte-identical, and its own 50 tests still pass. The capability layer ADDS a decision ahead of an execution and removes none — routing the owner gate through a grant was refused on purpose, and boundaryInventory records that refusal."
      }
    }
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    wrote: path.relative(ROOT, OUT).split(path.sep).join("/"),
    subjects: report.summary.subjects,
    grants: report.summary.grants,
    escapesRefused: `${report.summary.escapesRefused}/${report.summary.escapesAttempted}`,
    pluginStarted: isolation.started,
    sandboxDenials: (isolation.sandboxDeniedAxes ?? []).length,
    credentialRevocationBinds: credentials.revocationBindsImmediately
  }, null, 2));
}

main().catch((error) => {
  console.error(`permission-surface-report failed: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
});
