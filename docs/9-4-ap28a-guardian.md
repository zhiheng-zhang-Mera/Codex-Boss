# AP28a — Guardian Boundary

Compact handoff for Acceptance Pack **AP28a** (plan §28 Guardian + Hardware-backed Secrets,
Guardian half). Branch `9-4`.

## Why

AP28 was `MISSING`: safeStorage exists but there was no Guardian/classification boundary — no
answer to "which runtime changes may proceed without ceremony and which require the Guardian".
The plan §28 defines three tiers (mutable / protected / guardian-root) plus a Guardian token gate.
This pack ships the pure boundary + enforcement on the permission system; the hardware-backed
secrets half stays open for AP28b.

## What was added

- **`src/shared/guardian.ts`** (new, pure)
  - `GuardianGuard = "mutable" | "protected" | "guardian"`.
  - Vocabularies exactly per §28:
    - `GUARDIAN_MUTABLE` (5): ui, worker.prompts, routing.heuristics, scheduler.heuristics,
      knowledge.retrieval — tunable at runtime, no token.
    - `GUARDIAN_PROTECTED` (7): verification.rules, rollback, permission.system,
      security.classifier, migration.rules, promotion.gate, approval.policy — token required.
    - `GUARDIAN_ROOT` (5): root.policy, production.signing, backup.deletion,
      classification.downgrade, core.security.boundary — §28 Guardian-root tier, token required
      here; signing/key-custody ceremonies deferred to AP28b.
  - `classifyArea(area)` maps a concrete area to its tier; unknown areas default to **mutable**
    (the mutable tier is an open list — restricting means listing).
  - `changeAllowed(area, guardToken, scope)` returns a `GuardianVerdict { allowed, reason }`
    with first-class denial strings (fail-closed for protected/guardian without token).
- **`electron/security/permission-manifest.ts`** — added `guardedGrant(workspaceId, kind, entry,
  guardToken)` on `PermissionManifestStore`: `permission.system` is Guardian-protected, so the
  grant only persists when a token is present; it returns the `GuardianVerdict`. Unguarded
  `grant()` remains for internal bootstrapping so existing callers/tests keep working.
- **`tests/guardian.test.ts`** (new, 10 tests) — tier mapping for every §28 vocabulary entry,
  disjointness/exactness of the three sets, open-list default for unknown areas, allow/deny
  verdicts for mutable vs protected vs guardian with and without a token, and store-level
  integration: guarded grant fails closed without a token (manifest unchanged) and persists with
  one, plus unguarded `grant()` back-compat.

## Verification

- Targeted: `guardian` (10) + `permission` (4) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running in background; expected green.

## Boundary notes

- Pure shared module — no node imports, compiles under both tsconfigs.
- `grant()` keeps its pre-pack behavior (direct write) so AP18a callers are untouched; all
  new enforcement goes through `guardedGrant`.
- Remaining AP28 half (hardware-backed secrets: safeStorage key custody, signing, backup
  deletion ceremonies) is AP28b.

## Checkpoint

Commit with: `src/shared/guardian.ts`, `electron/security/permission-manifest.ts`,
`tests/guardian.test.ts`.
