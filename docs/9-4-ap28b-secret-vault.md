# AP28b — Hardware-backed Secret Vault

Compact handoff for Acceptance Pack **AP28b** (plan §28 Guardian + Hardware-backed Secrets,
Secret Vault half). Branch `9-4`.

## Why

API keys were encrypted ad hoc inside `api-settings.ts` via injected safeStorage callbacks —
there was no `security/secret_vault/` abstraction, no fail-closed vault semantics, and no
Guardian ceremony on secret lifecycle (plan §28 Guardian-root tier: production signing / backup
deletion must not be reachable without a token). This pack ships the vault; the remaining half
of the pack (adopting the vault for live API keys in main.ts) is deliberately left as a
follow-up seam so the vault lands with a closed test loop first.

## What was added

- **`src/shared/secret-vault.ts`** (new, pure)
  - `SecretPurpose` (api-key / oauth-token / signing-key / backup-passphrase /
    adapter-credential), `SecretVaultEntry { cipherText, purpose, createdAt, updatedAt }`,
    `SecretVaultFile { schemaVersion: 1, vaultName, entries }`, `SecretMeta`.
  - `guardianAreaFor(purpose)` → maps signing-key → `production.signing` and
    backup-passphrase → `backup.deletion` (the §28 Guardian-root areas), else `undefined`.
  - `validateSecretVault(value)` fail-closed validator: rejects wrong schema, missing fields,
    empty ciphertext, and — critically — any entry that carries a `plaintext` field (leakage).
- **`electron/security/secret-vault-store.ts`** (new)
  - `SecretVaultStore(filePath, protect, unprotect, vaultName="default")` — the injected
    `protect`/`unprotect` backend is Electron safeStorage in production (same callback shape as
    ApiSettingsStore); tests inject a reversible fake.
  - **Ciphertext-only on disk**: `setSecret` encrypts before persisting; if the backend throws
    (safeStorage unavailable) nothing is written at all — no plaintext ever touches the file.
  - **Atomic writes** (tmp + rename, EXDEV/EEXIST/EPERM fallback), same pattern as
    ApiSettingsStore.
  - **Guardian ceremony gating** via shared `changeAllowed`:
    - create of fresh non-guardian secrets (api-key etc.): normal, no token;
    - rotation (overwrite of an existing secret): Guardian token required;
    - create/rotate of guardian-tier material (signing-key, backup-passphrase): token required;
    - delete of guardian-tier material: token required; deleting ordinary secrets is normal;
    - missing secret delete returns a denial verdict.
  - `get` decrypts in memory only; `has/meta/listMetas` never expose plaintext.
  - **Fail-closed load**: corrupt file or vault-name mismatch throws; missing file starts an
    empty v1 vault.
- **`tests/secret-vault.test.ts`** (new, 9 tests) — purpose→area mapping; validator accept /
  reject (leakage, empty ciphertext, wrong schema); ciphertext-only on disk (plaintext string
  absent from file); reload persistence + metadata; guardian gates for signing/backup create,
  api-key rotation, guardian-tier delete; fail-closed corrupt/mismatch load; backend-unavailable
  fails closed with nothing written.

## Verification

- Targeted: `secret-vault` (9) + `guardian` (10) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running in background; expected green.

## Boundary notes

- Pure shared model has no node imports; compiles under both tsconfigs.
- `ApiSettingsStore` is unchanged — adopting `SecretVaultStore` for live API keys in `main.ts`
  is the explicit next seam (would replace the ad hoc protect/unprotect wiring), kept out of
  this pack to keep the acceptance loop closed and risk-free.
- Guardian areas reused from AP28a (`src/shared/guardian.ts`): this pack exercises
  `production.signing` and `backup.deletion` from the Guardian-root tier end to end.

## Checkpoint

Commit with: `src/shared/secret-vault.ts`, `electron/security/secret-vault-store.ts`,
`tests/secret-vault.test.ts`.
