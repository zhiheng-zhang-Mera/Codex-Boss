import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInsideWorkspace as pathContainment } from "../workspace/path-utils";
import { RuntimeIsolationError } from "./runtime-isolation";

/**
 * Where a run's Candidate evolution root lives — one policy, every topology.
 *
 * ## The defect this module corrects
 *
 * The host used to default `evolutionRoot` to `<userData>/evolution`
 * (`self-evolution-host.ts`). In packaged mode that is safe because `%LOCALAPPDATA%` happens to sit
 * outside the checkout. In development `userData` is `runtime-data/` **inside** the Stable checkout, so
 * the Candidate tree landed inside Stable and `verifyRuntimeSeparation` correctly refused:
 *
 *     RuntimeIsolationError: candidate runtime tree overlaps Stable surfaces:
 *     <candidate root inside stable root>
 *
 * The invariant was right and was not touched. The **root-placement policy** was wrong: it made the
 * separation a property of where the OS puts application data rather than a property of this module.
 * Every supported topology must now be *structurally* disjoint, not accidentally so.
 *
 * ## What this module does not do
 *
 * It does not decide whether a layout is acceptable — `verifyRuntimeSeparation` in `./runtime-isolation`
 * owns that rule and this module calls it. There is no bypass, no "allow nested candidate" switch, and
 * no test-only exception. A location that fails the invariant is never returned.
 *
 * ## Read-only by construction
 *
 * This module resolves and probes a directory. It does not read the machine identity, the vault, or any
 * credential, and it puts no secret into the values it returns.
 */

/** Explicit override, used by an operator or by a live-acceptance run that needs a deterministic root. */
export const EVOLUTION_ROOT_ENV = "BOSS_EVOLUTION_ROOT";

/** Where the resulting location came from. Recorded as evidence rather than inferred. */
export type EvolutionRootSource = "override" | "user-data" | "external-sibling" | "os-temp";

/** Non-secret provenance for the resolved location. Safe to write into evidence. */
export interface EvolutionRootOrigin {
  source: EvolutionRootSource;
  /** Stable root this resolution was proven against. */
  stableRoot: string;
  /** Deterministic, non-secret installation discriminator (see `evolutionRootFingerprint`). */
  fingerprint: string;
  /** Human-readable reason, for evidence. */
  detail: string;
}

export interface ResolvedEvolutionRoot {
  evolutionRoot: string;
  origin: EvolutionRootOrigin;
}

export interface EvolutionRootRejection {
  constraint: string;
  detail: string;
  attempted: string;
}

export interface ResolveEvolutionRootInput {
  /** The Stable application root the Candidate must stay out of. */
  stableRoot: string;
  /** Stable's application data root. Preferred host-owned location, used when genuinely external. */
  userData: string;
  /** Operator/acceptance override. Accepted only when it satisfies the invariant. */
  explicitOverride?: string;
  /** Alternate OS root used by the fallback. Injectable so tests are not bound to one machine. */
  osTempRoot?: string;
  /** Probe injected by tests; must return true only when a writable external root was established. */
  probe?: (candidateRoot: string) => boolean;
}

const MAX_LOCATION_LENGTH = 200;

/**
 * Deterministic, non-secret installation discriminator.
 *
 * Two checkouts can share a directory name (`D:\a\Codex-Boss` and `E:\b\Codex-Boss`), so a layout keyed
 * on the name alone would collide. The fingerprint hashes the canonical Stable root, which makes the
 * default location unique per installation without exposing the path and without a random component
 * (a random one would strand a previous run's tree on every invocation).
 *
 * `os.homedir()` is deliberately **not** used: on Windows it is derived from `USERPROFILE`, so the same
 * installation would fingerprint differently per user and the Candidate tree would move.
 */
export function evolutionRootFingerprint(stableRoot: string): string {
  let canonical = path.resolve(stableRoot);
  try {
    canonical = fs.realpathSync.native(canonical);
  } catch {
    /* not resolvable yet — the resolved spelling is a fine basis */
  }
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function isSamePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/**
 * Checks every constraint a Candidate evolution root must satisfy before it may be returned.
 *
 * Exported so the acceptance instrument can record *why* a location was accepted, and so the rule is
 * testable without filesystem side effects.
 *
 * Containment is evaluated lexically on purpose: the answer must be available for a directory that does
 * not exist yet, and `pathContainment` resolves each side against the filesystem, so a real spelling and
 * a short/junction spelling of the same directory are compared as the same place.
 */
export function evolutionRootConstraints(stableRoot: string, candidate: string): EvolutionRootRejection | undefined {
  const resolved = path.resolve(candidate);
  if (!path.isAbsolute(candidate)) {
    return { constraint: "absolute", detail: "the location must be absolute", attempted: resolved };
  }
  if (isSamePath(stableRoot, resolved)) {
    return { constraint: "distinct-from-stable", detail: "the location must not be the Stable root itself", attempted: resolved };
  }
  if (pathContainment(stableRoot, resolved)) {
    return { constraint: "outside-stable", detail: "the location must be outside the Stable root", attempted: resolved };
  }
  if (pathContainment(resolved, path.resolve(stableRoot))) {
    return { constraint: "must-not-contain-stable", detail: "the location must not contain the Stable root", attempted: resolved };
  }
  if (resolved.length > MAX_LOCATION_LENGTH) {
    return { constraint: "length", detail: `the location must be at most ${MAX_LOCATION_LENGTH} characters`, attempted: resolved };
  }
  return undefined;
}

/**
 * Proves a directory is genuinely usable as an external Candidate root: created (with parents) and
 * actually writable. A path that satisfies the containment rules but cannot hold a tree would defer the
 * failure to git-worktree time, so it is probed here instead.
 *
 * A failed probe leaves nothing behind, and the caller treats the location as invalid.
 */
export function probeExternalRoot(candidateRoot: string): boolean {
  const marker = path.join(candidateRoot, `.isolation-probe-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(candidateRoot, { recursive: true });
    fs.writeFileSync(marker, "", { flag: "wx" });
    fs.rmSync(marker, { force: true });
    return true;
  } catch {
    try {
      fs.rmSync(marker, { force: true });
    } catch {
      /* the probe already failed; nothing further to do */
    }
    return false;
  }
}

function accept(
  evolutionRoot: string,
  source: EvolutionRootSource,
  stableRoot: string,
  fingerprint: string,
  detail: string
): ResolvedEvolutionRoot {
  return { evolutionRoot, origin: { source, stableRoot, fingerprint, detail } };
}

/**
 * Resolves the Candidate evolution root **synchronously**, or throws `RuntimeIsolationError`.
 *
 * Synchronous on purpose: the host resolves this during its synchronous construction (the boot block at
 * `main.ts:589` is not async), and every filesystem operation involved — create, probe, remove — has a
 * synchronous form. Making the caller async would have forced the boot contract to change for a
 * path-placement decision, which is a far larger change than this repair needs.
 *
 * Order, and why each step exists:
 *
 *   1. an **explicit override** is honoured only when it satisfies every constraint. An unsafe override
 *      is a hard error, never a silent fallback to something else, because a fallback would hide the
 *      operator's mistake;
 *   2. `<userData>/evolution` is preferred **when it is genuinely outside Stable**, which is the packaged
 *      topology, and keeps existing installations on the path they already use;
 *   3. otherwise an **external host-owned location** is used. The preferred fallback is a sibling of
 *      Stable, so a development checkout keeps its Candidate tree beside itself rather than in a shared
 *      temporary directory; if that parent is not writable, the OS temp root is used;
 *   4. the chosen location is re-verified against Stable and probed for real writability;
 *   5. if no candidate satisfies the invariant, this throws. It never returns an unsafe location.
 */
export function resolveEvolutionRoot(input: ResolveEvolutionRootInput): ResolvedEvolutionRoot {
  const stableRoot = path.resolve(input.stableRoot);
  const userData = path.resolve(input.userData);
  const fingerprint = evolutionRootFingerprint(stableRoot);
  const probe = input.probe ?? probeExternalRoot;
  const rejections: EvolutionRootRejection[] = [];

  const override = input.explicitOverride ?? process.env[EVOLUTION_ROOT_ENV];
  if (override !== undefined && override !== "") {
    const rejection = evolutionRootConstraints(stableRoot, override);
    if (rejection) {
      throw new RuntimeIsolationError(
        `the configured evolution root is not outside the Stable root (${rejection.constraint}: ${rejection.detail}): ${rejection.attempted}`
      );
    }
    const resolved = path.resolve(override);
    if (!probe(resolved)) {
      throw new RuntimeIsolationError(`the configured evolution root is not writable: ${resolved}`);
    }
    return accept(resolved, "override", stableRoot, fingerprint, "explicit override, verified outside Stable and writable");
  }

  const underUserData = path.join(userData, "evolution");
  const userDataRejection = evolutionRootConstraints(stableRoot, underUserData);
  if (!userDataRejection && probe(underUserData)) {
    return accept(underUserData, "user-data", stableRoot, fingerprint, "<userData>/evolution is outside Stable and writable");
  }
  rejections.push(
    userDataRejection ?? { constraint: "writable", detail: "the location could not be created or written", attempted: underUserData }
  );

  const externalSibling = path.join(path.dirname(stableRoot), `${path.basename(stableRoot)}-evolution-${fingerprint}`);
  const siblingRejection = evolutionRootConstraints(stableRoot, externalSibling);
  if (!siblingRejection && probe(externalSibling)) {
    return accept(
      externalSibling,
      "external-sibling",
      stableRoot,
      fingerprint,
      "sibling of Stable, keyed by installation fingerprint so distinct checkouts cannot collide"
    );
  }
  rejections.push(
    siblingRejection ?? { constraint: "writable", detail: "the location could not be created or written", attempted: externalSibling }
  );

  const tempRoot = path.join(input.osTempRoot ?? os.tmpdir(), `codex-boss-evolution-${fingerprint}`, "evolution");
  const tempRejection = evolutionRootConstraints(stableRoot, tempRoot);
  if (!tempRejection && probe(tempRoot)) {
    return accept(tempRoot, "os-temp", stableRoot, fingerprint, "OS temporary root, keyed by installation fingerprint");
  }
  rejections.push(
    tempRejection ?? { constraint: "writable", detail: "the location could not be created or written", attempted: tempRoot }
  );

  throw new RuntimeIsolationError(
    `no Candidate evolution root outside the Stable root could be established: ${rejections
      .map((rejection) => `${rejection.constraint} (${rejection.attempted})`)
      .join("; ")}`
  );
}
