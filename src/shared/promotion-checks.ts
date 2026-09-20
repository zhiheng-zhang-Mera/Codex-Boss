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
 * The promotion gate reads this declaration. It is the same list the ruleset requires and the same list
 * `Desktop CI` emits, and `tests/unit/promotion-gate.test.ts` fails if any of the three drift apart, so the
 * three cannot become three opinions.
 *
 * ## What this file is NOT
 *
 * It is not authority. Listing a check here does not require it on the platform — the live ruleset does that,
 * and `scripts/verify-authority-separation.cjs --platform` is what measures it. This is the contract the
 * AUTONOMOUS side must satisfy before it may ask for a promotion, which is exactly why it is a constant in
 * shared code rather than a string buried in an adapter.
 */

/**
 * The four status contexts `Desktop CI` produces and `Main-Protection` requires, in the order the workflow
 * declares them. Every one of them must be `success` on the EXACT candidate SHA; see
 * `GitHubPromotionAdapter.readRequiredCheck`.
 */
export const REQUIRED_PROMOTION_CHECKS = ["quality", "unit", "acceptance", "package"] as const;

/** Where the list comes from, recorded in evidence so a reader can check it rather than trust it. */
export const REQUIRED_PROMOTION_CHECKS_SOURCE =
  ".github/workflows/ci.yml — the four Desktop CI job ids (quality, unit, acceptance, package), which the live Main-Protection ruleset requires with strict_required_status_checks_policy = true and integration_id 15368";
