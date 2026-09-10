# Architecture — Root Defense & Isolation

This document explains how the Phase 0 pieces fit together and why each
structural decision was taken. It is written for the next reader who has to
change something here, so it records the *rejected* alternatives too.

---

## 1. The one idea

```text
Stable (the running Boss)
  │
  │  owns: policy, ledger, git refs, remote adapter, promotion, rollback, stop
  │
  └── Candidate (one evolution run, one worktree, one runtime tree)
        │
        │  may: read/write inside its own root, run host-selected test/build,
        │       ask for a review, write evidence
        │
        └── may never: reach the network, hold a shell, touch Stable's files,
                       decide its own promotion, or clear a freeze
```

Everything below is machinery in service of that split.

---

## 2. Decision composition — one direction only

```text
ROOT_OPERATION_FLOOR          (compiled in, contracts.ts)
        │
        ├── immutable: no policy, mode or profile can lower it
        ▼
policy file                   (.codex-boss/root/root-policy.json)
        │
        ├── may only tighten
        ▼
path assessment               (protected-surface.ts, via the guard)
        │
        ▼
final = strictest(floor, policy, path)
```

`RootDecision` is totally ordered `ALLOW (0) < REQUIRE_OWNER (1) < DENY (2)`,
and `foldRootDecisions` reduces a set to its strictest member. This is why a
permissive sub-decision can never launder a stricter one, and why §4's
"任何未来模式都不得把 DENY 转成 ALLOW" is a property of the composition rather
than a rule someone has to remember.

The `mode` argument on `classify()` exists **only** so the ledger can attribute a
request. It is not part of the composition, and a test asserts that all five
modes produce identical decisions for every escalation.

---

## 3. Modules

### 3.1 `src/shared/root-authority/` — pure, shareable

No `fs`, no `electron`, no DOM, so the same logic is usable from the renderer's
status surface and is trivially testable.

| File | Responsibility |
|---|---|
| `contracts.ts` | `RootDecision`, the operation vocabulary, `ROOT_OPERATION_FLOOR`, `ROOT_OPERATIONS`, ledger record shape |
| `root-policy.ts` | Policy schema, strict validator, `decideRootOperation`, `policyLoosensFloor` |
| `protected-surface.ts` | `ROOT_PROTECTED_MANIFEST`, CODEOWNERS parsing/compilation, path normalization, `assessProtectedPaths` |
| `promotion-state.ts` | Promotion state machine, exact-SHA contract, `decidePromotion` |

`ROOT_OPERATION_FLOOR` is a data table rather than a set of `if` statements so
that "is this operation denied?" is answerable by inspection, in review, in
tests, and in evidence generation — the same answer every time.

### 3.2 `electron/root-authority/` — the host decision point

| File | Responsibility |
|---|---|
| `root-policy-loader.ts` | Load + validate the policy; degrade explicitly when missing/unreadable/invalid |
| `protected-surface-guard.ts` | Resolve real paths (symlinks/junctions/case) **through the existing `workspacePath` containment**, then classify |
| `root-audit-ledger.ts` | Append-only JSONL with a hash chain; refuses to continue after truncation/deletion/rewrite |
| `root-authority.ts` | Compose floor + policy + path; record every decision; named §4 guards |
| `execution-profile.ts` | §10 capability set, command classifier, sanitized child environment |

**Why the guard delegates to `workspacePath`.** Plan §2 requires Root Defense to
be built *on* the existing workspace containment rather than beside it. The guard
therefore calls the same `workspacePath()` that `proposal-runner`, `native-tools`
and `command-runner` already trust, so traversal, absolute-path and
symlink/junction escape are decided in exactly one place. A second, parallel
containment implementation would inevitably drift from the first.

**Why the ledger is a separate trust object.** `durable-json.ts` writes by atomic
rename, which is right for state and wrong for a log: it would replace the whole
file. The ledger uses `O_APPEND` + `fsync`, and keeps a last-observed shape so a
shrunken or vanished file is detected on the *next* append. Deleting audit history
and carrying on is the failure mode §7.3 names; it is now a hard error, and FI-03
asserts the Root-sensitive operation stops rather than proceeding unlogged.

**Why the ledger must be outside the Candidate root.** A Candidate that can
rewrite its own audit trail has no audit trail. The constructor refuses a ledger
path inside the workspace (`RootSurfaceError`).

### 3.3 `electron/credential-boundary/` — two trust domains

`sanitized-environment.ts` removes credentials in two independent layers (an
explicit name list and a shape pattern), because either alone is easy to defeat.
`OWNER_CREDENTIAL_VARIABLES` covers the GitHub/git/SSH/cloud/registry names the
plan lists; `CREDENTIAL_NAME_PATTERN` catches `*_TOKEN`, `*_SECRET`,
`*_PASSWORD`, `*_API_KEY`, `*_PRIVATE_KEY`, `*_SIGNING_KEY` and friends. The
boundary preamble already blocks `PATH`-like names, verified by test.

The removal is *verified*, not assumed: `assertNoCredentialLeak` runs as a
post-condition, and the acceptance battery spawns a real child through the real
`runAllowedCommand` and asks the child whether it can see `GH_TOKEN`.

`credential-boundary.ts` deliberately does **not** enumerate the Owner's
secrets. It reads variable *names* and, for equality checks only, SHA-256
fingerprints. Scanning the home directory, the registry, the credential manager
or an SSH agent is itself the escalation §4 forbids, so the boundary is built
from what the process was *given*.

`github-credential-provider.ts` has exactly two outcomes, `AVAILABLE` and
`BLOCKED_EXTERNAL`. There is no third branch, so there is nowhere for an Owner
fallback to hide. A dedicated credential that is byte-identical to an ambient
Owner token is refused; a credential whose identity is the Root Owner is refused.

### 3.4 `electron/stable-candidate/` — the physical split

`runtime-isolation.ts` defines the per-run layout and the write predicate.
`workspace-manager.ts` is the **only** place the evolution path writes git refs.
`candidate-supervisor.ts` owns the "Stable survives" contract.

**Why a worktree and not a clone.** Plan §8.2 permits `git worktree` subject to
three conditions, all of which hold:

1. *"Candidate worker 无任意 git shell 权限"* — the EVOLUTION profile has no
   shell channel and its classifier denies `push/fetch/pull/remote/clone/reset/
   checkout/switch/clean/commit/merge/rebase/config/apply` outright.
2. *"git ref 写操作只由 Stable host adapter 完成"* — every mutating git call is in
   `workspace-manager.ts`, invoked directly by the host.
3. *"Candidate 修改 API 只能访问 candidate root"* — file access goes through the
   workspace containment rooted at `layout.workspace`.

A clone was rejected because it would need a second object store and a second
`node_modules` per run for no additional isolation, and because it would make
"what is the candidate's diff?" a remote comparison instead of a local one.

**Why the base SHA is frozen.** `createCandidateWorkspace` refuses a base that is
not Stable's current HEAD unless the caller explicitly says otherwise. Validating
one tree and promoting another is the classic way this goes wrong, and a default
of "any commit" would have made it easy.

**Why the supervisor never throws.** `supervise()` returns a `CandidateOutcome`
for every failure mode — thrown error, async rejection, child-process crash,
forced kill, timeout, bad config — and never rethrows. The outcome carries
`stableSurvived: true` explicitly so a caller can assert the property instead of
inferring it. A stale lock from a killed Candidate is expected and cleared by the
next run, so a crash cannot wedge Stable.

### 3.5 `electron/promotion-gate/` — evidence, not assertion

`exact-sha-gate.ts` reads the Candidate's **live** HEAD and refuses a binding that
no longer matches reality; without this the four SHAs could agree on a value the
workspace has already left. `promotion-controller.ts` then corrects the evidence
binding when the live check fails, so the pure decider sees a real mismatch rather
than an annotated green one.

`decidePromotion` orders its checks most-restrictive first: emergency stop →
external blocker → exact SHA → required checks → reviewer → up-to-date → Root
Surface ceiling. Because the order is fixed, a later green signal can never
outrank an earlier red one.

`promotion-controller.ts` keeps state durable and separates *evaluating* from
*promoting*: `evaluate` never promotes, `beginPromotion` only moves to
`PROMOTING`, `completePromotion` only from `PROMOTING`. That is what makes "worker
DONE never becomes PROMOTED" structural.

The `WAITING_FOR_ROOT_OWNER` wait is sticky: repeated calls are idempotent, the
record survives a restart, and the state is explicitly short-circuited instead of
being run through the normal advance path — so it can never be re-read as
stagnation and bypassed (FI-05).

### 3.6 `electron/emergency-control/` — an asymmetric stop

Raising the freeze is open to any actor who can reach the control surface; a stop
that requires approval is not an emergency stop. Clearing requires an
`OwnerControlChannel` registered in a module-private `WeakSet` whose login matches
the Root Policy. An object literal that merely looks like a channel is rejected at
runtime, not just at compile time.

State is re-read from disk on **every** call — there is no cache — so a restart
cannot present a stale `ENABLED` view. Read policy, stated explicitly because
"fail-closed" is meaningless without it:

| Situation | Result |
|---|---|
| No control record, no sentinel | `ENABLED` (freezing requires a positive Owner marker) |
| Record or sentinel says frozen | `FROZEN_BY_OWNER` |
| Record present but corrupt/unreadable | `FROZEN_BY_OWNER` — an unreadable Owner freeze is never read as consent |
| Sentinel present but unreadable | `FROZEN_BY_OWNER` — presence is the freeze |
| Sentinel/record path inside a Candidate root | Constructor refuses |

### 3.7 `electron/root-recovery/` — reversible promotion

`RollbackController` requires a checkpoint written *before* promotion and replays
it as a `git revert` commit. History is never rewritten, because
`git.force.push` is a §4 DENY: a rollback that needed one would be a rollback that
must not happen. A failed rollback is recorded with its error rather than reported
as success.

`assessStableImpact` maps all nine §12.1 failure classes onto the evolution
module's own state (`ABORTED` for faults the Candidate's work caused, `DEGRADED`
for machinery faults) and always reports `affectsStablePath: false`.

---

## 4. Integration with the existing engineering loop

Plan §16 asks Root Defense to be an **outer constraint**, not a replacement:

```text
Finding
  -> candidate scope
  -> RootAuthority.classify()          <-- new outer boundary
  -> ProposalRunner                    (unchanged)
  -> host verification                 (unchanged)
  -> independent review                (unchanged)
  -> convergence                       (unchanged)
  -> PromotionController               <-- new outer boundary
```

Concretely, existing modules changed as little as possible:

| Existing file | Change | Why it is safe |
|---|---|---|
| `electron/engineering/command-runner.ts` | `runAllowedCommand` gained an **optional** fourth parameter `{ env }`; the default remains `process.env` | Every existing call site is unchanged and behaves identically. The seam is what lets the evolution profile inject a sanitized environment |
| `.gitignore` | Added `!.codex-boss/root/` and `!/Update-Plan/Autonomous-Evolution-Phase0/`, plus `/evolution/` | New files must be trackable; the isolation tree must not be |
| `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`, `tsconfig*.json`, `vite.config.mjs`, `vitest.config.mjs`, all `scripts/*` gates, all existing tests | **Unchanged** | No gate was weakened, no acceptance deleted, no test skipped |

`pnpm test` already discovers `tests/**/*.test.ts`, so the new batteries are
picked up with no CI change — which is exactly what plan §5 asks for.

---

## 5. Threat model, and what is explicitly out of scope

In scope (and tested): an adversarial or merely wrong Candidate, an adversarial
model output, ambient Owner credentials on the host, a frozen/unfrozen switch, a
crashed or corrupt Candidate, a stale SHA, a green-but-unapproved Root change, an
unreachable GitHub.

Out of scope, stated plainly so nobody mistakes this for more than it is:

- **A hostile Owner.** The Root Owner is trusted by construction.
- **A hostile host OS or a local administrator.** Nothing here defends against
  code that already has kernel-level control of the machine.
- **A compromised release pipeline outside this repository.**
- **Unattended promotion itself.** The code path exists and is exercised, but the
  dedicated Boss GitHub identity is an Owner action outside the repository and has
  not been configured, so `READY_FOR_UNATTENDED_PROMOTION` is reported as
  `BLOCKED_EXTERNAL` rather than claimed.

---

## 6. Where the invariants are enforced

| Invariant | Enforcement point |
|---|---|
| Boss may not supersede the Root Owner | `ROOT_OPERATION_FLOOR` + `decideRootOperation` + `RootAuthority` named guards |
| Candidate failure cannot corrupt or terminate Stable | `runtime-isolation.ts` write predicate + `CandidateSupervisor` outcome contract |
| No Owner-equivalent authority via ambient credentials | `sanitized-environment.ts` + `assertNoCredentialLeak` + `github-credential-provider.ts` |
| Promotion is bound to the exact SHA | `ExactShaGate` (live HEAD) + `evaluateExactShaBinding` + `decidePromotion` |
