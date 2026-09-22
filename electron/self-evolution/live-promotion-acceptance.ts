import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { app, safeStorage } from "electron";
import { createGitHubMachineRuntime } from "../github/github-machine-runtime";
import { appDataUnder } from "../runtime-paths";
import { scanSecrets, redactSecrets } from "../../src/shared/secret-scan";
import { isAmbientOwnerCredential } from "../credential-boundary/credential-boundary";
import { BOSS_CREDENTIAL_REQUIRED_ACTION } from "../credential-boundary/github-credential-provider";
import { GitHubAppPromotionCredentialProvider } from "../credential-boundary/github-app-credential-provider";
import { GitHubPromotionAdapter } from "../promotion-gate/github-promotion-adapter";
import { createRunPromotionController } from "../promotion-gate/promotion-controller";
import { RootAuthority } from "../root-authority/root-authority";
import { createCandidateWorkspace, candidateChangedFiles, commitCandidate } from "../stable-candidate/workspace-manager";
import { resolveEvolutionRoot } from "../stable-candidate/evolution-root-policy";
import { evolutionLayout, verifyRuntimeSeparation } from "../stable-candidate/runtime-isolation";
import { runGitOrThrow, GIT_MAX_BUFFER_BYTES } from "../git/git-gateway";
import { createEvolutionGovernance, createGitHostHandlers } from "./self-evolution-host";
import { EvolutionHostOperations } from "./host-operations";
import type { EvolutionRunContext } from "./mutation-context";
import { promoteCandidateOverGitHub } from "./remote-promotion";
import { attemptIdentity, reportPaths, terminalFailureReason, writeAttemptReport } from "./live-acceptance-reporting";

/**
 * Live acceptance of the Self-Evolution promotion path acting with the EXISTING GitHub App machine identity
 * (`codex-boss[bot]`), not a second credential architecture.
 *
 * ## What it does, and why each step is here
 *
 *   1. resolves the machine identity from the SAME vault the production composition root reads;
 *   2. measures the App's own permission set from the installation-token response, and probes one
 *      administration endpoint so "the App has no repository administration" is a measurement rather than a
 *      belief;
 *   3. resolves the Candidate evolution root through the SAME shared policy production uses
 *      (`stable-candidate/evolution-root-policy`), and records the invariant's own verdict on the resulting
 *      geometry — the acceptance must exercise the geometry production actually resolves, never an easier
 *      one reserved for itself;
 *   4. builds a real Candidate worktree at the live protected-branch tip, with one harmless file added under a
 *      path the Root Surface manifest protects (`electron/credential-boundary/`) and the trust epoch does NOT
 *      cover — so CI can be green and the authority ceiling is still reached;
 *   5. drives the SAME promotion sequence an autonomous run drives (`promoteCandidateOverGitHub`, the same
 *      handlers, the same `PromotionController`, the same governance switch), which pushes the branch, opens
 *      the pull request, reads EVERY required check for the exact candidate SHA, and then stops;
 *   6. asserts the negative authority result: `WAITING_FOR_ROOT_OWNER`, the pull request still open, the
 *      protected branch unmoved, and no merge.
 *
 * ## What it must never do
 *
 * It never merges (the change set is Root-Surface, so the promotion path itself refuses to), never touches a
 * ruleset, protection, secret or tag, never reads an Owner credential, and never writes a token into its own
 * evidence.
 *
 * ## Exit codes
 *
 *   0  the whole acceptance passed (branch + PR as the App, checks green, WAITING_FOR_ROOT_OWNER, nothing merged)
 *   1  the acceptance ran and FAILED (each reason is listed; the report says what was observed)
 *   2  BLOCKED_EXTERNAL: the machine identity is not installed on this host, so the acceptance could not run.
 *      This is a measured state, not a guess: nothing was pushed and nothing was merged.
 *
 * ## Attempt-scoped reporting (corrects STALE_SINGLETON_REPORT_HAZARD)
 *
 * The report used to be one fixed file written only on the success/preflight-success path. An exception
 * before that point left the PREVIOUS run's report in place, and a stale `BLOCKED_EXTERNAL` was mistaken for
 * a newer `RuntimeIsolationError` attempt. Every attempt now writes its own `<runId>.json`, and `latest.json`
 * is rewritten atomically on every attempt — including attempts that throw before a Candidate is built.
 */

const repository = "zhiheng-zhang-Mera/Codex-Boss";
const baseBranch = "main";
const rootOwner = "zhiheng-zhang-Mera";
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const runId = `acceptance-promotion-identity-${stamp}`;
const dataRoot = appDataUnder(process.cwd());
const attemptStartedAt = new Date().toISOString();
/** Attempt-scoped evidence paths. `latest.json` is a convenience pointer, never the only record. */
const reportTargets = reportPaths(dataRoot, runId);
/** Path of THIS compiled instrument, so the report can name the exact code that produced it. */
const instrumentFile = __filename;
app.setPath("userData", dataRoot);

const preflightOnly = process.argv.includes("--preflight");

type Json = Record<string, unknown>;

/** Attempt identity, present in every report so no attempt can be confused with another. */
function attemptEvidence(): Json {
  return {
    ...attemptIdentity({
      runId,
      attemptStartedAt,
      instrumentFile,
      preflightOnly,
      repository,
      baseBranch
    })
  };
}

/**
 * Writes one attempt's evidence, atomically, and refreshes `latest.json`.
 *
 * Secret-safe: the report is scanned before it touches disk, and a report that fails the gate is REFUSED
 * with only a redacted terminal message. There is deliberately no fallback that dumps the raw report.
 */
function writeReport(report: Json): void {
  const result = writeAttemptReport(reportTargets, report);
  if (result.outcome === "REPORT_REFUSED") {
    console.error("PROMOTION_IDENTITY_LIVE_ACCEPTANCE=REPORT_REFUSED the acceptance report failed its own credential-leakage gate; nothing was written");
  } else if (result.outcome === "WRITE_FAILED") {
    console.error("PROMOTION_IDENTITY_LIVE_ACCEPTANCE=REPORT_WRITE_FAILED the acceptance report could not be written");
  }
}

/** A report whose `state` is terminal, so a later attempt cannot be confused with it. */
function report(state: string, extra: Json): Json {
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), state, ...attemptEvidence(), ...extra };
}

/**
 * Reports an external blocker and stops. The declared `never` return is load-bearing: it is what lets every
 * caller below treat the failing result as impossible from that point on, so a blocked acceptance can never
 * fall through into a promotion attempt.
 */
function blockedExternal(detail: string, evidence: Json = {}): never {
  writeReport(report("BLOCKED_EXTERNAL", {
    detail,
    requiredExternalAction: `Install the Codex-Boss GitHub App machine identity on this host (\`corepack pnpm run bootstrap:github-machine\`, Owner-run, private key kept in platform secure storage), then re-run \`corepack pnpm run acceptance:promotion-identity:live\`.`,
    credentialRequiredAction: BOSS_CREDENTIAL_REQUIRED_ACTION,
    ...evidence
  }));
  console.log(`PROMOTION_IDENTITY_LIVE_ACCEPTANCE=BLOCKED_EXTERNAL detail=${redactSecrets(detail)}`);
  app.exit(2);
  throw new Error("unreachable: the blocked acceptance exits the process");
}

/** Reports a failure and stops. See `blockedExternal` for why the return type is `never`. */
function fail(reasons: string[], evidence: Json): never {
  writeReport(report("FAILED", { reasons, ...evidence }));
  for (const reason of reasons) console.error(`PROMOTION_IDENTITY_LIVE_ACCEPTANCE_FAIL ${redactSecrets(reason)}`);
  app.exit(1);
  throw new Error("unreachable: the failed acceptance exits the process");
}

/** The structured detail of a non-OK check read, without re-parsing its sentence. */
function checkFailureDetail(result: { status: string; reason?: string; pending?: string[]; missing?: string[] }): {
  status: string;
  reason?: string;
  pending: string[];
  missing: string[];
} {
  return {
    status: result.status,
    ...(result.reason ? { reason: result.reason } : {}),
    pending: result.pending ?? [],
    missing: result.missing ?? []
  };
}

app.whenReady().then(async () => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("platform secure storage is unavailable, so the App private key cannot be read");

  const runtime = createGitHubMachineRuntime({
    userData: dataRoot,
    crypto: {
      protect: (plainText) => safeStorage.encryptString(plainText).toString("base64"),
      unprotect: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, "base64"))
    }
  });
  if (!runtime.configured) {
    blockedExternal("the GitHub machine identity is not installed in this host's data root, so the promotion path has no credential to act with");
    return;
  }

  const selfCheck = await runtime.selfCheck();
  const appIdentity = {
    logicalIdentity: runtime.auth.describe().logicalIdentity,
    appId: runtime.auth.config.appId,
    installationId: runtime.auth.config.installationId,
    enabled: runtime.auth.config.enabled,
    allowedRepositories: runtime.auth.config.allowedRepositories
  };
  if (!selfCheck.configured || !selfCheck.authenticationHealthy || !selfCheck.installationReachable) {
    blockedExternal(`the installed machine identity could not authenticate: ${selfCheck.error ?? "capability unavailable"}`, { appIdentity, selfCheck });
    return;
  }

  // 1. The App's own permissions, measured from the mint response, plus one administration probe.
  const minted = await runtime.auth.getInstallationToken();
  if (!minted.ok) blockedExternal(`the installation token could not be minted (${minted.code}: ${minted.message})`, { appIdentity, selfCheck });
  const measuredPermissions = minted.value.permissions ?? null;
  const repositorySelection = minted.value.repositorySelection ?? null;
  const repositoryAllowed = (minted.value.repositories ?? []).includes(repository.toLowerCase());
  const administrationProbe = await fetch(`https://api.github.com/repos/${repository}/rulesets`, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${minted.value.token}`, "user-agent": "codex-boss-promotion-live-acceptance" }
  }).then((response) => response.status).catch((error) => `request-failed: ${String(error)}`);

  // 2. The converged credential path: the App identity, not the environment.
  const provider = new GitHubAppPromotionCredentialProvider(runtime.auth);
  const credential = provider.getAutomationCredentialAsync
    ? await provider.getAutomationCredentialAsync()
    : provider.getAutomationCredential();
  const credentialEvidence = {
    provider: provider.describe(),
    status: credential.status,
    source: credential.status === "AVAILABLE" ? credential.credential.source : null,
    identity: credential.status === "AVAILABLE" ? credential.credential.identity : null,
    synchronousFormIsHonest: provider.getAutomationCredential().status === "BLOCKED_EXTERNAL",
    tokenIsNotAnAmbientOwnerCredential: credential.status === "AVAILABLE" ? !isAmbientOwnerCredential(credential.credential.token, process.env) : null
  };
  if (credential.status !== "AVAILABLE") {
    fail(["the App-backed credential provider did not resolve a credential"], { appIdentity, selfCheck, credentialEvidence });
    return;
  }

  const adapter = new GitHubPromotionAdapter({ repository, baseBranch, credentialProvider: provider });

  // 3. The frozen base: the LIVE protected branch tip, and the same commit locally.
  const liveBase = await adapter.readBranchSha(baseBranch);
  if (liveBase.status !== "OK") fail([`the protected branch tip could not be read: ${liveBase.reason}`], { appIdentity, credentialEvidence });
  const localBase = (await runGitOrThrow(process.cwd(), ["rev-parse", `origin/${baseBranch}`])).trim();
  if (localBase !== liveBase.value.sha) {
    fail([`the local origin/${baseBranch} (${localBase.slice(0, 12)}) is not the live protected tip (${liveBase.value.sha.slice(0, 12)}); refusing to build a Candidate on a base the acceptance cannot vouch for`], { appIdentity, credentialEvidence });
    return;
  }

  const governanceRoot = path.join(dataRoot, "evolution-governance");
  // 4. The Candidate root comes from the SAME shared policy the production composition root uses. The
  //    acceptance deliberately does NOT reserve an easier geometry for itself: it must exercise the root
  //    placement production actually resolves. An unsafe resolution throws here, before anything is written.
  const stableRoot = process.cwd();
  let resolvedEvolution: ReturnType<typeof resolveEvolutionRoot>;
  try {
    resolvedEvolution = resolveEvolutionRoot({
      stableRoot,
      userData: dataRoot,
      ...(process.env.BOSS_EVOLUTION_ROOT ? { explicitOverride: process.env.BOSS_EVOLUTION_ROOT } : {})
    });
  } catch (error) {
    fail([`the shared evolution-root policy refused to place the Candidate root: ${String((error as Error).message)}`], {
      appIdentity,
      credentialEvidence,
      rootPolicy: { stableRoot, resolved: null }
    });
    return;
  }
  const evolutionRoot = resolvedEvolution.evolutionRoot;
  // The invariant's own verdict on the geometry the policy just chose. Recorded, not assumed: if this is
  // ever `false` the acceptance must stop rather than build a Candidate.
  const geometry = verifyRuntimeSeparation(evolutionLayout(evolutionRoot, runId, liveBase.value.sha), stableRoot);
  const rootPolicyEvidence = {
    stableRoot,
    evolutionRoot,
    source: resolvedEvolution.origin.source,
    fingerprint: resolvedEvolution.origin.fingerprint,
    detail: resolvedEvolution.origin.detail,
    separated: geometry.separated,
    overlaps: geometry.overlaps
  };
  if (!geometry.separated) {
    fail(["the shared evolution-root policy returned a location the isolation invariant rejects"], {
      appIdentity,
      credentialEvidence,
      rootPolicy: rootPolicyEvidence
    });
    return;
  }

  const candidate = await createCandidateWorkspace({ stableRoot, evolutionRoot, baseSha: liveBase.value.sha, runId, allowNonHeadBase: true });
  const layout = candidate.layout;
  const acceptancePath = `electron/credential-boundary/live-acceptance-${stamp}.md`;
  fs.writeFileSync(path.join(layout.workspace, acceptancePath), [
    "# Promotion-path live acceptance",
    "",
    `Generated by the running Codex-Boss product at ${new Date().toISOString()} through the Self-Evolution`,
    "promotion path, acting as the Codex-Boss GitHub App installation identity.",
    "",
    "This file is deliberately inert and is NEVER merged: the path it lives under is Root Surface, so the",
    "promotion path must stop at WAITING_FOR_ROOT_OWNER with every required check green. It grants nothing,",
    "changes no protection, ruleset, secret, visibility or installation scope."
  ].join("\n"), "utf8");
  const candidateHeadSha = await commitCandidate(layout.workspace, `test(promotion): record the App-identity live acceptance ${stamp}`);
  const changedFiles = await candidateChangedFiles(layout.workspace, liveBase.value.sha);

  const { killSwitch, emergency } = createEvolutionGovernance({ governanceRoot, evolutionRoot, rootOwner });
  const ledgerFile = path.join(governanceRoot, "root-audit-ledger.jsonl");
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  const authority = new RootAuthority({ root: layout.workspace, ledgerFile, runId, candidateSha: liveBase.value.sha, actor: "promotion-live-acceptance" });
  const context: EvolutionRunContext = {
    runId,
    candidateRoot: layout.root,
    candidateWorkspace: layout.workspace,
    stableRoot: process.cwd(),
    baseSha: liveBase.value.sha,
    ledgerFile,
    evidenceDirectory: layout.evidence
  };
  const runGit = (cwd: string, args: string[]): Promise<string> => runGitOrThrow(cwd, args, { timeoutMs: 180_000, maxBufferBytes: GIT_MAX_BUFFER_BYTES.large });
  const handlers = createGitHostHandlers({
    runGit,
    persistEvidence: (file, payload) => {
      const target = path.join(governanceRoot, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    },
    promotion: {
      pushBranch: async ({ workspace, branch, sha }) => adapter.pushCandidateBranch({ workspace, branch, sha }),
      openPullRequest: async ({ head, title, body }) => adapter.createPullRequest({ head, title, body }),
      readPullRequest: async ({ prNumber }) => adapter.readPullRequest(prNumber),
      readCheck: async ({ sha }) => adapter.readRequiredCheck(sha),
      mergePullRequest: async ({ prNumber, sha, title }) => adapter.mergePullRequest({ prNumber, sha, commitTitle: title }),
      readBranchSha: async ({ branch }) => adapter.readBranchSha(branch)
    }
  });
  const host = new EvolutionHostOperations(context, authority, handlers);
  const promotion = createRunPromotionController({ governanceRoot, runId, authority, workspace: layout.workspace, emergency, stableSha: liveBase.value.sha });

  const evidenceBase = {
    baseSha: liveBase.value.sha,
    appIdentity,
    selfCheck,
    measuredPermissions,
    repositorySelection,
    repositoryAllowed,
    administrationProbeStatus: administrationProbe,
    credentialEvidence,
    /** Which root-placement policy resolved the Candidate root, and the invariant's verdict on it. */
    rootPolicy: rootPolicyEvidence,
    /** The Candidate's resolved layout, relative to nothing shared with Stable. */
    candidateLayout: { root: layout.root, workspace: layout.workspace, runtimeData: layout.runtimeData },
    candidate: { workspace: layout.workspace, branch: layout.candidateBranch, candidateHeadSha, changedFiles, acceptancePath },
    authorityPlane: { ledgerFile, governanceRoot, killSwitchState: killSwitch.status().state }
  };

  if (preflightOnly) {
    writeReport(report("PREFLIGHT_PASS", { ...evidenceBase, detail: "identity, permissions, credential path, root policy and candidate are ready; nothing was pushed" }));
    console.log(`PROMOTION_IDENTITY_LIVE_ACCEPTANCE=PREFLIGHT_PASS identity=${credentialEvidence.identity} rootSource=${rootPolicyEvidence.source} separated=${rootPolicyEvidence.separated} base=${liveBase.value.sha.slice(0, 12)} candidate=${candidateHeadSha.slice(0, 12)} changedFiles=${changedFiles.join(",")}`);
    app.exit(0);
    return;
  }

  // 4. The real thing: the production promotion sequence, with the App identity.
  const result = await promoteCandidateOverGitHub({
    host,
    promotion,
    emergency,
    candidateHeadSha,
    branch: layout.candidateBranch,
    request: { runId, objective: "harmless live acceptance of the App-identity promotion path" },
    changedFiles,
    reviewerClean: true
  }, { ciWaitMs: 45 * 60_000 });

  // 5. The negative authority result, measured after the fact.
  const record = promotion.record();
  const checks = await adapter.readRequiredCheck(candidateHeadSha);
  const pullRequest = record.pullRequest ? await adapter.readPullRequest(record.pullRequest.number) : undefined;
  const baseAfter = await adapter.readBranchSha(baseBranch);
  const observations = {
    outcome: result.outcome,
    blockedExternal: result.blockedExternal ?? null,
    promotionState: record.state,
    promotionReasons: record.reasons,
    promotionHistory: record.history,
    rootOwnerApproval: record.rootOwnerApproval,
    pullRequest: record.pullRequest,
    pullRequestState: pullRequest && pullRequest.status === "OK" ? pullRequest.value.state : null,
    requiredChecks: checks.status === "OK" ? checks.value : checkFailureDetail(checks),
    baseBranchShaAfter: baseAfter.status === "OK" ? baseAfter.value.sha : null,
    protectedBranchUnmoved: baseAfter.status === "OK" && baseAfter.value.sha === liveBase.value.sha
  };

  const failures: string[] = [];
  if (result.outcome !== "WAITING_FOR_ROOT_OWNER") failures.push(`the promotion path ended in ${result.outcome}, not WAITING_FOR_ROOT_OWNER`);
  if (record.state !== "WAITING_FOR_ROOT_OWNER") failures.push(`the durable promotion record is ${record.state}, not WAITING_FOR_ROOT_OWNER`);
  if (checks.status !== "OK") failures.push(`the required checks for ${candidateHeadSha.slice(0, 12)} are not all green: ${checks.reason}`);
  if (!record.pullRequest) failures.push("no pull request was recorded");
  if (pullRequest && pullRequest.status === "OK" && pullRequest.value.state !== "open") failures.push(`the pull request is ${pullRequest.value.state}`);
  if (!observations.protectedBranchUnmoved) failures.push("the protected branch moved: the acceptance must leave it exactly where it found it");
  if (record.rootOwnerApproval) failures.push("a Root Owner approval exists for this SHA; the acceptance may not create one");

  const greenChecks = checks.status === "OK"
    ? checks.value.checks.map((check) => `${check.name}:${check.conclusion}`).join(",")
    : "unavailable";

  if (failures.length) {
    fail(failures, { ...evidenceBase, observations });
  }
  writeReport(report("PASS", { ...evidenceBase, observations }));
  console.log(`PROMOTION_IDENTITY_LIVE_ACCEPTANCE=PASS identity=${credentialEvidence.identity} branch=${layout.candidateBranch} candidate=${candidateHeadSha.slice(0, 12)} pr=${String(record.pullRequest?.number)} state=${record.state} checks=${greenChecks} baseUnmoved=true`);
  app.quit();
}).catch((error) => {
  // §8 — a top-level exception, including one thrown before Candidate creation, must still produce a FRESH
  // attempt-scoped FAILED report. Without this, the previous attempt's report stayed on disk and was mistaken
  // for the current one (STALE_SINGLETON_REPORT_HAZARD), which is exactly what happened when the nested-root
  // geometry threw and an older BLOCKED_EXTERNAL was read as this run's result.
  const detail = terminalFailureReason(error);
  const kind = error instanceof Error ? error.name : "Error";
  try {
    writeReport(report("FAILED", {
      reasons: [`the acceptance threw before completion (${kind}): ${detail}`],
      terminal: "THROWN",
      phase: "pre-candidate-or-later"
    }));
  } catch {
    // A report that cannot be written must not become a second failure surface: print the redacted terminal
    // message and return non-zero. Never dump raw error or context.
    console.error("PROMOTION_IDENTITY_LIVE_ACCEPTANCE=REPORT_WRITE_FAILED");
  }
  console.error(`PROMOTION_IDENTITY_LIVE_ACCEPTANCE=FAIL ${detail}`);
  app.exit(1);
});
