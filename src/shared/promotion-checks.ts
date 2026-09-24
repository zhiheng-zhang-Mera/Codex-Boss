/**
 * The required status checks a candidate must satisfy before promotion — declared ONCE (PF-DEBT-009 era
 * contract; converged with the live ruleset by the machine-identity round).
 *
 * ## Why this file exists
 *
 * `GitHubPromotionAdapter` used to default to a single hard-coded name:
 *
 *     this.requiredCheckName = options.requiredCheckName ?? "validate";
 *
 * `validate` was the name the `Main-Protection` ruleset required when it was written, and no workflow has ever
 * produced it. The ruleset was repaired (Owner-authorized) to require the four checks `Desktop CI` actually
 * emits, so a promotion gate still reading `validate` would either find nothing and refuse forever, or — worse
 * — be "fixed" by substituting one of the four names, which would make the gate look like it verified CI while
 * checking a quarter of it.
 *
 * The promotion gate reads this declaration. `Desktop CI` emits these four job ids, and
 * `tests/unit/promotion-gate.test.ts` reads `.github/workflows/ci.yml` and `.github/CODEOWNERS` and fails if this
 * list, the required set the ruleset contract names, and the jobs the workflow really produces stop agreeing —
 * so the gate and the pipeline it gates cannot drift into two opinions.
 *
 * ## Not every job in `ci.yml` is required, deliberately
 *
 * Phase 1B-B (hosted stage S1) added an `architecture` job that runs the prospective architecture enforcer — in
 * shadow mode at S1, and in the real governing enforce mode at S2. At those stages it was a real job in the same
 * workflow and deliberately **not** required: making it required is stage S3, a ruleset edit and nothing else, and
 * an Owner act.
 *
 * **Stage S3 has now been performed.** The Owner-authorised `Main-Protection` ruleset edit added the `architecture`
 * context (integration id 15368), so the list below names five contexts and `Desktop CI` produces all five. The
 * property this file asserts is unchanged and is why the drift cannot come back: "every REQUIRED context is
 * produced by a job in `ci.yml` and is named by the CODEOWNERS ruleset contract", with the converse also asserted —
 * the declaration may not name anything the platform does not require, because a check required by the autonomous
 * gate but not by the platform would park every promotion on a gate the platform never demanded.
 *
 * ## What this file is NOT
 *
 * It is not authority. Listing a check here does not require it on the platform — the live ruleset does that,
 * and the ruleset is a PLATFORM fact rather than a repository one, so it is measured rather than asserted in a
 * unit test (`scripts/verify-authority-separation.cjs --platform`). This is the contract the AUTONOMOUS side
 * must satisfy before it may ask for a promotion, which is exactly why it is a constant in shared code rather
 * than a string buried in an adapter.
 */

/**
 * The five status contexts `Desktop CI` produces and `Main-Protection` requires, in the order the workflow
 * declares them (`architecture` is listed last because that is where its job appears in `ci.yml`). Every one of
 * them must be `success` on the EXACT candidate SHA; see `GitHubPromotionAdapter.readRequiredCheck`.
 */
export const REQUIRED_PROMOTION_CHECKS = ["quality", "unit", "acceptance", "package", "architecture"] as const;

/** Where the list comes from, recorded in evidence so a reader can check it rather than trust it. */
export const REQUIRED_PROMOTION_CHECKS_SOURCE =
  ".github/workflows/ci.yml — the five Desktop CI job ids (quality, unit, acceptance, package, architecture), which the live Main-Protection ruleset requires with strict_required_status_checks_policy = true and integration_id 15368";
