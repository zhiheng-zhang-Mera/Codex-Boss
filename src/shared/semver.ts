/**
 * Semantic-version validation, shared by both sides.
 *
 * Lives here rather than beside the capability contract because the knowledge layer needs the same
 * rule and `src/shared` must never import the Electron side — a guard the repository already
 * enforces. One implementation, two callers, rather than a copy that drifts.
 */

/**
 * Validate a semantic version.
 *
 * Exactly `major.minor.patch` with an optional pre-release/build suffix. The subset is deliberate:
 * `1.0` and `v1.0.0` are rejected so a manifest cannot declare a version that a semver comparator
 * would then have to guess at.
 */
export function isValidSemver(version: string): boolean {
  return typeof version === "string"
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/.test(version);
}
