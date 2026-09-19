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

function main() {
  if (process.argv.includes("--self-check")) return selfCheck();

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
