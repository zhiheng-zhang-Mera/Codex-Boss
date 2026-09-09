import { expect, it } from "vitest";
import { loginScan, providerLoginScan } from "../../src/shared/login-scan";

/**
 * R-205: fast-login scan. Aggregates account modes + session lifecycles into a
 * per-provider status with operator hints; login/MFA/CAPTCHA are external steps
 * (externalOnly), never auto-solved or hidden.
 */

it("maps account mode + lifecycle onto a scan status and hint", () => {
  expect(providerLoginScan("chatgpt", "READY", "LOGGED_IN").status).toBe("READY");
  expect(providerLoginScan("qwen", "AUTH_REQUIRED", "REAUTH_REQUIRED").status).toBe("REAUTH_REQUIRED");
  expect(providerLoginScan("gemini", undefined, "UNKNOWN").status).toBe("LOGIN_REQUIRED");
  expect(providerLoginScan("qwen", "AUTH_REQUIRED", "REAUTH_REQUIRED").externalOnly).toBe(true);
  expect(providerLoginScan("chatgpt", "READY", "LOGGED_IN").needsOperator).toBe(false);
});

it("aggregates a full scan: ready providers vs operators needed", () => {
  const summary = loginScan(
    [
      { providerId: "chatgpt", mode: "READY" },
      { providerId: "gemini", mode: "AUTH_REQUIRED" },
      { providerId: "deepseek", mode: "READY" }
    ],
    { chatgpt: "LOGGED_IN", gemini: "REAUTH_REQUIRED", qwen: "FAILED" }
  );
  expect(summary.readyCount).toBe(2);
  expect(summary.needsOperatorCount).toBe(2); // gemini reauth + qwen failed/unknown login
  expect(summary.providers.find((item) => item.providerId === "gemini")?.status).toBe("REAUTH_REQUIRED");
  expect(summary.providers.find((item) => item.providerId === "chatgpt")?.hint).toContain("可用");
});
