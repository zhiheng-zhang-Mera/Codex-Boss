import { applyScopedChanges, type FileChange, type CheckSpec } from "./verification";
interface ChangeManifest { changes: FileChange[]; checks: CheckSpec[]; }

/**
 * Parse a proposal into a manifest.
 *
 * ## Why `expectedSha256` is normalised rather than format-checked
 *
 * This parser used to reject the whole proposal unless `expectedSha256` was `null` or matched
 * `/^[a-f0-9]{64}$/`. That check was **duplicative and stricter than the thing it protects**:
 * `applyScopedChanges` is the real authority on whether a change is hash-bound — it computes the
 * target's CURRENT digest and compares it, refusing with "Source changed since proposal" when they
 * disagree — and a `null` there means "this file does not exist yet, so there is no prior hash".
 *
 * The cost of the duplication was real. On a dogfooding run the coder emitted a malformed digest for a
 * NEW file, the whole proposal was rejected with one opaque message, the single automatic schema retry
 * was spent, and the second attempt failed the same way — a run ending on a formatting mistake in a
 * field whose value the applier was going to recompute anyway. It also cost a wasted provider call.
 *
 * So: a well-formed digest is kept, and anything else becomes `null` — which the applier then validates
 * against the file's actual state. The safety property is unchanged (a WRONG hash is still refused, by
 * the code that can actually tell), and a model's formatting slip is no longer fatal. The errors that
 * remain are schema errors, and each names the field it is about so the retry has something to act on.
 */
export function parseManifest(content: string): ChangeManifest {
  const raw = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: ChangeManifest;
  try {
    value = JSON.parse(raw) as ChangeManifest;
  } catch (error) {
    throw new Error(`the proposal is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object") throw new Error("the proposal is not an object");
  if (!Array.isArray(value.changes) || !value.changes.length || value.changes.length > 50) throw new Error(`proposal.changes must be an array of 1 to 50 entries, received ${Array.isArray(value.changes) ? value.changes.length : typeof value.changes}`);
  if (!Array.isArray(value.checks) || !value.checks.length || value.checks.length > 20) throw new Error(`proposal.checks must be an array of 1 to 20 entries, received ${Array.isArray(value.checks) ? value.checks.length : typeof value.checks}`);
  value.changes = value.changes.map((change, index) => {
    if (!change || typeof change !== "object") throw new Error(`proposal.changes[${index}] is not an object`);
    if (typeof change.path !== "string" || !change.path.trim()) throw new Error(`proposal.changes[${index}].path must be a non-empty string`);
    if (typeof change.content !== "string") throw new Error(`proposal.changes[${index}].content must be a string`);
    if (!(change.expectedSha256 === undefined || change.expectedSha256 === null || typeof change.expectedSha256 === "string")) {
      throw new Error(`proposal.changes[${index}].expectedSha256 must be a string or null`);
    }
    // Kept when it is a real digest; otherwise null, which the applier turns into a check against the
    // file's actual state. See the note above for why this is not a weakening.
    const expected = typeof change.expectedSha256 === "string" && /^[a-f0-9]{64}$/.test(change.expectedSha256) ? change.expectedSha256 : null;
    return { ...change, expectedSha256: expected };
  });
  for (const check of value.checks) {
    if (!check || !["syntax", "diff", "test", "typecheck", "build", "lint"].includes(check.kind)) throw new Error(`proposal.checks carries an entry that is not an allowlisted check: ${JSON.stringify(check)?.slice(0, 120)}`);
    if (check.kind === "syntax" && typeof check.file !== "string") throw new Error("a syntax check requires a singular `file`");
    if ("files" in check && (!Array.isArray(check.files) || check.files.length > 50 || check.files.some((file) => typeof file !== "string"))) throw new Error("a check's `files` must be an array of at most 50 strings");
  }
  return value;
}
export function applyManifest(root: string, manifest: ChangeManifest, authorizedPaths: string[], options: { mayCreate?: (path: string) => boolean } = {}) {
  return applyScopedChanges(root, manifest.changes, authorizedPaths, options);
}
