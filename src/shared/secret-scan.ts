/**
 * Secret Scanner + Log Sanitizer + Taint Marker (plan §18 security list;
 * AP30 secret-tainted-log hardening seed). Pure and shareable.
 *
 * Long-lived stores (telemetry, diagnosis, project state) must never persist
 * raw secrets. This module detects probable secret shapes (API keys, bearer
 * tokens, private keys) and redacts them deterministically so logs stay clean
 * while remaining readable.
 */

export type SecretShape =
  | "api-key-sk"
  | "bearer-token"
  | "aws-access-key"
  | "github-token"
  | "private-key"
  | "generic-long-token";

interface SecretPattern {
  shape: SecretShape;
  label: string;
  /** First capture group is the full secret to redact. */
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // OpenAI/DeepSeek/Anthropic-style sk-... keys (alphanumeric + hyphen/underscore).
  { shape: "api-key-sk", label: "api-key", regex: /\b(sk-[A-Za-z0-9_-]{16,})\b/g },
  // Authorization bearer tokens.
  { shape: "bearer-token", label: "bearer-token", regex: /\b(Bearer\s+[A-Za-z0-9._~+/=-]{16,})\b/g },
  // AWS access key ids.
  { shape: "aws-access-key", label: "aws-access-key", regex: /\b(AKIA[0-9A-Z]{16})\b/g },
  // GitHub personal access tokens.
  { shape: "github-token", label: "github-token", regex: /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g },
  // PEM private key blocks.
  { shape: "private-key", label: "private-key", regex: /(-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g },
  // Generic high-entropy tokens inside common labels.
  { shape: "generic-long-token", label: "token", regex: /\b(?:token|key|secret|password|passwd)\s*[=:]\s*([A-Za-z0-9._~+/=-]{16,})\b/gi }
];

export interface SecretMatch {
  shape: SecretShape;
  label: string;
  value: string;
}

/** Scans text for probable secret material. Pure: no side effects. */
export function scanSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let found: RegExpExecArray | null;
    while ((found = pattern.regex.exec(text)) !== null) {
      const value = found[1] ?? found[0];
      matches.push({ shape: pattern.shape, label: pattern.label, value });
      if (found.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1; // avoid zero-width stall
    }
  }
  return matches;
}

export function isTainted(text: string): boolean {
  return scanSecrets(text).length > 0;
}

/**
 * Replaces every detected secret with `[REDACTED:<label>]`. Deterministic and
 * idempotent: a second pass over the output finds nothing more to redact.
 */
export function redactSecrets(text: string): string {
  let output = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    output = output.replace(pattern.regex, (whole, group) => `[REDACTED:${pattern.label}]`);
  }
  return output;
}
