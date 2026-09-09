import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { canTransition, lifecycleForAccountMode, SESSION_LIFECYCLES } from "../../src/shared/session-lifecycle";
import { SessionLifecycleLedger } from "../../electron/identity/session-lifecycle-ledger";
import { AccountSessionManager } from "../../electron/account-sessions";
import { StateStore } from "../../electron/store";

/**
 * R-203: account/session lifecycle. Durable per-provider records with an
 * explicit transition table; one provider's expiry/failure never touches
 * another provider (isolation), and FAILED never silently flips back to
 * LOGGED_IN without fresh evidence.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function file(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-lifecycle-"));
  dirs.push(dir);
  return path.join(dir, "lifecycle.json");
}

it("transition table: legal hops allowed, arbitrary hops rejected", () => {
  expect(SESSION_LIFECYCLES).toContain("UNKNOWN");
  expect(canTransition("UNKNOWN", "CHECKING")).toBe(true);
  expect(canTransition("CHECKING", "LOGGED_IN")).toBe(true);
  expect(canTransition("LOGGED_IN", "EXPIRED")).toBe(true);
  expect(canTransition("LOGGED_IN", "REAUTH_REQUIRED")).toBe(true);
  expect(canTransition("LOGGED_IN", "UNKNOWN")).toBe(false); // no silent "lost" state
  expect(canTransition("FAILED", "LOGGED_IN")).toBe(true); // only with fresh evidence
});

it("account-mode probe maps onto lifecycle states", () => {
  expect(lifecycleForAccountMode("READY")).toBe("LOGGED_IN");
  expect(lifecycleForAccountMode("GUEST_READY")).toBe("LOGGED_IN");
  expect(lifecycleForAccountMode("AUTH_REQUIRED")).toBe("REAUTH_REQUIRED");
  expect(lifecycleForAccountMode("UNKNOWN")).toBe("UNKNOWN");
});

it("ledger is durable and per-provider isolated (expiry on one never touches another)", () => {
  const target = file();
  const ledger = new SessionLifecycleLedger(target);
  expect(ledger.record("chatgpt", "CHECKING", "probe start")?.state).toBe("CHECKING");
  expect(ledger.record("chatgpt", "LOGGED_IN", "ready input")?.state).toBe("LOGGED_IN");
  expect(ledger.record("chatgpt", "EXPIRED", "session expired")?.state).toBe("EXPIRED");
  expect(ledger.record("qwen", "REAUTH_REQUIRED", "needs login")?.state).toBe("REAUTH_REQUIRED");

  // chatgpt expired; qwen is only REAUTH_REQUIRED — isolation holds.
  expect(ledger.state("chatgpt")).toBe("EXPIRED");
  expect(ledger.state("qwen")).toBe("REAUTH_REQUIRED");
  expect(ledger.state("gemini")).toBe("UNKNOWN"); // untouched providers stay UNKNOWN

  // Durability across reopen: state + transition history preserved.
  const reopened = new SessionLifecycleLedger(target);
  expect(reopened.state("chatgpt")).toBe("EXPIRED");
  expect(reopened.state("qwen")).toBe("REAUTH_REQUIRED");
});

it("ledger survives a reopen with identical per-provider state and transition history", () => {
  const target = file();
  const ledger = new SessionLifecycleLedger(target);
  ledger.record("chatgpt", "CHECKING", "start");
  ledger.record("chatgpt", "LOGGED_IN", "ready");
  const reopened = new SessionLifecycleLedger(target);
  expect(reopened.state("chatgpt")).toBe("LOGGED_IN");
  const record = reopened.list().find((item) => item.providerId === "chatgpt")!;
  expect(record.transitions.map((item) => item.to)).toEqual(["CHECKING", "LOGGED_IN"]);
});

it("a corrupt ledger fails closed (never silently drops lifecycle state)", () => {
  const target = file();
  new SessionLifecycleLedger(target).record("chatgpt", "CHECKING", "start");
  fs.writeFileSync(target, "{broken", "utf8");
  expect(() => new SessionLifecycleLedger(target)).toThrow();
});

it("AccountSessionManager wiring: probe observations drive durable lifecycle per provider", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "account-session-wiring-"));
  dirs.push(dir);
  const store = new StateStore(path.join(dir, ".boss", "state.json"));
  const ledger = new SessionLifecycleLedger(path.join(dir, "lifecycle.json"));
  const manager = new AccountSessionManager(store, () => undefined, ledger);

  manager.ensure("chatgpt");
  expect(ledger.state("chatgpt")).toBe("CHECKING");

  manager.recordProbe("chatgpt", true, false); // READY
  expect(ledger.state("chatgpt")).toBe("LOGGED_IN");
  expect(store.snapshot().accounts.find((account) => account.providerId === "chatgpt")?.mode).toBe("READY");

  manager.recordProbe("qwen", false, true); // AUTH_REQUIRED
  expect(ledger.state("qwen")).toBe("REAUTH_REQUIRED");
  expect(ledger.state("chatgpt")).toBe("LOGGED_IN"); // chatgpt unaffected
});
