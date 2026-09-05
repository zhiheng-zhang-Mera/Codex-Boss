import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { guardianAreaFor, validateSecretVault } from "../src/shared/secret-vault";
import { SecretVaultStore } from "../electron/security/secret-vault-store";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-vault-")); dirs.push(dir); return dir; }

// Fake hardware backend: reversible transform; real deployments inject
// Electron safeStorage.encryptString/decryptString.
function protect(plainText: string): string { return Buffer.from(`hw:${plainText}`, "utf8").toString("base64"); }
function unprotect(cipherText: string): string {
  const decoded = Buffer.from(cipherText, "base64").toString("utf8");
  if (!decoded.startsWith("hw:")) throw new Error("decrypt failed");
  return decoded.slice(3);
}

function fileContent(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("secret vault model", () => {
  it("maps signing/backup purposes to guardian-root areas", () => {
    expect(guardianAreaFor("signing-key")).toBe("production.signing");
    expect(guardianAreaFor("backup-passphrase")).toBe("backup.deletion");
    expect(guardianAreaFor("api-key")).toBeUndefined();
    expect(guardianAreaFor("oauth-token")).toBeUndefined();
    expect(guardianAreaFor("adapter-credential")).toBeUndefined();
  });

  it("accepts a well-formed v1 vault and rejects leakage/corruption", () => {
    const ok = validateSecretVault({
      schemaVersion: 1,
      vaultName: "default",
      entries: { k: { cipherText: "abc", purpose: "api-key", createdAt: "2026-01-01", updatedAt: "2026-01-01" } },
    });
    expect(ok).not.toBeNull();
    expect(validateSecretVault({ schemaVersion: 9, vaultName: "default", entries: {} })).toBeNull();
    expect(validateSecretVault({ schemaVersion: 1, vaultName: "default", entries: { k: { plaintext: "leak", purpose: "api-key", createdAt: "x", updatedAt: "x" } } })).toBeNull();
    expect(validateSecretVault({ schemaVersion: 1, vaultName: "default", entries: { k: { cipherText: "", purpose: "api-key", createdAt: "x", updatedAt: "x" } } })).toBeNull();
  });
});

describe("secret vault store", () => {
  it("stores ciphertext-only and round-trips through the backend", () => {
    const file = path.join(root(), "vault.json");
    const store = new SecretVaultStore(file, protect, unprotect, "default");
    const verdict = store.setSecret("deepseek", "sk-secret-123", "api-key", false);
    expect(verdict.allowed).toBe(true);
    expect(store.get("deepseek")).toBe("sk-secret-123");
    expect(fileContent(file)).not.toContain("sk-secret-123"); // no plaintext on disk
    expect(fileContent(file)).toContain("cipherText");
  });

  it("persists across reload with metadata intact", () => {
    const file = path.join(root(), "vault.json");
    const store = new SecretVaultStore(file, protect, unprotect, "default");
    store.setSecret("gemini", "sk-g", "api-key", false);
    store.setSecret("signing", "sig-material", "signing-key", true);
    const reloaded = new SecretVaultStore(file, protect, unprotect, "default");
    expect(reloaded.has("gemini")).toBe(true);
    expect(reloaded.has("signing")).toBe(true);
    expect(reloaded.meta("signing")?.purpose).toBe("signing-key");
    expect(reloaded.listMetas().map((m) => m.name).sort()).toEqual(["gemini", "signing"]);
    expect(reloaded.get("signing")).toBe("sig-material");
  });

  it("requires a Guardian token to create signing-key/backup-passphrase material", () => {
    const file = path.join(root(), "vault.json");
    const store = new SecretVaultStore(file, protect, unprotect, "default");
    const denied = store.setSecret("backup", "passphrase", "backup-passphrase", false);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/Guardian denial/);
    expect(store.has("backup")).toBe(false); // fails closed
    const allowed = store.setSecret("backup", "passphrase", "backup-passphrase", true);
    expect(allowed.allowed).toBe(true);
    expect(store.get("backup")).toBe("passphrase");
  });

  it("allows rotation of an existing api-key only with a Guardian token", () => {
    const file = path.join(root(), "vault.json");
    const store = new SecretVaultStore(file, protect, unprotect, "default");
    store.setSecret("deepseek", "sk-old", "api-key", false);
    const denied = store.setSecret("deepseek", "sk-new", "api-key", false);
    expect(denied.allowed).toBe(false);
    expect(store.get("deepseek")).toBe("sk-old"); // unchanged
    const allowed = store.setSecret("deepseek", "sk-new", "api-key", true);
    expect(allowed.allowed).toBe(true);
    expect(store.get("deepseek")).toBe("sk-new");
  });

  it("guards deletion of guardian-tier secrets but allows api-key deletion", () => {
    const file = path.join(root(), "vault.json");
    const store = new SecretVaultStore(file, protect, unprotect, "default");
    store.setSecret("api", "sk-a", "api-key", false);
    store.setSecret("signing", "sig", "signing-key", true);
    const denied = store.deleteSecret("signing", false);
    expect(denied.allowed).toBe(false);
    expect(store.has("signing")).toBe(true);
    expect(store.deleteSecret("signing", true).allowed).toBe(true);
    expect(store.has("signing")).toBe(false);
    expect(store.deleteSecret("api", false).allowed).toBe(true); // normal deletion
    expect(store.has("api")).toBe(false);
    expect(store.deleteSecret("missing", true).allowed).toBe(false);
  });

  it("fails closed on corrupt vault or vault-name mismatch", () => {
    const dir = root();
    const file = path.join(dir, "vault.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 9, vaultName: "default", entries: {} }));
    expect(() => new SecretVaultStore(file, protect, unprotect, "default")).toThrow(/Invalid/);
    const good = path.join(dir, "good.json");
    new SecretVaultStore(good, protect, unprotect, "default").setSecret("k", "v", "api-key", false);
    expect(() => new SecretVaultStore(good, protect, unprotect, "other")).toThrow(/mismatch/);
  });

  it("fails closed when the backend cannot encrypt (nothing persisted)", () => {
    const file = path.join(root(), "vault.json");
    const broken: typeof protect = () => { throw new Error("safeStorage unavailable"); };
    const store = new SecretVaultStore(file, broken, unprotect, "default");
    expect(() => store.setSecret("k", "plain", "api-key", false)).toThrow(/safeStorage unavailable/);
    expect(fs.existsSync(file)).toBe(false); // no plaintext ever written
  });
});
