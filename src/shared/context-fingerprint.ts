/** Canonical JSON rendering shared by fingerprint/cache helpers (plan §13.4). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (key, current) => (current === undefined ? undefined : current));
}

/** Stable, sorted-key JSON text for an array of sections (deterministic hashing input). */
export function canonicalSections(...sections: unknown[]): string {
  return JSON.stringify(sections.map(canonicalJson));
}
