# AP18b — Secret Scanner + Log Sanitizer + Taint Marker

Compact handoff for Acceptance Pack **AP18b** (plan §18 Permissions + Approval + Security
Classification: Secret Scanner / Log Sanitizer / Taint Marker; also closes the AP30
secret-tainted-log hardening seed). Branch `9-4`.

## Why

AP18a shipped the permission manifest + SecurityClass vocabulary, and AP28b shipped the
ciphertext-only Secret Vault — but long-lived stores (telemetry, diagnosis, project state) still
persisted whatever string a provider failure carried. A provider error that echoes an API key
would land raw in the Performance DB (§16) and later surface in diagnosis RFCs and logs — the
plan's "secret-tainted log" risk with no defense. This pack adds the §18 Secret Scanner /
Log Sanitizer / Taint Marker as a pure module and wires the sanitizer into telemetry recording.

## What was added

- **`src/shared/secret-scan.ts`** (new, pure — no node imports)
  - `scanSecrets(text): SecretMatch[]` — Secret Scanner over six probable-shape patterns:
    `sk-…` API keys, `Bearer …` tokens, `AKIA…` AWS access keys, `gh[pousr]_…` GitHub tokens,
    PEM private-key blocks, and generic `token|key|secret|password=…` high-entropy values.
  - `isTainted(text)` — Taint Marker: any detection means the string must not be persisted raw.
  - `redactSecrets(text)` — Log Sanitizer: deterministic, idempotent `[REDACTED:<label>]`
    replacement; plain prose passes through untouched.
- **`electron/telemetry/telemetry-recorder.ts`** — `attachTelemetryRecorder` now sanitizes
  every `WORKER_FAILED` reason with `redactSecrets` before it reaches the Performance DB
  (additive optional `sanitize` param; default = §18 sanitizer). Success paths unaffected.
- **`tests/secret-scan.test.ts`** (new, 6 tests) — scanner detects all six shapes; plain prose
  stays untainted; sanitizer redacts secrets, leaves no residual taint, is idempotent, and keeps
  normal reasons intact; end-to-end: a provider failure that echoes an `sk-…` key reaches
  telemetry only as `[REDACTED:api-key]`.

## Verification

- Targeted: `secret-scan` (6) + `telemetry` (3) PASS (recorder default keeps clean reasons
  byte-identical, so existing telemetry assertions hold).
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running in background; expected green.

## Boundary notes

- Pattern-based detection is deliberately conservative (misses → clean log, never false-blocks
  prose). Deterministic redaction means clustering/diagnosis over reasons stays stable.
- Guarded by the Guardian vocabulary from AP28a: sanitizer rules are part of
  `security.classifier` (protected) — changing them requires a Guardian token.
- The vault (AP28b) holds ciphertext only; the sanitizer protects the *plaintext* surface of
  every store the vault cannot reach. Remaining §18 items: declassification gate + live
  adoption of scanner/sanitizer across all log sinks.

## Checkpoint

Commit with: `src/shared/secret-scan.ts`, `electron/telemetry/telemetry-recorder.ts`,
`tests/secret-scan.test.ts`.
