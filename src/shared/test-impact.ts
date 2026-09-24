/**
 * Impact-based test selection (Phase 05, Task A).
 *
 * The engineering book's shape, in its own words:
 *
 *     changed files -> owning capability -> reverse dependency / impact radius -> required test tiers
 *
 * Two things make this module trustworthy rather than merely convenient, and both are deliberate:
 *
 *  1. **It never skips silently.** Every suite in the catalogue comes back either selected, with the
 *     reason and the path that caused it, or skipped, with the reason. There is no third outcome and
 *     no bare boolean, because a selector whose omissions are invisible cannot be audited — which is
 *     exactly the property the book forbids ("禁止黑盒跳过").
 *  2. **Selection is a fast-feedback device, never a merge gate.** `fullRunRequired` is computed, not
 *     assumed, and the book's triggers (merge gate, scheduled run, promotion) always require the full
 *     suite. Choosing a subset cannot become a way to merge without the full suite running.
 *
 * Pure: the graph, the catalogue and the changed-file list are all inputs. Nothing here reads the
 * filesystem or the clock, so the same inputs always give the same selection and a selection can be
 * written into an artifact and re-derived later.
 */

/** The verification tiers, cheapest first. Order matters: escalation is one-directional. */
export const TEST_TIERS = ["unit", "contract", "integration", "acceptance"] as const;
export type TestTier = (typeof TEST_TIERS)[number];

/**
 * How much of the risk a capability carries, taken from its manifest rather than decided here.
 *
 * `critical` capabilities earn the expensive tiers inside their blast radius; a feature that can be
 * removed without breaking Boss does not, because running its acceptance suite for a change it
 * merely depends on is cost with no corresponding risk.
 */
type CapabilityRisk = "critical" | "standard";

/** Why a full run is mandatory regardless of what the selector computed. */
const FULL_RUN_TRIGGERS = ["merge-gate", "scheduled", "promotion"] as const;
export type FullRunTrigger = (typeof FULL_RUN_TRIGGERS)[number];

/**
 * One suite in the catalogue, with what it guards.
 *
 * `covers` is the set of capabilities whose invariants the suite actually asserts. The book's Task B
 * asks for one AUTHORITATIVE suite per invariant; this catalogue is where that is recorded, and
 * `duplicateObligations` below reports where more than one suite claims the same obligation so the
 * duplication is visible rather than discovered by a maintenance surprise.
 */
export interface TestSuite {
  /** Repo-relative POSIX path of the test file. */
  file: string;
  tier: TestTier;
  /** Capability ids whose invariants this suite asserts. */
  covers: readonly string[];
  /**
   * The invariant this suite is the authority on, when it is one.
   *
   * Two suites naming the same obligation is reported, not silently tolerated: the book asks to
   * REDUCE duplicated maintenance rather than to mechanically deduplicate, so the report is the
   * deliverable and the merge is a later judgement.
   */
  obligation?: string;
  /** Always run, whatever changed. For suites that guard the selector and the platform contract. */
  alwaysRun?: boolean;
}

interface SelectedSuite {
  file: string;
  tier: TestTier;
  /** Capabilities that put this suite in the selection. */
  because: string[];
  /** The changed files that led to those capabilities, so the reason is traceable to an input. */
  viaFiles: string[];
  /**
   * Whether the change reached the suite's capability (or one it asserts) DIRECTLY, or only through
   * the impact radius. The distinction is what decides the acceptance tier, so it is reported rather
   * than folded into the reason string.
   */
  reachedThrough: "direct" | "radius";
  reason: string;
}

interface SkippedSuite {
  file: string;
  tier: TestTier;
  reason: string;
}

export interface TestSelection {
  changedFiles: string[];
  /** Changed file -> the capabilities that own it. A file may be owned by more than one. */
  owners: Record<string, string[]>;
  /** The seed capabilities, from the changed files. */
  seeds: string[];
  /** Every capability affected, seeds included, sorted. */
  affected: string[];
  selected: SelectedSuite[];
  skipped: SkippedSuite[];
  fullRunRequired: boolean;
  fullRunReasons: string[];
  /** Capabilities a changed file could not be attributed to. Reported, never ignored. */
  unattributedFiles: string[];
  /** True when nothing was selected because nothing was attributable — a red flag, not a pass. */
  blind: boolean;
  /**
   * The selection as a sentence that names its own basis.
   *
   * Carried in the result so the choice can be written to the decision ledger as-is: a selection
   * that cannot state why it is safe is a selection nobody can review later.
   */
  decisionReason: string;
  /** Whether this selection is substantial enough to be worth recording as a decision. */
  shouldRecord: boolean;
}

/**
 * Which capabilities own a changed file.
 *
 * Matching is on the manifest's own `modules` list, so the mapping cannot drift from the manifests
 * the ratchet already checks. An exact path match wins outright; the prefix rule exists for a change
 * to a file BENEATH a declared directory module, and is reported separately by the caller because a
 * prefix match is weaker evidence than an exact one.
 */
export function ownersOf(changedFile: string, modulesByCapability: ReadonlyMap<string, readonly string[]>): string[] {
  const normalised = changedFile.replace(/\\/g, "/").replace(/^\.\//, "");
  const exact: string[] = [];
  const prefixed: string[] = [];
  for (const [capabilityId, modules] of modulesByCapability) {
    for (const module of modules) {
      const declared = module.replace(/\\/g, "/");
      if (declared === normalised) {
        exact.push(capabilityId);
        break;
      }
      if (normalised.startsWith(`${declared}/`)) {
        prefixed.push(capabilityId);
        break;
      }
    }
  }
  // An exact owner is the answer; the prefix matches exist only so a file under a declared
  // directory is not orphaned. Both are returned sorted so the result is reproducible.
  return [...new Set(exact.length > 0 ? exact : prefixed)].sort();
}

/** The blast radius of a capability, seeds included. `impactRadius` excludes the capability itself. */
function affectedBy(seeds: readonly string[], impactRadius: (capabilityId: string) => string[]): string[] {
  const affected = new Set<string>();
  for (const seed of seeds) {
    affected.add(seed);
    for (const dependent of impactRadius(seed)) affected.add(dependent);
  }
  return [...affected].sort();
}

interface SelectOptions {
  changedFiles: readonly string[];
  catalogue: readonly TestSuite[];
  modulesByCapability: ReadonlyMap<string, readonly string[]>;
  impactRadius: (capabilityId: string) => string[];
  /** Capabilities that are `critical` in their manifest, so the expensive tiers are earned. */
  criticalCapabilities: ReadonlySet<string>;
  /** Set by the caller when a full-run trigger applies. Never inferred. */
  trigger?: FullRunTrigger;
  /**
   * Capabilities whose blast radius the dependency graph cannot bound, so no subset can be justified.
   *
   * The composition root is the reason this exists. It is owned by the platform and wires every
   * capability together, so a change to it is a change to the wiring of the whole application: reverse
   * reachability over declared capability edges describes which capabilities depend on each OTHER, and
   * says nothing about a file that every one of them is constructed by. A caller that owns such a path
   * names its owner here rather than leaving it unowned, because "we know exactly who owns this and its
   * radius is everything" and "we cannot tell who owns this" are different facts and only the second
   * one is a gap in the map.
   */
  unboundedCapabilities?: ReadonlySet<string>;
  /**
   * The changed set could not be computed — a base commit that is not an ancestor, a shallow clone.
   *
   * Fails closed to a full run rather than selecting a subset from an unknown change set, which is
   * the book's rollback rule ("impact selector 有任何漏测证据时，立即退化为 full suite").
   */
  changedSetUnknown?: boolean;
}

/**
 * Decide which suites a change requires.
 *
 * Escalation rules, and the reason each exists:
 *
 *  - a suite covering an AFFECTED capability runs at its own tier;
 *  - `contract` and above also run for a suite covering a capability whose blast radius reaches an
 *    affected one, because a contract is what others depend on;
 *  - `acceptance` runs only when an affected capability is `critical`, or when the change reached the
 *    capability directly rather than through the radius. Accepting the cost of a full acceptance
 *    scenario for a distant dependent is how a selector becomes slower than the suite it replaces.
 */
export function selectTests(options: SelectOptions): TestSelection {
  const changedFiles = [...new Set(options.changedFiles.map((file) => file.replace(/\\/g, "/")))].sort();
  const owners: Record<string, string[]> = {};
  const unattributedFiles: string[] = [];
  const seeds = new Set<string>();

  if (options.changedSetUnknown !== true) {
    for (const file of changedFiles) {
      const found = ownersOf(file, options.modulesByCapability);
      owners[file] = found;
      if (found.length === 0) unattributedFiles.push(file);
      for (const capabilityId of found) seeds.add(capabilityId);
    }
  }

  const seedList = [...seeds].sort();
  const affected = options.changedSetUnknown === true ? [] : affectedBy(seedList, options.impactRadius);
  const affectedSet = new Set(affected);

  const fullRunReasons: string[] = [];
  if (options.trigger) fullRunReasons.push(`${options.trigger} requires the full suite whatever the impact radius says`);
  if (options.changedSetUnknown === true) fullRunReasons.push("the changed set could not be computed, so no subset can be justified");
  if (options.changedSetUnknown !== true && changedFiles.length > 0 && seedList.length === 0) {
    fullRunReasons.push("no changed file could be attributed to a capability, so the impact radius is unknown");
  }
  // A seed with no bounded radius is a full run even though every changed file WAS attributed. The
  // reason names the owner, so the two cases cannot be confused in a report: an unattributed change is a
  // hole in the ownership map, and this one is a correctly attributed change whose radius is the whole
  // application.
  if (options.changedSetUnknown !== true) {
    for (const capabilityId of seedList) {
      if (options.unboundedCapabilities?.has(capabilityId)) {
        fullRunReasons.push(`${capabilityId} has no bounded blast radius, so no subset of the suite can be justified for a change to it`);
      }
    }
  }

  const selected: SelectedSuite[] = [];
  const skipped: SkippedSuite[] = [];

  for (const suite of options.catalogue) {
    if (suite.alwaysRun) {
      selected.push({ file: suite.file, tier: suite.tier, because: ["always-run"], viaFiles: [], reachedThrough: "direct", reason: "the suite declares that it always runs" });
      continue;
    }

    const covering = suite.covers.filter((capabilityId) => affectedSet.has(capabilityId));
    if (covering.length === 0) {
      skipped.push({
        file: suite.file,
        tier: suite.tier,
        reason: suite.covers.length === 0
          ? "the suite covers no capability, so no change can select it"
          : `no capability it covers is affected (covers ${suite.covers.join(", ")})`
      });
      continue;
    }

    // A direct change to a capability runs its full ladder; reaching it through the radius runs the
    // cheaper tiers only, unless the capability is critical.
    const directlyChanged = covering.filter((capabilityId) => seedList.includes(capabilityId));
    const criticalTouched = covering.filter((capabilityId) => options.criticalCapabilities.has(capabilityId));
    const earnsAcceptance = suite.tier !== "acceptance"
      || directlyChanged.length > 0
      || criticalTouched.length > 0;

    if (!earnsAcceptance) {
      skipped.push({
        file: suite.file,
        tier: suite.tier,
        reason: `acceptance is reserved for a direct change or a critical capability, and ${covering.join(", ")} was reached through the impact radius`
      });
      continue;
    }

    const viaFiles = changedFiles.filter((file) => (owners[file] ?? []).some((capabilityId) => covering.includes(capabilityId)));
    selected.push({
      file: suite.file,
      tier: suite.tier,
      because: covering,
      viaFiles,
      reachedThrough: directlyChanged.length > 0 ? "direct" : "radius",
      reason: directlyChanged.length > 0
        ? `covers ${covering.join(", ")}, changed directly`
        : `covers ${covering.join(", ")}, affected through the impact radius of ${seedList.join(", ")}`
    });
  }

  const blind = options.changedSetUnknown !== true && changedFiles.length > 0 && selected.length === 0;
  // A blind selection is not a small selection. Nothing in the catalogue covers what changed, so the
  // impact radius is unverifiable and the answer has to be the full suite — the book's rollback rule
  // applies to this case exactly as it does to an unknown change set.
  if (blind) fullRunReasons.push("no suite in the catalogue covers the affected capability, so the impact radius cannot be verified");
  const ordered = {
    selected: selected.sort((left, right) => (left.file < right.file ? -1 : 1)),
    skipped: skipped.sort((left, right) => (left.file < right.file ? -1 : 1))
  };
  const fullRunRequired = fullRunReasons.length > 0;
  const decisionReason = fullRunRequired
    ? `full suite required: ${fullRunReasons.join("; ")}`
    : `${ordered.selected.length} suite(s) selected for ${seedList.join(", ") || "no capability"} because the change reaches ${affected.length} capability(ies)`;
  return {
    changedFiles,
    owners,
    seeds: seedList,
    affected,
    selected: ordered.selected,
    skipped: ordered.skipped,
    fullRunRequired,
    fullRunReasons,
    unattributedFiles,
    blind,
    decisionReason,
    // A run that chose nothing, or that cannot attribute its inputs, is exactly the case a later
    // reader would want to question, so it is recorded rather than filed as routine.
    shouldRecord: fullRunRequired || blind || unattributedFiles.length > 0
  };
}

/**
 * Suites that assert the same obligation.
 *
 * The book asks for one authoritative suite per invariant and a report of the duplication, rather
 * than mechanical deduplication — the duplication is a maintenance cost to be reduced deliberately,
 * not a rule to be enforced blindly.
 */
export function duplicateObligations(catalogue: readonly TestSuite[]): Array<{ obligation: string; file: string; tier: TestTier }[]> {
  const byObligation = new Map<string, Array<{ obligation: string; file: string; tier: TestTier }>>();
  for (const suite of catalogue) {
    if (!suite.obligation) continue;
    const entry = { obligation: suite.obligation, file: suite.file, tier: suite.tier };
    byObligation.set(suite.obligation, [...(byObligation.get(suite.obligation) ?? []), entry]);
  }
  return [...byObligation.values()]
    .filter((entries) => entries.length > 1)
    .map((entries) => entries.sort((left, right) => (left.file < right.file ? -1 : 1)))
    .sort((left, right) => (left[0].obligation < right[0].obligation ? -1 : 1));
}

/** A one-screen summary, so a selection can be reported without dumping the whole catalogue. */
export function summarizeSelection(selection: TestSelection): string {
  const byTier = new Map<TestTier, number>();
  for (const suite of selection.selected) byTier.set(suite.tier, (byTier.get(suite.tier) ?? 0) + 1);
  const tiers = TEST_TIERS.filter((tier) => byTier.has(tier)).map((tier) => `${tier}=${byTier.get(tier)}`).join(" ");
  return [
    `${selection.changedFiles.length} changed file(s), ${selection.seeds.length} seed capability(ies), ${selection.affected.length} affected`,
    `selected ${selection.selected.length} of ${selection.selected.length + selection.skipped.length} suite(s)${tiers ? ` (${tiers})` : ""}`,
    selection.fullRunRequired ? `FULL RUN REQUIRED: ${selection.fullRunReasons.join("; ")}` : "targeted run is sufficient for feedback",
    selection.unattributedFiles.length > 0 ? `${selection.unattributedFiles.length} changed file(s) attributed to no capability` : "every changed file was attributed"
  ].join("\n");
}

/** What a full run said, compared against what the selector would have chosen. */
interface SelectionAudit {
  selectedCount: number;
  fullRunCount: number;
  /**
   * Suites that RAN in the full suite but the selector had skipped.
   *
   * This is the direction that matters and the reason the selector cannot certify itself. A skipped
   * suite that ran and passed is, at minimum, an over-conservative selector; if the catalogue has
   * also failed to associate a changed file with the capability that suite guards, it is a blind
   * spot — and the book's rule is that any missed-coverage evidence degrades to a full run
   * immediately rather than continuing to accelerate.
   */
  missedSuites: string[];
  /** Suites the selector chose that are absent from the full run, which would mean a broken catalogue. */
  phantomSelections: string[];
  /** What the full run did not contain at all, so "the full run" can be verified as actually full. */
  absentFromFullRun: string[];
  agrees: boolean;
  problems: string[];
}

/**
 * Compare a selection against the full suite that actually ran.
 *
 * Deliberately takes the full run's file list as an input rather than running anything: the
 * comparison is the assertion, and it has to be checkable from recorded evidence long after the run.
 */
export function auditSelectionAgainstFullRun(
  selection: TestSelection,
  fullRunFiles: readonly string[],
  catalogue: readonly TestSuite[]
): SelectionAudit {
  const ran = new Set(fullRunFiles.map((file) => file.replace(/\\/g, "/")));
  const chosen = new Set(selection.selected.map((suite) => suite.file));
  const catalogueFiles = new Set(catalogue.map((suite) => suite.file));
  const problems: string[] = [];

  const missedSuites = [...ran].filter((file) => catalogueFiles.has(file) && !chosen.has(file)).sort();
  const phantomSelections = [...chosen].filter((file) => !ran.has(file)).sort();
  const absentFromFullRun = [...catalogueFiles].filter((file) => !ran.has(file)).sort();

  // A selected suite missing from the full run means the catalogue names a file that does not run,
  // so the selection would have "passed" by pointing at nothing.
  for (const file of phantomSelections) problems.push(`${file} was selected but is not in the full run`);
  // THE central failure mode: a suite that the full run contained and the selector skipped. A
  // skipped suite that passed is at worst an over-conservative selector, but it is also exactly what
  // a blind spot looks like, so it is always reported. `agrees` is false whenever the two lists
  // differ, because "the selector and the full run agreed" has to mean they agree.
  if (missedSuites.length > 0) {
    problems.push(`the full run contained ${missedSuites.length} suite(s) the selector skipped: ${missedSuites.slice(0, 5).join(", ")}`);
  }
  if (selection.unattributedFiles.length > 0 && missedSuites.length > 0) {
    problems.push(`${selection.unattributedFiles.length} changed file(s) were unattributed while ${missedSuites.length} skipped suite(s) ran, so the selector cannot account for them`);
  }
  if (selection.blind) problems.push("the selector chose nothing while the full run had suites to run");

  return {
    selectedCount: chosen.size,
    fullRunCount: ran.size,
    missedSuites,
    phantomSelections,
    absentFromFullRun,
    agrees: problems.length === 0,
    problems
  };
}
