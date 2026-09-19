#!/usr/bin/env node
/**
 * Prove — or refute — `AUTONOMOUS_WORKER_AUTHORITY < OWNER_TRUST_AUTHORITY` (Root Trust Authority
 * Lockdown, Phase A4).
 *
 *   node scripts/verify-authority-separation.cjs               # live check, needs a Boss credential
 *   node scripts/verify-authority-separation.cjs --self-check   # offline: verifies the classification table
 *
 * WHY THIS EXISTS
 *
 * The lockdown can prove that a Root Trust change needs the Owner, that a forged epoch fails, and that the
 * autonomous profile has no shell. It cannot prove the LAST fact the Owner asked for — that Boss's own
 * credential is strictly weaker than the Owner's — by itself, because that fact is about a credential that
 * does not exist yet. Today `CODEX_BOSS_GITHUB_TOKEN` is unset, so the promotion path is fail-closed by
 * ABSENCE: safe, but "Boss has no authority" is not the claim. The claim is "Boss has authority, and it is
 * smaller". This script turns that claim into one command, so it stops being something anyone has to
 * believe.
 *
 * MEASURED FACTS, NOT HEADERS
 *
 *   - the Boss credential's own repository permissions (must not include admin),
 *   - whether the Boss identity appears in the `Main-Protection` ruleset's `bypass_actors` (it must not:
 *     the Owner's user id is the only always-allow bypass actor),
 *   - whether the Boss credential can READ that ruleset at all (administration access is Owner territory),
 *   - and a NON-DESTRUCTIVE `git push --dry-run HEAD:main`, which makes the server evaluate the ruleset
 *     for this credential without creating anything. A rejection is the proof; an acceptance is the bug.
 *
 * `--dry-run` is deliberate: this script must be safe to run against the real repository, by anyone, at any
 * time. It never writes, never pushes and never needs a token with write access to check write access.
 *
 * EXIT CODES: 0 = proven (or unproven-but-safe: no credential configured), 1 = FAILED (Boss holds Owner
 * authority). A missing credential is a status, not an error.
 */

"use strict";
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BOSS_CREDENTIAL_VARIABLES = ["CODEX_BOSS_GITHUB_TOKEN", "BOSS_GITHUB_TOKEN"];

/**
 * The classification table, kept pure so `--self-check` can exercise every branch without a network, a
 * credential, or a repository.
 */
function classifySeparation(input) {
  if (!input.credentialPresent) {
    return {
      verdict: "UNPROVEN_NO_CREDENTIAL",
      reason:
        "no Boss credential is configured (" + BOSS_CREDENTIAL_VARIABLES.join(" / ") + "), so the promotion " +
        "path is fail-closed by absence; the inequality is not yet demonstrated",
      failed: false
    };
  }
  if (input.permissions?.admin === true) {
    return { verdict: "FAILED_BOSS_HAS_OWNER_AUTHORITY", reason: "the Boss credential reports repository admin", failed: true };
  }
  if (input.inBypassActors === true) {
    return { verdict: "FAILED_BOSS_HAS_OWNER_AUTHORITY", reason: "the Boss identity is an always-allow bypass actor on the main ruleset", failed: true };
  }
  if (input.mainPushAccepted === true) {
    return { verdict: "FAILED_BOSS_HAS_OWNER_AUTHORITY", reason: "a dry-run push to main was ACCEPTED for the Boss credential, so the ruleset does not hold it", failed: true };
  }
  if (input.mainPushRejected !== true) {
    return { verdict: "UNPROVEN_NO_CREDENTIAL", reason: "the dry-run main push was not evaluated, so nothing is proven either way", failed: false };
  }
  return {
    verdict: "AUTHORITY_SEPARATION_PROVEN",
    reason:
      "the Boss credential is not an admin, is not a bypass actor, and its dry-run push to main was " +
      "REJECTED by the ruleset while the Owner's own authority remains the only always-allow actor",
    failed: false
  };
}

/** Every branch of the table, asserted offline: a classifier nobody tests is a classifier nobody can trust. */
function selfCheck() {
  const cases = [
    [{ credentialPresent: false }, "UNPROVEN_NO_CREDENTIAL"],
    [{ credentialPresent: true, permissions: { admin: true }, mainPushRejected: true }, "FAILED_BOSS_HAS_OWNER_AUTHORITY"],
    [{ credentialPresent: true, permissions: { admin: false, push: true }, inBypassActors: true, mainPushRejected: true }, "FAILED_BOSS_HAS_OWNER_AUTHORITY"],
    [{ credentialPresent: true, permissions: { admin: false, push: true }, inBypassActors: false, mainPushAccepted: true }, "FAILED_BOSS_HAS_OWNER_AUTHORITY"],
    [{ credentialPresent: true, permissions: { admin: false, push: true }, inBypassActors: false, mainPushRejected: false }, "UNPROVEN_NO_CREDENTIAL"],
    [{ credentialPresent: true, permissions: { admin: false, push: true }, inBypassActors: false, mainPushRejected: true }, "AUTHORITY_SEPARATION_PROVEN"]
  ];
  let failures = 0;
  for (const [input, expected] of cases) {
    const actual = classifySeparation(input).verdict;
    if (actual !== expected) {
      console.error(`[separation] SELF-CHECK FAILED: expected ${expected}, got ${actual} for ${JSON.stringify(input)}`);
      failures += 1;
    }
  }
  // The dangerous verdict must be exactly the two Owner-authority shapes, and never reachable from absence.
  if (classifySeparation({ credentialPresent: false }).failed !== false) {
    console.error("[separation] SELF-CHECK FAILED: a missing credential must never be reported as a failure");
    failures += 1;
  }
  if (failures === 0) console.log(`[separation] self-check passed: ${cases.length} classification cases, 4 verdicts`);
  return failures === 0 ? 0 : 1;
}

function gh(args, token) {
  try {
    return { ok: true, out: execFileSync("gh", args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, GH_TOKEN: token }, windowsHide: true }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/**
 * Phase B3 — is this repository a place where a self-hosted runner may exist AT ALL?
 *
 * Independent of whether a Boss credential exists: a self-hosted runner on a PUBLIC repository is
 * reachable by workflow files that untrusted code can propose, and no workflow-level guard can bind a
 * runner to one workflow, because a runner is registered for the whole repository. GitHub's own guidance is
 * not to do it, and Phase B3 says the same in the Owner's words ("禁止不受信任代码自动落到此 runner").
 *
 * Measured, not remembered: `--platform` reads the repository visibility, its rulesets and bypass actors,
 * and its environments; `--require-self-hosted-safe` turns the verdict into a fail-closed guard the
 * qualification job runs before anything else. When the repository becomes private the verdict flips by
 * itself; until then the real-host lane refuses to run rather than trusting whoever installed it.
 */
function platformReport({ requireSelfHostedSafe }) {
  const repo = probe(() => execFileSync("gh", ["api", "repos/{owner}/{repo}"], { cwd: ROOT, encoding: "utf8", windowsHide: true }));
  if (!repo.ok) {
    console.error(`[platform] cannot read the repository: ${repo.out.split(/\r?\n/)[0] ?? ""}`);
    return 1;
  }
  const info = JSON.parse(repo.out);
  const visibility = info.visibility ?? (info.private ? "private" : "public");

  const rulesets = probe(() => execFileSync("gh", ["api", "repos/{owner}/{repo}/rulesets"], { cwd: ROOT, encoding: "utf8", windowsHide: true }));
  const mainRuleset = rulesets.ok ? (JSON.parse(rulesets.out) || []).find((entry) => entry.name === "Main-Protection") : undefined;
  const detail = mainRuleset
    ? probe(() => execFileSync("gh", ["api", `repos/{owner}/{repo}/rulesets/${mainRuleset.id}`], { cwd: ROOT, encoding: "utf8", windowsHide: true }))
    : undefined;
  const parsed = detail && detail.ok ? JSON.parse(detail.out) : undefined;
  const rules = parsed ? (parsed.rules ?? []).map((rule) => rule.type) : [];
  const bypassActors = parsed ? (parsed.bypass_actors ?? []).map((actor) => ({ id: actor.actor_id, type: actor.actor_type, mode: actor.bypass_mode })) : [];

  const environments = probe(() => execFileSync("gh", ["api", "repos/{owner}/{repo}/environments"], { cwd: ROOT, encoding: "utf8", windowsHide: true }));
  const environmentList = environments.ok
    ? (JSON.parse(environments.out).environments ?? []).map((entry) => ({ name: entry.name, rules: (entry.protection_rules ?? []).map((rule) => rule.type) }))
    : [];

  // Which check contexts do this repository's workflows actually produce? A required context that nothing
  // produces makes the ruleset's check gate decorative, which is worth reporting rather than discovering.
  // The job names are read with the YAML parser: a regex over indent levels reported nested keys (`inputs`,
  // `steps`) as if they were jobs, which is exactly the kind of measurement error this report exists to avoid.
  const workflowDir = path.join(ROOT, ".github", "workflows");
  const produced = [];
  let yaml;
  try {
    yaml = require("yaml");
  } catch {
    yaml = undefined;
  }
  for (const file of fs.readdirSync(workflowDir).filter((name) => name.endsWith(".yml"))) {
    const text = fs.readFileSync(path.join(workflowDir, file), "utf8");
    if (!yaml) continue;
    try {
      const document = yaml.parse(text);
      for (const name of Object.keys(document?.jobs ?? {})) produced.push(name);
    } catch {
      // An unparsable workflow is reported by the workflow itself; the report simply cannot count it.
    }
  }
  const requiredChecks = parsed
    ? (parsed.rules ?? []).filter((rule) => rule.type === "required_status_checks").flatMap((rule) => (rule.parameters?.required_status_checks ?? []).map((check) => check.context))
    : [];
  const unsatisfiableChecks = requiredChecks.filter((context) => !produced.includes(context));

  const selfHostedRunnerSafe = visibility === "private";
  const findings = [];
  if (!selfHostedRunnerSafe) findings.push("PUBLIC_REPOSITORY_CANNOT_HOST_A_SELF_HOSTED_RUNNER");
  if (unsatisfiableChecks.length) findings.push(`REQUIRED_CHECK_NOT_PRODUCED:${unsatisfiableChecks.join(",")}`);
  if (!parsed) findings.push("RULESET_NOT_READABLE_WITH_THIS_CREDENTIAL");
  if (bypassActors.length !== 1 || bypassActors[0]?.mode !== "always") findings.push(`BYPASS_ACTORS:${JSON.stringify(bypassActors)}`);
  const ownerEnvironment = environmentList.find((entry) => entry.name === "boss-root-trust-owner");
  if (!ownerEnvironment || !ownerEnvironment.rules.includes("required_reviewers")) findings.push("OWNER_ENVIRONMENT_NOT_PROTECTED");

  const report = {
    $comment: "Phase B3 platform authority report: what the HOST can enforce, measured rather than assumed.",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: { visibility, private: info.private === true, defaultBranch: info.default_branch },
    ruleset: parsed
      ? { name: parsed.name, enforcement: parsed.enforcement, rules, bypassActors, requiredChecks, producedCheckContexts: [...new Set(produced)].sort(), unsatisfiableChecks }
      : null,
    environments: environmentList,
    verdict: {
      selfHostedRunnerSafe,
      selfHostedRunnerReason: selfHostedRunnerSafe
        ? "the repository is private, so a runner is not reachable by untrusted workflow files"
        : "the repository is PUBLIC: a self-hosted runner would be registered for the whole repository and no workflow guard can bind it to one workflow (Phase B3 forbids this)",
      findings
    }
  };

  const jsonMode = process.argv.includes("--json");
  const human = [
    `[platform] visibility=${visibility} default=${report.repository.defaultBranch}`,
    `[platform] ruleset=${parsed ? `${parsed.name} enforcement=${parsed.enforcement} rules=${rules.join(",")}` : "unreadable"}`,
    `[platform] bypass actors=${JSON.stringify(bypassActors)}`,
    `[platform] required checks=${JSON.stringify(requiredChecks)} produced=${JSON.stringify(report.ruleset?.producedCheckContexts ?? [])}`,
    `[platform] environments=${JSON.stringify(environmentList)}`,
    `[platform] self-hosted runner safe: ${selfHostedRunnerSafe}`,
    ...findings.map((finding) => `[platform]   finding: ${finding}`)
  ];
  // In JSON mode stdout carries the JSON ALONE, so a caller can parse it; the human lines go to stderr.
  for (const line of human) {
    if (jsonMode) process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  if (jsonMode) {
    const outIndex = process.argv.indexOf("--out");
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (outIndex >= 0 && process.argv[outIndex + 1]) {
      const target = path.resolve(process.argv[outIndex + 1]);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text, "utf8");
      process.stderr.write(`[platform] wrote ${target}\n`);
    } else {
      process.stdout.write(text);
    }
  }

  if (requireSelfHostedSafe && !selfHostedRunnerSafe) {
    console.error(`[platform] REFUSING: ${report.verdict.selfHostedRunnerReason}`);
    return 1;
  }
  return 0;
}

/** Run a probe that may fail; never throw out of the report. */
function probe(attempt) {
  try {
    return { ok: true, out: attempt() };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

function main() {
  if (process.argv.includes("--self-check")) return selfCheck();
  if (process.argv.includes("--platform")) return platformReport({ requireSelfHostedSafe: process.argv.includes("--require-self-hosted-safe") });

  const variable = BOSS_CREDENTIAL_VARIABLES.find((name) => process.env[name]);
  const token = variable ? process.env[variable] : undefined;
  if (!token) {
    const verdict = classifySeparation({ credentialPresent: false });
    console.log(`[separation] ${verdict.verdict}: ${verdict.reason}`);
    console.log("[separation] Owner action: create a dedicated Boss identity (contents:write, pull_requests:write, checks:read; no admin, no ruleset bypass) and expose it as " + BOSS_CREDENTIAL_VARIABLES[0]);
    return 0;
  }
  console.log(`[separation] using ${variable} (value never printed)`);

  const repo = gh(["api", "repos/{owner}/{repo}"], token);
  const permissions = repo.ok ? JSON.parse(repo.out).permissions ?? {} : undefined;
  console.log(`[separation] repository permissions for the Boss credential: ${JSON.stringify(permissions ?? "unreadable")}`);

  // Who is the Boss credential, so "is it a bypass actor?" is answered by identity rather than by guesswork.
  const me = gh(["api", "user"], token);
  const bossId = me.ok ? JSON.parse(me.out).id : undefined;
  const bossLogin = me.ok ? JSON.parse(me.out).login : undefined;
  if (bossLogin) console.log(`[separation] Boss identity: ${bossLogin} (id ${bossId})`);

  const ruleset = gh(["api", "repos/{owner}/{repo}/rulesets"], token);
  let inBypassActors = false;
  if (ruleset.ok) {
    const list = JSON.parse(ruleset.out);
    const mainRuleset = Array.isArray(list) ? list.find((entry) => entry.name === "Main-Protection") : undefined;
    if (mainRuleset) {
      const detail = gh(["api", `repos/{owner}/{repo}/rulesets/${mainRuleset.id}`], token);
      if (detail.ok) {
        const actors = JSON.parse(detail.out).bypass_actors ?? [];
        inBypassActors = bossId !== undefined && actors.some((actor) => String(actor.actor_id) === String(bossId));
        console.log(`[separation] ruleset bypass actors: ${JSON.stringify(actors.map((actor) => ({ id: actor.actor_id, type: actor.actor_type, mode: actor.bypass_mode })))}`);
      }
    }
  } else {
    console.log("[separation] the Boss credential cannot read the rulesets (expected for a non-admin credential)");
  }

  // Non-destructive: the server evaluates the ruleset; nothing is created.
  let mainPushRejected;
  let mainPushAccepted;
  try {
    execFileSync("git", ["push", "--dry-run", `https://x-access-token:${token}@github.com/zhiheng-zhang-Mera/Codex-Boss.git`, "HEAD:main"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    mainPushAccepted = true;
    mainPushRejected = false;
  } catch (error) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    mainPushAccepted = false;
    // Only a REFUSAL BY THE RULESET proves the separation. An authentication or network failure proves
    // nothing, and reporting it as a rejection would be the same self-congratulation the lockdown forbids.
    const looksLikeRuleset = /protected branch|ruleset|required status check|refusing to allow|GH0(069|134)|bypass/i.test(text);
    mainPushRejected = looksLikeRuleset ? true : undefined;
    const detail = text.split(/\r?\n/).find((line) => /error|rejected|protected|denied|fatal/i.test(line)) ?? "(no detail)";
    console.log(`[separation] dry-run push to main: ${looksLikeRuleset ? "refused by the ruleset" : "failed for a reason that is NOT the ruleset"} — ${detail}`);
  }

  const verdict = classifySeparation({ credentialPresent: true, permissions, inBypassActors, mainPushRejected, mainPushAccepted });
  console.log(`[separation] ${verdict.verdict}: ${verdict.reason}`);
  return verdict.failed ? 1 : 0;
}

process.exitCode = main();
