import type { GitHubCapability, GitHubResult } from "../../src/shared/github-machine";
import type { GitHubAppAuthProvider } from "./github-app-auth";

export interface GitHubNodeSelfCheck {
  configured: boolean;
  credentialProviderAvailable: boolean;
  authenticationHealthy: boolean;
  installationReachable: boolean;
  capabilities: Record<GitHubCapability, boolean>;
  error?: string;
}

export async function checkNodeGitHubCapabilities(input: {
  auth: GitHubAppAuthProvider;
  gitAvailable: boolean;
  filesystemAvailable: boolean;
  testAvailable: boolean;
  networkAvailable: boolean;
  writeConfigured?: boolean;
}): Promise<GitHubNodeSelfCheck> {
  const description = input.auth.describe();
  const token = await input.auth.getInstallationToken(true);
  const healthy = token.ok;
  return {
    configured: description.enabled && description.appIdConfigured && description.installationIdConfigured,
    credentialProviderAvailable: description.credentialProviderAvailable,
    authenticationHealthy: healthy,
    installationReachable: healthy,
    capabilities: {
      git: input.gitAvailable,
      "github.read": healthy && input.networkAvailable,
      "github.write": healthy && input.networkAvailable && (input.writeConfigured ?? true),
      "credential.github": description.credentialProviderAvailable,
      filesystem: input.filesystemAvailable,
      test: input.testAvailable,
      network: input.networkAvailable
    },
    error: token.ok ? undefined : token.code
  };
}
