/**
 * Secret Vault model (plan §28b hardware-backed secrets, security/secret_vault/).
 * Pure and shareable: entries never carry plaintext — only ciphertext produced
 * by the platform crypto backend (Electron safeStorage) plus metadata.
 */

export type SecretPurpose =
  | "api-key"
  | "oauth-token"
  | "signing-key"
  | "backup-passphrase"
  | "adapter-credential";

export interface SecretVaultEntry {
  /** Base64 ciphertext from the platform backend; never plaintext. */
  cipherText: string;
  purpose: SecretPurpose;
  createdAt: string;
  updatedAt: string;
}

export interface SecretVaultFile {
  schemaVersion: 1;
  vaultName: string;
  entries: Record<string, SecretVaultEntry>;
}

export interface SecretMeta {
  name: string;
  purpose: SecretPurpose;
  createdAt: string;
  updatedAt: string;
}

/** Guardian-root areas for §28 purposes whose ceremony must be root-tier. */
export function guardianAreaFor(purpose: SecretPurpose): string | undefined {
  if (purpose === "signing-key") return "production.signing";
  if (purpose === "backup-passphrase") return "backup.deletion";
  return undefined;
}

/**
 * Fail-closed validator: returns null unless the file is exactly a v1 vault.
 * Entries carrying a `plaintext` field (leakage) are rejected outright.
 */
export function validateSecretVault(value: unknown): SecretVaultFile | null {
  if (typeof value !== "object" || value === null) return null;
  const file = value as Record<string, unknown>;
  if (file.schemaVersion !== 1) return null;
  if (typeof file.vaultName !== "string") return null;
  if (typeof file.entries !== "object" || file.entries === null || Array.isArray(file.entries)) return null;
  const entries = file.entries as Record<string, unknown>;
  for (const [name, raw] of Object.entries(entries)) {
    if (typeof name !== "string" || name.length === 0) return null;
    if (typeof raw !== "object" || raw === null) return null;
    const entry = raw as Record<string, unknown>;
    if ("plaintext" in entry) return null; // plaintext leakage → reject
    if (typeof entry.cipherText !== "string" || entry.cipherText.length === 0) return null;
    const purposes: SecretPurpose[] = ["api-key", "oauth-token", "signing-key", "backup-passphrase", "adapter-credential"];
    if (typeof entry.purpose !== "string" || !purposes.includes(entry.purpose as SecretPurpose)) return null;
    if (typeof entry.createdAt !== "string") return null;
    if (typeof entry.updatedAt !== "string") return null;
  }
  return file as unknown as SecretVaultFile;
}
