import type { CapabilityId } from "./capability-contract";
import type { DependencyGraph } from "./dependency-graph";
import type { StateOwnershipRegistry } from "./state-ownership";

/**
 * Architecture ratchets (platform foundation, Phase 01 Task D).
 *
 * A ratchet is an invariant that may only stay the same or improve. The engineering
 * book lists six, and they split into two kinds that must not be confused:
 *
 *  - **absolute** invariants have a fixed expectation (`cycle = 0`, `kernel -> feature
 *    import = 0`, `literal IPC registration in main.ts = 0`). They are NEVER
 *    baselined. A baseline entry for one of these would be a way to accept a
 *    violation, which is the "expand the allowlist to fix it" move the book forbids.
 *
 *  - **monotone** invariants measure a quantity that legitimately grows as
 *    capabilities are added (`boot module count`, `dependency edge count`). These are
 *    baselined so growth is *recorded* rather than silent, and the only way past the
 *    baseline is the explicit, auditable baseline update command — never a test
 *    rewriting it.
 *
 * Every check is a pure function of already-gathered evidence, so a test can feed it
 * a deliberately broken repository and assert that the ratchet actually fails. A
 * ratchet that cannot be shown to fail is not a ratchet.
 */

/** The knobs whose values a baseline records. */
type RatchetMetricKey =
  | "bootModuleCount"
  | "capabilityCount"
  | "dependencyEdgeCount"
  | "requiredEdgeCount"
  | "featureCapabilityCount"
  | "durableNamespaceCount";

/** The invariants. `absolute` ones are reported but never baselined. */
type RatchetId =
  | "required-dependency-cycles"
  | "unresolved-required-dependencies"
  | "duplicate-state-owners"
  | "kernel-imports-feature"
  | "feature-imports-undeclared-surface"
  | "unregistered-boot-module"
  | "literal-ipc-registration-in-main"
  | "boot-module-density"
  | "dependency-edge-density";

interface RatchetDeclaration {
  id: RatchetId;
  /** `absolute` = expectation is fixed and unbaselineable. `monotone` = baselined quantity. */
  kind: "absolute" | "monotone";
  /** The fixed expectation, for an absolute ratchet. */
  expected?: number;
  /** The baseline metric this ratchet reads, for a monotone ratchet. */
  metric?: RatchetMetricKey;
  /** One sentence: the boundary this ratchet keeps. */
  describes: string;
  /** What to do when it fires. */
  remedy: string;
}

/**
 * The declarations, in report order.
 *
 * Kept as data rather than as six separate assertions so the diagnostic command,
 * the snapshot artifact and the tests all describe the same six things and cannot
 * drift into disagreeing about what the invariants are.
 */
export const RATCHET_DECLARATIONS: readonly RatchetDeclaration[] = [
  {
    id: "required-dependency-cycles",
    kind: "absolute",
    expected: 0,
    describes: "No cycle exists among required capability dependencies.",
    remedy: "Break the loop by making one edge optional, or by depending on a narrower contract."
  },
  {
    id: "unresolved-required-dependencies",
    kind: "absolute",
    expected: 0,
    describes: "Every required dependency resolves to a manifest that provides it.",
    remedy: "Add the missing manifest, or make the edge optional so its absence degrades locally."
  },
  {
    id: "duplicate-state-owners",
    kind: "absolute",
    expected: 0,
    describes: "Every durable state namespace has exactly one authoritative owner.",
    remedy: "Remove the duplicate claim and route the second writer through the owner's contract."
  },
  {
    id: "kernel-imports-feature",
    kind: "absolute",
    expected: 0,
    describes: "Kernel composition never imports a feature implementation.",
    remedy: "Invert the dependency: the feature imports the kernel contract, not the reverse."
  },
  {
    id: "feature-imports-undeclared-surface",
    kind: "absolute",
    expected: 0,
    describes: "A capability imports another capability only through a surface the provider declares.",
    remedy: "Move the shared symbol onto the provider's declared surface, or into a shared module."
  },
  {
    id: "unregistered-boot-module",
    kind: "absolute",
    expected: 0,
    describes: "Every boot factory the composition root wires is named by exactly one manifest.",
    remedy: "Add the module to a capability manifest, or delete the wiring."
  },
  {
    id: "literal-ipc-registration-in-main",
    kind: "absolute",
    expected: 0,
    describes: "main.ts never registers an IPC channel by name; every channel belongs to a boot module.",
    remedy: "Register the channel inside the owning boot module and pass the registrar in."
  },
  {
    id: "boot-module-density",
    kind: "monotone",
    metric: "bootModuleCount",
    describes: "The composition root's boot module count does not exceed the recorded baseline.",
    remedy: "Run `pnpm run architecture:baseline:update` with a reason, so the growth is recorded and reviewed."
  },
  {
    id: "dependency-edge-density",
    kind: "monotone",
    metric: "dependencyEdgeCount",
    describes: "The capability graph's dependency edge count does not exceed the recorded baseline.",
    remedy: "Run `pnpm run architecture:baseline:update` with a reason, so the growth is recorded and reviewed."
  }
];

/** A single boundary crossing found by inspection, precise enough to act on. */
interface RatchetViolation {
  ratchet: RatchetId;
  /** Repo-relative POSIX file that carries the violation, when there is one. */
  file?: string;
  /** The capability or module the violation concerns. */
  subject?: string;
  detail: string;
}

/** The evidence the ratchet inspects, gathered once. */
export interface ArchitectureEvidence {
  graph: DependencyGraph;
  ownership: StateOwnershipRegistry;
  /** Repo-relative POSIX path -> owning capability id. */
  moduleOwners: Record<string, CapabilityId>;
  /** capability id -> `kernel` | `feature`. */
  capabilityKinds: Record<string, "kernel" | "feature">;
  /** capability id -> the module paths it publishes for others. */
  capabilitySurfaces: Record<string, string[]>;
  /** Every import edge between capability-owned modules. */
  imports: Array<{ from: string; to: string; fromCapability: CapabilityId; toCapability: CapabilityId }>;
  /** Boot factory files the composition root actually wires. */
  wiredBootFactories: string[];
  /** Boot factory files named by some manifest. */
  registeredBootFactories: string[];
  /** Count of `ipcMain.handle("<literal>"` occurrences in electron/main.ts. */
  literalIpcRegistrations: number;
  /** Absolute file path of electron/main.ts, for the report. */
  mainEntry: string;
}

/** The measured value of every baselined metric. */
type RatchetMetrics = Record<RatchetMetricKey, number>;

/** One ratchet's outcome. */
interface RatchetResult {
  id: RatchetId;
  kind: "absolute" | "monotone";
  /** What the ratchet required, rendered for a report. */
  expectation: string;
  /** What was measured, rendered for a report. */
  observed: string;
  pass: boolean;
  /** `absolute` when a fixed expectation was missed. */
  violationKind?: "absolute" | "exceeded";
  violations: RatchetViolation[];
}

interface RatchetReport {
  results: RatchetResult[];
  metrics: RatchetMetrics;
  pass: boolean;
  /** True when any `absolute` ratchet is violated — the unbaselineable class. */
  absoluteFailure: boolean;
  /** True when a monotone metric exceeded its baseline. */
  exceeded: boolean;
}

/** The persisted baseline: metric values plus why the last bump happened. */
export interface ArchitectureBaseline {
  $comment?: string;
  /** Bumped by the explicit command only; descriptive, not load-bearing. */
  version: number;
  /**
   * The commit the metrics were recorded at, when known. Purely informational — the
   * ratchet compares numbers, never this field, so a shallow clone cannot silently
   * disable it.
   */
  recordedAt?: string;
  recordedBy?: string;
  /** Why the metrics are what they are; required on every bump. */
  reason: string;
  /** ISO timestamp of the last bump. */
  updatedAt: string;
  metrics: RatchetMetrics;
}

/** Measure the baselined quantities from gathered evidence. */
export function measureMetrics(evidence: ArchitectureEvidence): RatchetMetrics {
  const capabilities = Object.keys(evidence.capabilityKinds);
  const requiredEdges = evidence.graph.nodes.reduce((total, node) => total + node.required.length, 0);
  return {
    bootModuleCount: evidence.wiredBootFactories.length,
    capabilityCount: capabilities.length,
    dependencyEdgeCount: evidence.graph.edges.length,
    requiredEdgeCount: requiredEdges,
    featureCapabilityCount: capabilities.filter((id) => evidence.capabilityKinds[id] === "feature").length,
    durableNamespaceCount: evidence.ownership.namespaces.length
  };
}

/**
 * Evaluate every ratchet.
 *
 * `baseline` may be undefined, which is the honest state before the first bump: the
 * monotone ratchets then report their measured value with no expectation to miss, so
 * a fresh checkout describes the architecture instead of failing on it. The absolute
 * ratchets are unaffected by a missing baseline — they must hold regardless.
 */
export function evaluateRatchet(evidence: ArchitectureEvidence, baseline: ArchitectureBaseline | undefined): RatchetReport {
  const metrics = measureMetrics(evidence);
  const violationsByRatchet = new Map<RatchetId, RatchetViolation[]>();
  const add = (ratchet: RatchetId, violation: RatchetViolation): void => {
    violationsByRatchet.set(ratchet, [...(violationsByRatchet.get(ratchet) ?? []), violation]);
  };

  for (const cycle of evidence.graph.fatalCycles) {
    add("required-dependency-cycles", {
      ratchet: "required-dependency-cycles",
      subject: cycle.path.join(" -> "),
      detail: cycle.message
    });
  }

  for (const node of evidence.graph.nodes) {
    for (const missing of node.missing) {
      if (missing.kind !== "required") continue;
      add("unresolved-required-dependencies", {
        ratchet: "unresolved-required-dependencies",
        subject: node.id,
        detail: `${node.id} requires ${missing.ref}, which no manifest provides (${missing.reason})`
      });
    }
  }

  for (const conflict of evidence.ownership.conflicts) {
    add("duplicate-state-owners", {
      ratchet: "duplicate-state-owners",
      subject: conflict.namespace,
      detail: conflict.message
    });
  }

  for (const edge of evidence.imports) {
    const fromKind = evidence.capabilityKinds[edge.fromCapability];
    const toKind = evidence.capabilityKinds[edge.toCapability];
    if (edge.fromCapability === edge.toCapability) continue;

    if (fromKind === "kernel" && toKind === "feature") {
      add("kernel-imports-feature", {
        ratchet: "kernel-imports-feature",
        file: edge.from,
        subject: `${edge.fromCapability} -> ${edge.toCapability}`,
        detail: `kernel module ${edge.from} imports feature module ${edge.to}`
      });
      continue;
    }

    // A cross-capability import is legal only when the target is on the provider's
    // declared surface. Anything else reaches into an implementation.
    const surface = evidence.capabilitySurfaces[edge.toCapability] ?? [];
    if (!surface.includes(edge.to)) {
      add("feature-imports-undeclared-surface", {
        ratchet: "feature-imports-undeclared-surface",
        file: edge.from,
        subject: `${edge.fromCapability} -> ${edge.toCapability}`,
        detail: `${edge.from} imports ${edge.to}, which ${edge.toCapability} does not declare on its surface`
      });
    }
  }

  const registered = new Set(evidence.registeredBootFactories);
  for (const file of evidence.wiredBootFactories) {
    if (registered.has(file)) continue;
    add("unregistered-boot-module", {
      ratchet: "unregistered-boot-module",
      file,
      detail: `${file} is wired by the composition root but no manifest names it`
    });
  }

  if (evidence.literalIpcRegistrations > 0) {
    add("literal-ipc-registration-in-main", {
      ratchet: "literal-ipc-registration-in-main",
      file: evidence.mainEntry,
      detail: `${evidence.literalIpcRegistrations} literal ipcMain.handle("<channel>" registration(s) remain in main.ts`
    });
  }

  const results: RatchetResult[] = RATCHET_DECLARATIONS.map((declaration) => {
    const violations = violationsByRatchet.get(declaration.id) ?? [];
    if (declaration.kind === "absolute") {
      const expected = declaration.expected ?? 0;
      return {
        id: declaration.id,
        kind: declaration.kind,
        expectation: `${expected}`,
        observed: `${violations.length}`,
        pass: violations.length === expected,
        violationKind: "absolute",
        violations
      };
    }
    const metric = declaration.metric as RatchetMetricKey;
    const observed = metrics[metric];
    const recorded = baseline?.metrics?.[metric];
    // No baseline yet: describe, do not fail. The absolute ratchets already hold the
    // line, and failing here would make the first checkout un-buildable.
    const pass = recorded === undefined || observed <= recorded;
    return {
      id: declaration.id,
      kind: declaration.kind,
      expectation: recorded === undefined ? "not yet recorded" : `<= ${recorded}`,
      observed: `${observed}`,
      pass,
      ...(pass ? {} : { violationKind: "exceeded" as const }),
      violations: pass ? [] : [{
        ratchet: declaration.id,
        detail: `${metric} is ${observed}, above the recorded baseline of ${recorded}`
      }]
    };
  });

  return {
    results,
    metrics,
    pass: results.every((result) => result.pass),
    absoluteFailure: results.some((result) => result.kind === "absolute" && !result.pass),
    exceeded: results.some((result) => result.kind === "monotone" && !result.pass)
  };
}

/** The baseline a fresh repository starts from, given its measured metrics. */
export function baselineFrom(metrics: RatchetMetrics, reason: string, updatedAt: string, recordedAt?: string, recordedBy?: string): ArchitectureBaseline {
  return {
    $comment: "Ratchet baseline (platform foundation Phase 01). Absolute ratchets are never recorded here — only the monotone metrics a growing capability set legitimately raises. Update only with `pnpm run architecture:baseline:update -- <reason>`.",
    version: 1,
    ...(recordedAt ? { recordedAt } : {}),
    ...(recordedBy ? { recordedBy } : {}),
    reason,
    updatedAt,
    metrics
  };
}
