import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { SecretVaultStore } from "../security/secret-vault-store";
import { loadGitHubMachineIdentityConfig } from "./github-config";
import { GitHubAppAuthProvider, fetchGitHubHttpTransport } from "./github-app-auth";
import { GitHubGateway } from "./github-gateway";
import { SecretVaultProvider } from "./secret-provider";
import { checkNodeGitHubCapabilities } from "./node-github-self-check";

export interface PlatformSecretCrypto {
  protect(plainText: string): string;
  unprotect(cipherText: string): string;
}

function commandAvailable(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => execFile(command, args, { windowsHide: true, timeout: 5_000 }, (error) => resolve(!error)));
}

function persistentNodeId(filePath: string): string {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as { schemaVersion?: number; nodeId?: string };
    if (value.schemaVersion === 1 && typeof value.nodeId === "string" && /^node-[a-f0-9-]+$/.test(value.nodeId)) return value.nodeId;
    throw new Error("Invalid node identity file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const nodeId = `node-${randomUUID()}`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, nodeId }, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
    return nodeId;
  }
}

/** Optional production composition root. Missing config disables only GitHub. */
export function createGitHubMachineRuntime(input: { userData: string; crypto: PlatformSecretCrypto }):
  | { configured: false }
  | { configured: true; nodeId: string; auth: GitHubAppAuthProvider; gateway: GitHubGateway; selfCheck(): ReturnType<typeof checkNodeGitHubCapabilities> } {
  const root = path.join(input.userData, ".boss");
  const configFile = path.join(root, "github-machine-identity.json");
  if (!fs.existsSync(configFile)) return { configured: false };
  const config = loadGitHubMachineIdentityConfig(configFile);
  const vault = new SecretVaultStore(path.join(root, "secret-vault.json"), input.crypto.protect, input.crypto.unprotect, "machine-identity");
  const secrets = new SecretVaultProvider(vault, process.platform === "win32" ? "windows-secure-store" : "platform-secure-store");
  const auth = new GitHubAppAuthProvider(config, secrets, fetchGitHubHttpTransport);
  const nodeId = persistentNodeId(path.join(root, "node-machine-identity.json"));
  const gateway = new GitHubGateway({ config, auth, transport: fetchGitHubHttpTransport, nodeId });
  return {
    configured: true, nodeId, auth, gateway,
    selfCheck: async () => checkNodeGitHubCapabilities({
      auth,
      gitAvailable: await commandAvailable("git", ["--version"]),
      filesystemAvailable: fs.existsSync(root),
      testAvailable: fs.existsSync(path.join(process.cwd(), "package.json")),
      networkAvailable: true
    })
  };
}
