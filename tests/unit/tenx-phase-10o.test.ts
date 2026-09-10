/**
 * Phase 10O evidence test: login health scanner.
 * Reports provider/sessionPresent/authenticated/requiresLogin/requiresMFA/
 * requiresCaptcha/expired/unknown; observations-only; MFA/CAPTCHA → human-gated
 * state (never bypassed, never crashes); throwing probe isolated to unknown;
 * durable restart.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isHumanGated, type LoginHealthReport } from "../../src/shared/tenx/session";
import { TenxLoginHealthScanner } from "../../electron/tenx/login-health";

const at = "2026-09-10T00:00:00.000Z";

describe("10O pure gating", () => {
  it("MFA/CAPTCHA/login/expired are human-gated; authenticated is not", () => {
    const base = { provider: "p", account: "a", sessionPresent: true, authenticated: false, requiresLogin: false, requiresMFA: false, requiresCaptcha: false, expired: false, unknown: false, humanGated: false, scannedAt: at };
    expect(isHumanGated({ ...base, requiresMFA: true })).toBe(true);
    expect(isHumanGated({ ...base, requiresCaptcha: true })).toBe(true);
    expect(isHumanGated({ ...base, expired: true })).toBe(true);
    expect(isHumanGated({ ...base, authenticated: true })).toBe(false);
  });
});

describe("10O scanner", () => {
  it("reports full per-provider status from observations", async () => {
    const scanner = new TenxLoginHealthScanner(undefined, () => at, async () => ({ sessionPresent: true, authenticated: true }));
    const report = await scanner.scan("p1");
    expect(report.authenticated).toBe(true);
    expect(report.sessionPresent).toBe(true);
    expect(report.humanGated).toBe(false);
    expect(report.scannedAt).toBe(at);
  });

  it("never fabricates authenticated: unobserved means unknown", async () => {
    const scanner = new TenxLoginHealthScanner(undefined, () => at, async () => ({}));
    const report = await scanner.scan("p2");
    expect(report.authenticated).toBe(false);
    expect(report.unknown).toBe(true);
  });

  it("MFA/CAPTCHA states become human-gated reports (never bypassed)", async () => {
    const scanner = new TenxLoginHealthScanner(undefined, () => at, async () => ({ sessionPresent: true, requiresMFA: true }));
    const report = await scanner.scan("p3");
    expect(report.requiresMFA).toBe(true);
    expect(report.humanGated).toBe(true);
    expect(scanner.humanGated().some((item) => item.provider === "p3")).toBe(true);
  });

  it("a throwing probe is isolated into an unknown report (Boss never crashes)", async () => {
    const scanner = new TenxLoginHealthScanner(undefined, () => at, async () => {
      throw new Error("adapter crashed");
    });
    const report = await scanner.scan("p4");
    expect(report.unknown).toBe(true);
    expect(report.authenticated).toBe(false);
    // scanner still usable after probe crash
    const again = await scanner.scan("p5");
    expect(again.unknown).toBe(true);
  });

  it("observe applies an external observation without a probe", () => {
    const scanner = new TenxLoginHealthScanner(undefined, () => at);
    const report = scanner.observe("p6", "acct-1", { sessionPresent: true, requiresCaptcha: true });
    expect(report.account).toBe("acct-1");
    expect(report.humanGated).toBe(true);
    expect(scanner.humanGated().some((item) => item.provider === "p6")).toBe(true);
  });

  it("durable restart restores reports", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10o-"));
    const file = path.join(dir, "login-health.json");
    try {
      const first = new TenxLoginHealthScanner(file, () => at, async () => ({ authenticated: true }));
      await first.scan("p1");
      const second = new TenxLoginHealthScanner(file, () => at);
      expect(second.status("p1")?.authenticated).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
