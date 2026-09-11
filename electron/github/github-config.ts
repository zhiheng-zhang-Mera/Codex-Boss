import fs from "node:fs";
import { validateGitHubMachineIdentityConfig, type GitHubMachineIdentityConfig } from "../../src/shared/github-machine";

export function loadGitHubMachineIdentityConfig(filePath: string): GitHubMachineIdentityConfig {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  const config = validateGitHubMachineIdentityConfig(raw);
  if (!config) throw new Error("Invalid GitHub machine identity configuration (fail-closed)");
  return config;
}
