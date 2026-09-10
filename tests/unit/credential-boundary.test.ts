import { afterEach, describe, expect, it } from "vitest";
import {
  CREDENTIAL_NAME_PATTERN,
  OWNER_CREDENTIAL_VARIABLES,
  assertNoCredentialLeak,
  credentialNameIsDenied,
  describeSanitization,
  findCredentialLeaks,
  isToolchainVariable,
  sanitizeEnvironment
} from "../../electron/credential-boundary/sanitized-environment";
import {
  assessCredentialBoundary,
  candidateEnvironment,
  isAmbientOwnerCredential,
  isOwnerAdministrationTarget,
  observeAmbientCredentials
} from "../../electron/credential-boundary/credential-boundary";
import {
  BOSS_CREDENTIAL_REQUIRED_ACTION,
  BOSS_CREDENTIAL_VARIABLES,
  EnvironmentBossGitHubCredentialProvider,
  UnconfiguredBossGitHubCredentialProvider
} from "../../electron/credential-boundary/github-credential-provider";
import { runAllowedCommand } from "../../electron/engineering/command-runner";
import { cleanupFixtures, tempDir, write } from "../helpers/root-fixtures";

/**
 * Credential Boundary acceptance (Isolation-Finalization.md §9, §23 RD-007
 * "Credential sanitization", RD-008 "No Owner credential fallback"; §14
 * RT-22..RT-24).
 *
 * The load-bearing test here is the last one: it spawns a real child process
 * through the real command runner and asks the child what it can see. A
 * sanitizer that is only asserted against itself proves nothing.
 */

afterEach(cleanupFixtures);

describe("Sanitized environment (§9.2, RD-007)", () => {
  it("removes every Owner-authority variable the plan names", () => {
    const source: NodeJS.ProcessEnv = { PATH: "/usr/bin", TEMP: "/tmp", HOME: "/home/x" };
    for (const name of OWNER_CREDENTIAL_VARIABLES) source[name] = `${name}-value`;
    const sanitized = sanitizeEnvironment(source);
    for (const name of OWNER_CREDENTIAL_VARIABLES) expect(sanitized[name], name).toBeUndefined();
    expect(sanitized.PATH).toBe("/usr/bin");
    expect(sanitized.TEMP).toBe("/tmp");
  });

  it("removes anything shaped like a credential, including names not on the list", () => {
    const source: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      MY_DEPLOY_TOKEN: "x",
      SERVICE_SECRET: "x",
      DB_PASSWORD: "x",
      VENDOR_API_KEY: "x",
      REGION: "eu",
      COMPAT: "1",
      PATHLIKE: "2",
      OPENAI_APIKEY: "x",
      SOMETHING_CREDENTIALS: "x",
      SIGNING_KEY: "x"
    };
    const sanitized = sanitizeEnvironment(source);
    for (const name of ["MY_DEPLOY_TOKEN", "SERVICE_SECRET", "DB_PASSWORD", "VENDOR_API_KEY", "OPENAI_APIKEY", "SOMETHING_CREDENTIALS", "SIGNING_KEY"]) {
      expect(sanitized[name], name).toBeUndefined();
    }
    // Names that merely *look* similar are preserved: over-matching PATH would
    // break every child process.
    for (const name of ["REGION", "COMPAT", "PATHLIKE", "PATH"]) expect(sanitized[name], name).toBeDefined();
    expect(CREDENTIAL_NAME_PATTERN.test("PATH")).toBe(false);
    expect(credentialNameIsDenied("GH_TOKEN")).toBe("explicit");
    expect(credentialNameIsDenied("MY_THING_TOKEN")).toBe("pattern");
    expect(credentialNameIsDenied("PATH")).toBeUndefined();
  });

  it("honours an explicit allow exception and never mutates its input", () => {
    const source: NodeJS.ProcessEnv = { PATH: "/usr/bin", KEEP_TOKEN: "v" };
    const sanitized = sanitizeEnvironment(source, { allow: ["KEEP_TOKEN"] });
    expect(sanitized.KEEP_TOKEN).toBe("v");
    expect(source.KEEP_TOKEN).toBe("v");
    // Injection is how TEMP/TMP are redirected into the Candidate's own tree.
    expect(sanitizeEnvironment(source, { inject: { TEMP: "/candidate/temp" } }).TEMP).toBe("/candidate/temp");
  });

  it("reports what it removed and why", () => {
    const report = describeSanitization({ PATH: "/usr/bin", GH_TOKEN: "a", MY_TOKEN: "b" });
    expect(report.kept).toContain("PATH");
    expect(report.removedExplicitly).toEqual(["GH_TOKEN"]);
    expect(report.removedByPattern).toEqual(["MY_TOKEN"]);
    expect(report.removed).toEqual(["GH_TOKEN", "MY_TOKEN"]);
  });

  it("accepts a sanitized environment and refuses a leaky one", () => {
    expect(findCredentialLeaks(sanitizeEnvironment({ PATH: "/x", GITHUB_TOKEN: "t" }))).toEqual([]);
    expect(() => assertNoCredentialLeak({ PATH: "/x" })).not.toThrow();
    expect(() => assertNoCredentialLeak({ PATH: "/x", GH_TOKEN: "t" })).toThrow(/credential variables/);
  });

  it("keeps the toolchain variables a build/test child genuinely needs", () => {
    for (const name of ["PATH", "PATHEXT", "SystemRoot", "TEMP", "APPDATA", "LOCALAPPDATA", "NODE_ENV", "ComSpec"]) {
      expect(isToolchainVariable(name), name).toBe(true);
    }
    expect(isToolchainVariable("GH_TOKEN")).toBe(false);
  });

  it("spawns a real child that cannot see the ambient Owner credential (§9.2, RT-23)", async () => {
    const root = tempDir("boss-env-probe-");
    write(
      root,
      "probe.test.cjs",
      "const test=require('node:test');\ntest('probe',()=>{console.log('GH_TOKEN='+(process.env.GH_TOKEN===undefined?'ABSENT':'PRESENT'));console.log('GITHUB_TOKEN='+(process.env.GITHUB_TOKEN===undefined?'ABSENT':'PRESENT'));});\n"
    );

    // 1. The seam itself: whatever env is handed to the runner is what the child
    //    gets. This proves the assertion below is measuring the boundary and not
    //    an inert code path.
    const forwarded = await runAllowedCommand(root, "test", ["probe.test.cjs"], { env: { ...process.env, GH_TOKEN: "owner-secret", GITHUB_TOKEN: "owner-secret" } });
    expect(forwarded.passed).toBe(true);
    expect(forwarded.output).toContain("GH_TOKEN=PRESENT");

    // 2. The boundary: the Candidate environment removes it before the spawn.
    const sanitized = candidateEnvironment({ ...process.env, GH_TOKEN: "owner-secret", GITHUB_TOKEN: "owner-secret" });
    const contained = await runAllowedCommand(root, "test", ["probe.test.cjs"], { env: sanitized });
    expect(contained.passed).toBe(true);
    expect(contained.output).toContain("GH_TOKEN=ABSENT");
    expect(contained.output).toContain("GITHUB_TOKEN=ABSENT");
    expect(contained.output).not.toContain("owner-secret");
  });
});

describe("Credential domains stay separate (§9.1, RT-22/RT-23)", () => {
  it("observes ambient Owner authority by name and fingerprint, never by value", () => {
    const observation = observeAmbientCredentials({ PATH: "/x", GH_TOKEN: "secret-value", AWS_SECRET_ACCESS_KEY: "aws" });
    expect(observation.ownerAuthorityVariables).toEqual(["GH_TOKEN", "AWS_SECRET_ACCESS_KEY"]);
    expect(observation.ownerCredentialFingerprints.every((item) => !item.includes("secret-value"))).toBe(true);
    expect(observation.credentialShapedVariables).toContain("GH_TOKEN");
  });

  it("detects a credential that is byte-identical to an ambient Owner credential", () => {
    const environment: NodeJS.ProcessEnv = { GH_TOKEN: "owner-token" };
    expect(isAmbientOwnerCredential("owner-token", environment)).toBe(true);
    expect(isAmbientOwnerCredential("different-token", environment)).toBe(false);
    expect(isAmbientOwnerCredential("", environment)).toBe(false);
  });

  it("keeps running when the Owner is logged in, because containment is the answer, not shutdown", () => {
    const assessment = assessCredentialBoundary({ PATH: "/x", GH_TOKEN: "owner-token", GITHUB_TOKEN: "owner-token" });
    expect(assessment.ambientOwnerAuthorityDetected).toBe(true);
    expect(assessment.ownerAuthorityPresent).toEqual(["GH_TOKEN", "GITHUB_TOKEN"]);
    expect(assessment.candidateEnvironment.GH_TOKEN).toBeUndefined();
    expect(assessment.candidateEnvironment.GITHUB_TOKEN).toBeUndefined();
    expect(assessment.removedVariables).toContain("GH_TOKEN");
  });

  it("recognizes the Owner administration surfaces the evolution path must not drive (RT-24)", () => {
    const forbidden = [
      "https://github.com/zhiheng-zhang-Mera/Codex-Boss/settings",
      "https://github.com/zhiheng-zhang-Mera/Codex-Boss/settings/rules/123",
      "https://github.com/zhiheng-zhang-Mera/Codex-Boss/rules",
      "https://github.com/orgs/zhiheng-zhang-Mera/settings/billing",
      "https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/secrets",
      "https://github.com/zhiheng-zhang-Mera/Codex-Boss/settings/branches",
      "https://github.com/zhiheng-zhang-Mera/Codex-Boss/settings/access"
    ];
    for (const url of forbidden) expect(isOwnerAdministrationTarget(url), url).toBe(true);
    const ordinary = [
      "https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/1",
      "https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/1",
      "https://example.com/settings",
      "not a url",
      ""
    ];
    for (const url of ordinary) expect(isOwnerAdministrationTarget(url), url).toBe(false);
  });
});

describe("Dedicated Boss credential, never an Owner fallback (§9.3, RD-008, RT-22)", () => {
  it("reports BLOCKED_EXTERNAL with a concrete external action when unset", () => {
    const provider = new EnvironmentBossGitHubCredentialProvider({ environment: { PATH: "/x", GH_TOKEN: "owner-token" } });
    const result = provider.getAutomationCredential();
    expect(result.status).toBe("BLOCKED_EXTERNAL");
    if (result.status === "BLOCKED_EXTERNAL") {
      expect(result.requiredExternalAction).toBe(BOSS_CREDENTIAL_REQUIRED_ACTION);
      expect(result.reason).toMatch(/refusing to fall back to the Owner's ambient credential/);
    }
    expect(provider.describe().configured).toBe(false);
    // The Owner's ambient GH_TOKEN is present and deliberately NOT used.
    expect(BOSS_CREDENTIAL_VARIABLES).not.toContain("GH_TOKEN");
    expect(BOSS_CREDENTIAL_VARIABLES).not.toContain("GITHUB_TOKEN");
  });

  it("returns the dedicated credential when one is configured", () => {
    const provider = new EnvironmentBossGitHubCredentialProvider({
      environment: { PATH: "/x", CODEX_BOSS_GITHUB_TOKEN: "boss-token", CODEX_BOSS_GITHUB_IDENTITY: "codex-boss-bot" }
    });
    const result = provider.getAutomationCredential();
    expect(result.status).toBe("AVAILABLE");
    if (result.status === "AVAILABLE") {
      expect(result.credential.identity).toBe("codex-boss-bot");
      expect(result.credential.source).toBe("CODEX_BOSS_GITHUB_TOKEN");
    }
    expect(provider.describe()).toEqual({ configured: true, identity: "codex-boss-bot", source: "CODEX_BOSS_GITHUB_TOKEN" });
  });

  it("refuses a 'dedicated' credential that is really the Owner's token", () => {
    const provider = new EnvironmentBossGitHubCredentialProvider({
      environment: { PATH: "/x", GH_TOKEN: "owner-token", CODEX_BOSS_GITHUB_TOKEN: "owner-token" }
    });
    const result = provider.getAutomationCredential();
    expect(result.status).toBe("BLOCKED_EXTERNAL");
    if (result.status === "BLOCKED_EXTERNAL") expect(result.reason).toMatch(/byte-identical to an ambient Owner credential/);
  });

  it("refuses a Boss identity that is the Root Owner", () => {
    const provider = new EnvironmentBossGitHubCredentialProvider({
      environment: { PATH: "/x", CODEX_BOSS_GITHUB_TOKEN: "boss-token", CODEX_BOSS_GITHUB_IDENTITY: "zhiheng-zhang-Mera" },
      rootOwner: "zhiheng-zhang-Mera"
    });
    const result = provider.getAutomationCredential();
    expect(result.status).toBe("BLOCKED_EXTERNAL");
    if (result.status === "BLOCKED_EXTERNAL") expect(result.reason).toMatch(/is the Root Owner/);
  });

  it("makes 'no provider configured' a first-class state rather than a crash", () => {
    const provider = new UnconfiguredBossGitHubCredentialProvider();
    expect(provider.getAutomationCredential().status).toBe("BLOCKED_EXTERNAL");
    expect(provider.describe().configured).toBe(false);
  });
});
