import { classifySurface, type SurfaceClass } from "../autonomous-evolution-trust";
import { ROOT_PROTECTED_MANIFEST } from "./protected-surface";

/**
 * Root Trust Authority Lockdown — the two planes, the four classes, and the invariant.
 *
 * `Boss can rewrite most of itself. Boss cannot ratify its own constitutional changes.` Concretely:
 * COMPUTATION IS AUTONOMOUS, AUTHORITY IS EXTERNAL. This module is where that sentence stops being a
 * sentence: it is the single machine-readable classification the rest of the system can call, and
 * `tests/unit/root-trust-authority-lockdown.test.ts` attacks it.
 *
 * ## Why this exists next to `autonomous-evolution-trust.ts` rather than inside it
 *
 * The trust module already answers "is this file Root Trust Surface?" for the EPOCH mechanism. What was
 * missing was the answer the PROMOTION gate needs — "may an autonomous actor effect this change, or does
 * it need the Owner?" — and, crucially, the distinction between a change to the *gates* and a change to
 * the *mechanism that decides which changes need the Owner*. Measured before the lockdown, the guard
 * that feeds `decidePromotion` assessed `trust-policy/trust-epoch.json`,
 * `src/shared/autonomous-evolution-trust.ts` and `tests/acceptance/**` as ordinary (see
 * `protected-surface.ts`), so a change set of only those paths could reach PROMOTABLE.
 *
 * ## The two planes
 *
 *   - **AUTONOMOUS_MUTABLE** — agents, skills, plugins, prompts, routing, orchestration, model selection
 *     and scoring, pruning, module replacement, indexing, memory strategy, worker topology, performance
 *     work, ordinary application code, ordinary tests, ordinary configuration. Boss owns this outright.
 *   - **ROOT_TRUST** — the epoch mechanism and verifier, the surface definition, the attested acceptance
 *     gates and their evidence rules, the trust-epoch surface itself. Boss may inspect, detect, propose,
 *     patch, test, simulate, prepare and explain; it may NOT effect the change. Effecting it needs the
 *     Owner.
 *   - **OWNER_AUTHORITY** — the protection mechanism ITSELF: the classifier that decides what is
 *     protected, the review boundary, the authorization workflow, the promotion rules, the credential
 *     boundary, the emergency control, the break-glass path, and anything that can weaken any of those.
 *     This is the recursive case: changing the rule that defines the rule is itself Owner-only, so no
 *     "reclassify protected authority as ordinary" path exists.
 *
 * ## The four classes (A8)
 *
 *   0 ORDINARY_AUTONOMOUS_CHANGE   Boss may do it end to end.
 *   1 PRIVILEGED_NON_ROOT_CHANGE   Boss may do it, with extra tests/audit.
 *   2 ROOT_TRUST_CHANGE            Boss may prepare it; the Owner must authorize it.
 *   3 OWNER_AUTHORITY_CHANGE       Highest protection; an autonomous actor may not even DOWNGRADE it.
 *
 * A class is never a declaration the actor may choose: `effectiveChangeClass` takes the STRICTER of the
 * declared and the derived class, and an autonomous actor that declares lower than the derivation raises.
 * That is the machine form of "Boss 不能自己把 Class 3 降为 Class 2/1/0".
 */

type AuthorityPlane = "AUTONOMOUS_MUTABLE" | "ROOT_TRUST" | "OWNER_AUTHORITY";

/** The four classes, named so call sites read as `CHANGE_CLASSES.ROOT_TRUST_CHANGE`. */
export const CHANGE_CLASSES = {
  ORDINARY_AUTONOMOUS_CHANGE: 0,
  PRIVILEGED_NON_ROOT_CHANGE: 1,
  ROOT_TRUST_CHANGE: 2,
  OWNER_AUTHORITY_CHANGE: 3
} as const;

type ChangeClass = (typeof CHANGE_CLASSES)[keyof typeof CHANGE_CLASSES];

/**
 * The Owner-Authority plane: everything that can decide, weaken, bypass or reclassify the Owner gate.
 *
 * This is deliberately WIDER than "the files the trust epoch anchors". The epoch surface protects the
 * *record*; this list protects the *rules* — including the tier declarations that decide which gates run
 * at all, and the test files that guard the boundary, because a boundary whose own guard is editable by
 * the actor it guards is not a boundary.
 *
 * Pattern syntax matches the compiled root-surface manifest: a leading `/` anchors at the repository
 * root, a trailing `/` means "this directory and everything under it", `*` stays within one path segment
 * and `**` crosses segments.
 *
 * The review boundary's own manifest is spread in FIRST. The class model must never be narrower than the
 * boundary the host enforces, and deriving that half of the list instead of retyping it removes the drift
 * that this whole lockdown exists to fix — the first draft of this file omitted `stable-candidate` and the
 * lockdown test caught it, which is exactly the failure mode a second hand-written list would keep
 * producing.
 */
export const OWNER_AUTHORITY_PATHS: readonly string[] = [
  ...ROOT_PROTECTED_MANIFEST,

  // The review boundary and the workflows that implement permissions, gates and promotion.
  "/.github/CODEOWNERS",
  "/.github/workflows/",

  // The classifier, the policy and the promotion rules — including this file, so the definition of the
  // boundary is inside the boundary.
  "/src/shared/root-authority/",
  "/electron/root-authority/",
  "/electron/promotion-gate/",
  "/src/promotion-gate/",
  "/src/**/promotion-gate/",

  // Credential boundary, self-elevation guards, emergency control and recovery.
  "/electron/credential-boundary/",
  "/src/**/credential-boundary/",
  "/electron/self-elevation/",
  "/src/**/self-elevation/",
  "/electron/emergency-control/",
  "/src/**/emergency-control/",
  "/electron/root-recovery/",
  "/src/**/root-recovery/",

  // The trust verifier, the self-certification judge and the evidence rules they rely on.
  "/src/shared/autonomous-evolution-*.ts",
  "/src/shared/trust-problems.ts",
  "/src/shared/acceptance-*.ts",
  "/src/shared/bootstrap-audit.ts",
  "/src/shared/owner-intervention.ts",

  // The epoch record and the machine-generated surface declaration.
  "/trust-policy/",

  // The tooling that establishes, proposes, pairs or reports a qualification: the bless step, the
  // proposal generator, the selector pairing and the qualification helpers.
  "/scripts/acceptance-evolution-bless.cjs",
  "/scripts/trust-migration-proposal.cjs",
  "/scripts/verify-targeted-vs-full.cjs",
  "/scripts/qualification-*.cjs",
  "/scripts/acceptance-*.cjs",
  "/scripts/*soak*.cjs",

  // What runs: the tier declarations, the CI command indirection and the build/test configuration.
  "/package.json",
  "/pnpm-lock.yaml",
  "/vitest.tiers.mjs",
  "/vitest.*.config.mjs",
  "/tsconfig.json",
  "/tsconfig.electron.json",

  // The guards themselves. An actor that may edit its own guard has no guard.
  "/tests/**/root-authority*.test.*",
  "/tests/**/owner-authority*.test.*",
  "/tests/**/self-elevation*.test.*",
  "/tests/**/credential-boundary*.test.*",
  "/tests/**/promotion-gate*.test.*",
  "/tests/**/stable-candidate*.test.*",
  "/tests/**/emergency-control*.test.*",
  "/tests/**/root-recovery*.test.*",
  "/tests/**/root-trust-authority*.test.*"
];

/** CODEOWNERS-subset pattern to anchored regular expression (see `OWNER_AUTHORITY_PATHS`). */
function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  const directory = anchored.endsWith("/");
  const body = directory ? anchored.slice(0, -1) : anchored;
  const escaped = body
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}${directory ? "(?:/|$)" : "$"}`);
}

const OWNER_AUTHORITY_MATCHERS: readonly RegExp[] = OWNER_AUTHORITY_PATHS.map(patternToRegExp);

/** Normalise a repository-relative path the way the rest of the boundary does. */
function normalizeAuthorityPath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** True when the path is part of the Owner-Authority plane (the protection mechanism itself). */
export function isOwnerAuthorityPath(file: string): boolean {
  const normalized = normalizeAuthorityPath(file);
  return OWNER_AUTHORITY_MATCHERS.some((matcher) => matcher.test(normalized));
}

/**
 * The plane a path belongs to.
 *
 * Owner-Authority is checked FIRST, then the trust module's own classifier, so the stricter plane always
 * wins: a file that is both a gate and part of the mechanism is OWNER_AUTHORITY, and a file the trust
 * model calls Root Trust Surface can never be reported as ordinary here.
 */
export function classifyAuthorityPath(file: string): { plane: AuthorityPlane; surface: SurfaceClass } {
  if (isOwnerAuthorityPath(file)) return { plane: "OWNER_AUTHORITY", surface: classifySurface(file) };
  const surface = classifySurface(file);
  if (surface === "ROOT_TRUST_SURFACE") return { plane: "ROOT_TRUST", surface };
  return { plane: "AUTONOMOUS_MUTABLE", surface };
}

/** The class a single path implies. Never lower than the plane requires. */
export function changeClassOfPath(file: string): ChangeClass {
  const { plane, surface } = classifyAuthorityPath(file);
  if (plane === "OWNER_AUTHORITY") return CHANGE_CLASSES.OWNER_AUTHORITY_CHANGE;
  if (plane === "ROOT_TRUST") return CHANGE_CLASSES.ROOT_TRUST_CHANGE;
  // Verification surface and the evolution engine get extra scrutiny but stay autonomous: tests and the
  // engine are exactly what Boss is supposed to evolve.
  if (surface === "VERIFICATION_SURFACE" || surface === "EVOLUTION_ENGINE") return CHANGE_CLASSES.PRIVILEGED_NON_ROOT_CHANGE;
  return CHANGE_CLASSES.ORDINARY_AUTONOMOUS_CHANGE;
}

/** The derived class of a whole change set: the strictest path in it. */
export function deriveChangeClass(files: readonly string[]): ChangeClass {
  let derived: ChangeClass = CHANGE_CLASSES.ORDINARY_AUTONOMOUS_CHANGE;
  for (const file of files) derived = Math.max(derived, changeClassOfPath(file)) as ChangeClass;
  return derived;
}

type AuthorityActor = "autonomous" | "owner";

/**
 * The stricter of a declared and a derived class, refusing an autonomous downgrade.
 *
 * A caller may declare a class (a prepared proposal carries one). It may never declare LOWER than the
 * derivation: that is the "reclassify protected authority as ordinary change" attack, and it raises here
 * rather than being silently corrected, because a silent correction is a path someone can rely on.
 */
export function effectiveChangeClass(input: { declared?: ChangeClass; files: readonly string[]; actor: AuthorityActor }): ChangeClass {
  const derived = deriveChangeClass(input.files);
  const declared = input.declared ?? derived;
  if (input.actor === "autonomous" && declared < derived) {
    throw new Error(
      `autonomous actor may not downgrade change class ${derived} to ${declared}: a change set containing ` +
        `${input.files.length} path(s) is classified by what it touches, not by what the actor says it touches`
    );
  }
  return Math.max(declared, derived) as ChangeClass;
}

/**
 * Phase A3 — the invariant, as data.
 *
 * `true` on an `..._ALLOWED` entry means the autonomous actor may do it. `true` on a `..._FORBIDDEN`
 * entry means the autonomous actor may NOT do it (and the Owner may). Keeping both directions as data
 * means the lockdown test can assert them exhaustively instead of trusting prose.
 */
export const AUTONOMOUS_AUTHORITY_INVARIANTS = {
  AUTONOMOUS_CHANGE_ALLOWED: true,
  AUTONOMOUS_TEST_ALLOWED: true,
  AUTONOMOUS_PROPOSAL_ALLOWED: true,
  AUTONOMOUS_TRUST_MIGRATION_PREPARATION_ALLOWED: true,
  AUTONOMOUS_ROOT_TRUST_AUTHORIZATION_FORBIDDEN: true,
  AUTONOMOUS_OWNER_AUTHORIZATION_FORBIDDEN: true,
  AUTONOMOUS_TRUST_EPOCH_FINALIZATION_FORBIDDEN: true
} as const;

type AuthorityAction =
  | "change"
  | "test"
  | "propose"
  | "prepare-trust-migration"
  | "authorize-root-trust"
  | "authorize-owner-authority"
  | "finalize-trust-epoch";

interface AuthorityDecision {
  decision: "ALLOW" | "DENY" | "REQUIRE_OWNER";
  action: AuthorityAction;
  actor: AuthorityActor;
  /** The effective class of the change the action concerns. */
  changeClass: ChangeClass;
  plane: AuthorityPlane;
  reasons: string[];
}

function strictestPlane(files: readonly string[]): AuthorityPlane {
  let plane: AuthorityPlane = "AUTONOMOUS_MUTABLE";
  for (const file of files) {
    const { plane: candidate } = classifyAuthorityPath(file);
    if (candidate === "OWNER_AUTHORITY") return "OWNER_AUTHORITY";
    if (candidate === "ROOT_TRUST") plane = "ROOT_TRUST";
  }
  return plane;
}

/**
 * The single decision function for "may this actor do this?".
 *
 * Read it as the machine form of the Owner's two lists: an autonomous actor may change, test, propose and
 * PREPARE a trust migration; it may never authorize a Root Trust change, authorize a change to the
 * authority mechanism, or finalize a trust epoch. Effecting a Class 2/3 change is REQUIRE_OWNER for the
 * autonomous actor and ALLOW for the Owner — there is no third way in.
 */
export function decideAuthorityAction(input: {
  actor: AuthorityActor;
  action: AuthorityAction;
  files?: readonly string[];
  declaredClass?: ChangeClass;
}): AuthorityDecision {
  const files = input.files ?? [];
  const changeClass = effectiveChangeClass({ declared: input.declaredClass, files, actor: input.actor });
  const plane = strictestPlane(files);
  const base = { action: input.action, actor: input.actor, changeClass, plane } as const;
  const autonomous = input.actor === "autonomous";

  switch (input.action) {
    case "test":
    case "propose":
    case "prepare-trust-migration":
      // Reading, testing, proposing and PREPARING are always allowed — including for the protected planes.
      // A lockdown that blocks preparation would be an immutable Boss, which is explicitly not the target.
      return { ...base, decision: "ALLOW", reasons: [`${input.action} is permitted for every plane`] };
    case "authorize-root-trust":
      return autonomous
        ? { ...base, decision: "DENY", reasons: ["AUTONOMOUS_ROOT_TRUST_AUTHORIZATION_FORBIDDEN"] }
        : { ...base, decision: "ALLOW", reasons: ["owner authorization"] };
    case "authorize-owner-authority":
      return autonomous
        ? { ...base, decision: "DENY", reasons: ["AUTONOMOUS_OWNER_AUTHORIZATION_FORBIDDEN"] }
        : { ...base, decision: "ALLOW", reasons: ["owner authorization"] };
    case "finalize-trust-epoch":
      return autonomous
        ? { ...base, decision: "DENY", reasons: ["AUTONOMOUS_TRUST_EPOCH_FINALIZATION_FORBIDDEN"] }
        : { ...base, decision: "ALLOW", reasons: ["owner finalization"] };
    case "change":
      if (!autonomous) return { ...base, decision: "ALLOW", reasons: ["owner change"] };
      if (changeClass >= CHANGE_CLASSES.ROOT_TRUST_CHANGE) {
        return {
          ...base,
          decision: "REQUIRE_OWNER",
          reasons: [`change class ${changeClass} on the ${plane} plane requires the Owner; the autonomous actor may prepare it`]
        };
      }
      return { ...base, decision: "ALLOW", reasons: [`change class ${changeClass} is autonomous`] };
  }
}

/**
 * Phase A9 — the rule every prune/delete/replace action runs first.
 *
 * Ordinary components may be pruned autonomously (that is the point of self-pruning). A component that is
 * part of the trust boundary may only be pruned through a proposal, and the answer is derived from the
 * same classifier above, so pruning cannot develop its own private opinion about what is protected.
 */
export function isComponentPartOfTrustBoundary(file: string): boolean {
  const { plane } = classifyAuthorityPath(file);
  return plane === "ROOT_TRUST" || plane === "OWNER_AUTHORITY";
}

interface PruneDecision {
  decision: "ALLOW" | "PROPOSAL_ONLY";
  plane: AuthorityPlane;
  changeClass: ChangeClass;
  reason: string;
}

export function decidePrune(file: string): PruneDecision {
  const { plane } = classifyAuthorityPath(file);
  const changeClass = changeClassOfPath(file);
  if (plane === "AUTONOMOUS_MUTABLE") {
    return { decision: "ALLOW", plane, changeClass, reason: "ordinary component: autonomous pruning" };
  }
  return {
    decision: "PROPOSAL_ONLY",
    plane,
    changeClass,
    reason: `IS_COMPONENT_PART_OF_TRUST_BOUNDARY: the ${plane} plane may be pruned only through an Owner-authorised proposal`
  };
}

/**
 * The model as data, so acceptance evidence can carry it instead of quoting this file's prose.
 */
export const AUTHORITY_MODEL = {
  planes: ["AUTONOMOUS_MUTABLE", "ROOT_TRUST", "OWNER_AUTHORITY"] as const,
  classes: CHANGE_CLASSES,
  invariants: AUTONOMOUS_AUTHORITY_INVARIANTS,
  ownerAuthorityPaths: OWNER_AUTHORITY_PATHS
} as const;
