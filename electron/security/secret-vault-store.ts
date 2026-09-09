import fs from "node:fs";
import path from "node:path";
import {
  guardianAreaFor,
  validateSecretVault,
  type SecretMeta,
  type SecretPurpose,
  type SecretVaultFile,
} from "../../src/shared/secret-vault";
import { changeAllowed, type GuardianVerdict } from "../../src/shared/guardian";

type Protect = (plainText: string) => string;
type Unprotect = (cipherText: string) => string;

/** Guardian verdict for writing/rotating/deleting the named secret. */
function mutationVerdict(
  vaultName: string,
  name: string,
  purpose: SecretPurpose,
  guardToken: boolean,
  op: "create" | "rotation" | "deletion",
  existing: boolean,
): GuardianVerdict {
  const scope = `${vaultName}:${name}`;
  const area = guardianAreaFor(purpose);
  // Creating a fresh non-guardian secret is a normal user action.
  if (op === "create" && !existing && !area) return { allowed: true, reason: `create ${name} in ${vaultName}` };
  // Rotation of ANY existing secret is a credential lifecycle ceremony.
  if (op === "rotation" && existing && !area) {
    if (!guardToken) return { allowed: false, reason: `Guardian denial: rotation of existing secret ${name} in ${vaultName}` };
    return { allowed: true, reason: `Guardian approved rotation of ${name} in ${vaultName}` };
  }
  // Deletion of a non-guardian secret (api-key etc.) is a normal user action.
  if (op === "deletion" && existing && !area) return { allowed: true, reason: `delete ${name} in ${vaultName}` };
  // Guardian-tier material (production.signing / backup.deletion): any
  // mutation needs the Guardian token.
  if (area) return changeAllowed(area, guardToken, scope);
  return { allowed: true, reason: `${op} ${name} in ${vaultName}` };
}

/**
 * Hardware-backed Secret Vault (plan §28b). Ciphertext-only on disk: entries
 * are produced by the injected platform crypto backend (Electron safeStorage)
 * and the file never carries plaintext. Loads fail closed on corruption or
 * leakage, writes are atomic, and rotation/deletion of guardian-tier secrets
 * require a Guardian token.
 */
export class SecretVaultStore {
  private file: SecretVaultFile;

  constructor(
    private readonly filePath: string,
    private readonly protect: Protect,
    private readonly unprotect: Unprotect,
    private readonly vaultName = "default",
  ) {
    this.file = this.read();
  }

  /** Store a secret. Overwriting an existing entry or writing a guardian-tier
   *  purpose requires a Guardian token. Fails closed if the backend cannot
   *  encrypt (no plaintext is ever persisted). */
  setSecret(name: string, plainText: string, purpose: SecretPurpose, guardToken: boolean): GuardianVerdict {
    const existing = name in this.file.entries;
    const verdict = mutationVerdict(this.vaultName, name, purpose, guardToken, existing ? "rotation" : "create", existing);
    if (!verdict.allowed) return verdict;
    const cipherText = this.protect(plainText); // throws when backend unavailable → nothing persisted
    const now = new Date().toISOString();
    const entry = this.file.entries[name];
    this.file.entries[name] = {
      cipherText,
      purpose,
      createdAt: entry?.createdAt ?? now,
      updatedAt: now,
    };
    this.persist();
    return verdict;
  }

  /** Read a secret back (decrypt in memory only). */
  get(name: string): string {
    const entry = this.file.entries[name];
    if (!entry) throw new Error(`Secret ${name} not found in vault ${this.vaultName}`);
    return this.unprotect(entry.cipherText);
  }

  has(name: string): boolean {
    return name in this.file.entries;
  }

  meta(name: string): SecretMeta | undefined {
    const entry = this.file.entries[name];
    if (!entry) return undefined;
    return { name, purpose: entry.purpose, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
  }

  listMetas(): SecretMeta[] {
    return Object.entries(this.file.entries).map(([name, entry]) => ({
      name,
      purpose: entry.purpose,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
  }

  /** Delete a secret. Guardian-tier purposes (backup deletion) need a token. */
  deleteSecret(name: string, guardToken: boolean): GuardianVerdict {
    const entry = this.file.entries[name];
    if (!entry) return { allowed: false, reason: `Guardian denial: secret ${name} not found in ${this.vaultName}` };
    const verdict = mutationVerdict(this.vaultName, name, entry.purpose, guardToken, "deletion", true);
    if (!verdict.allowed) return verdict;
    delete this.file.entries[name];
    this.persist();
    return verdict;
  }

  private read(): SecretVaultFile {
    try {
      const value = validateSecretVault(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
      if (!value) throw new Error("Invalid secret vault file");
      if (value.vaultName !== this.vaultName) throw new Error(`Vault name mismatch (${value.vaultName} != ${this.vaultName})`);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, vaultName: this.vaultName, entries: {} };
      }
      throw error; // corrupt or mismatched vault fails closed
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.file, null, 2), "utf8");
    try { fs.renameSync(temporary, this.filePath); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EXDEV", "EEXIST", "EPERM"].includes(code ?? "")) throw error;
      fs.copyFileSync(temporary, this.filePath);
      fs.unlinkSync(temporary);
    }
  }
}
