import fs from "node:fs";
import path from "node:path";
import { app, dialog, safeStorage } from "electron";
import { SecretVaultStore } from "../security/secret-vault-store";
import { BOSS_GITHUB_LOGICAL_IDENTITY, validateGitHubMachineIdentityConfig } from "../../src/shared/github-machine";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

app.whenReady().then(async () => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Platform secure storage is unavailable");
  const pemFile = path.resolve(argument("--pem-file"));
  const pem = fs.readFileSync(pemFile, "utf8");
  if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(pem)) throw new Error("The selected file is not a PEM private key");
  const repositories = argument("--repositories").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const config = validateGitHubMachineIdentityConfig({
    schemaVersion: 1, enabled: true, logicalIdentity: BOSS_GITHUB_LOGICAL_IDENTITY,
    appId: argument("--app-id"), installationId: argument("--installation-id"),
    privateKeyRef: "github/codex-boss", allowedRepositories: repositories
  });
  if (!config) throw new Error("Invalid App ID, Installation ID, or repository allowlist");
  const root = path.join(app.getPath("userData"), ".boss");
  const vault = new SecretVaultStore(
    path.join(root, "secret-vault.json"),
    (plainText) => safeStorage.encryptString(plainText).toString("base64"),
    (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, "base64")),
    "machine-identity"
  );
  const confirmation = await dialog.showMessageBox({
    type: "warning",
    title: "Codex-Boss Root Owner credential ceremony",
    message: "Register or rotate the GitHub App private key for Codex-Boss?",
    detail: "This is a Root Owner action. The key will be encrypted with this node's platform secure store and will not be shown or logged.",
    buttons: ["Cancel", "Register securely"],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) throw new Error("Root Owner cancelled credential registration");
  const verdict = vault.setSecret(config.privateKeyRef, pem, "signing-key", true);
  if (!verdict.allowed) throw new Error("Guardian refused GitHub App key registration");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "github-machine-identity.json"), JSON.stringify(config, null, 2), "utf8");
  console.log(`GITHUB_MACHINE_BOOTSTRAP=OK repositories=${repositories.length} backend=platform-secure-store`);
  app.quit();
}).catch((error) => {
  console.error(`GITHUB_MACHINE_BOOTSTRAP=FAILED ${String(error).replace(/-----BEGIN[\s\S]*/g, "[REDACTED]")}`);
  app.exit(1);
});
