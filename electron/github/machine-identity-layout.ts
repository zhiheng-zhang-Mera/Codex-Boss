/**
 * Where the GitHub machine identity keeps its durable state — declared once, here.
 *
 * ## Why this module exists
 *
 * The vaule's file name and its vault label were both written out at every construction site:
 *
 *   - `electron/github/bootstrap.ts` — the Root Owner credential ceremony;
 *   - `electron/github/github-machine-runtime.ts` — the production composition root.
 *
 * Two callers, each deciding independently what the file is called and what label the vault entries
 * live under. `PF-DEBT-008` records it: a security surface where the path and the label are decided in
 * two places is one where a change to either silently disagrees with the other — for example a label
 * change that makes the ceremony write entries the runtime can no longer find, which presents as
 * "credentials not configured" rather than as an error.
 *
 * ## Scope
 *
 * This declares the machine-identity LAYOUT. It does not decide where the `.boss` root is; that is the
 * caller's data root, which is already resolved from `runtime-paths.ts` elsewhere in the platform. The
 * remaining duplication of `.boss` itself is recorded rather than silently absorbed here, because
 * collapsing it would mean deciding a root policy, which is a different change from making one
 * security surface agree with itself.
 */

import path from "node:path";

/** The files that make up the GitHub machine identity's durable state. */
export const GITHUB_MACHINE_IDENTITY_FILES = {
  /** The (non-secret) identity configuration: app id, installation id, allowlist. */
  config: "github-machine-identity.json",
  /** The secret vault holding the App private key. Encrypted by the platform secure store. */
  vault: "secret-vault.json",
  /** The persistent node identity used to attribute GitHub actions to this machine. */
  node: "node-machine-identity.json"
} as const;

/**
 * The vault label machine-identity secrets are stored under.
 *
 * A label is part of the lookup key, so it is part of the contract: the ceremony that WRITES the key
 * and the runtime that READS it must use the same one, which is the whole point of declaring it here.
 */
export const GITHUB_MACHINE_IDENTITY_VAULT_LABEL = "machine-identity";

/** The resolved file layout. Callers receive one from `githubMachineIdentityAt`; the shape is not
 *  exported because nothing outside needs to name it — a caller reads the fields it wants. */
interface GitHubMachineIdentityLayout {
  /** The `.boss` directory the caller supplied. Reported so a caller can see which root it resolved. */
  readonly directory: string;
  readonly configFile: string;
  readonly vaultFile: string;
  readonly nodeFile: string;
  /** The label the vault must be constructed with, so writer and reader cannot disagree. */
  readonly vaultLabel: string;
}

/** Resolve the machine identity's files under a `.boss` root. */
export function githubMachineIdentityAt(bossDirectory: string): GitHubMachineIdentityLayout {
  const directory = path.resolve(bossDirectory);
  return {
    directory,
    configFile: path.join(directory, GITHUB_MACHINE_IDENTITY_FILES.config),
    vaultFile: path.join(directory, GITHUB_MACHINE_IDENTITY_FILES.vault),
    nodeFile: path.join(directory, GITHUB_MACHINE_IDENTITY_FILES.node),
    vaultLabel: GITHUB_MACHINE_IDENTITY_VAULT_LABEL
  };
}
