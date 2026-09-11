import type { SecretVaultStore } from "../security/secret-vault-store";

export interface SecretLease {
  /** Secret exists only in this host-side lease and must never be serialized. */
  readonly value: string;
  dispose(): void;
}

export interface SecretProviderStatus {
  available: boolean;
  backend: string;
  reference: string;
}

/** Node-local backend abstraction; task and Boss identities never name a host path. */
export interface SecretProvider {
  status(reference: string): SecretProviderStatus;
  resolve(reference: string): SecretLease;
}

export class SecretVaultProvider implements SecretProvider {
  constructor(private readonly vault: Pick<SecretVaultStore, "has" | "get">, private readonly backend: string) {}

  status(reference: string): SecretProviderStatus {
    return { available: this.vault.has(reference), backend: this.backend, reference };
  }

  resolve(reference: string): SecretLease {
    if (!this.vault.has(reference)) throw new Error(`Secret reference ${reference} is not available`);
    let value = this.vault.get(reference);
    return {
      get value() {
        if (!value) throw new Error("Secret lease has been disposed");
        return value;
      },
      dispose() { value = ""; }
    };
  }
}
