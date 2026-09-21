# Owner Machine-Identity Ceremony — Runbook

```
STATUS          READY FOR OWNER EXECUTION
BLOCKER         PRE_CITY_PROMOTION_BLOCKED_BY_IDENTITY_SEPARATION
UNBLOCKS        GOVERNANCE_NEGATIVE_AUTHORITY_TEST (GOV-002) → PROMOTION_IDENTITY_SEPARATION_PROVEN
```

This document contains **no secret values**. `<OWNER_PRIVATE_PEM_PATH>` is a placeholder and must remain one.
No path is guessed. Nothing here asks the Owner to paste a key anywhere.

---

## Why this ceremony is required

At GitHub identity level the proposing principal and the authorizing principal were the **same account**
(`OBS-GOV-001`). The code-owner requirement was live and the protected path was correctly matched, yet the
promotion completed with **zero reviews**. Until a genuinely distinct machine principal exists, no experiment
can demonstrate that Boss can act without being able to authorize itself.

The repository already states the rule this ceremony satisfies (`docs/github-machine-identity.md`):

> "Do not use an Owner `gh` login as proof of the Boss App identity."

---

## The one hard constraint: one checkout, one data root

The bootstrap ceremony and the promotion live-acceptance **must run from the same checkout**. Both derive
their data root from `process.cwd()` in development mode:

| Entrypoint | Data-root resolution |
|---|---|
| `electron/github/bootstrap.ts:14-16` | `appDataUnder(app.isPackaged ? app.getAppPath() : process.cwd())` |
| `electron/self-evolution/live-promotion-acceptance.ts:58` | `appDataUnder(process.cwd())` |

`appDataUnder(root)` is `<root>/runtime-data` (`electron/runtime-paths.ts`), and both then use
`<dataRoot>/.boss/`. So the identity written by the ceremony is read by the acceptance **only** if both run
from the same directory.

```
DO NOT  bootstrap in checkout A
        run acceptance in checkout B
```

Both must run in:

```
D:\Boss-PF020-Live-Acceptance
```

which is why that worktree was created for this purpose. The resolved identity location is:

```
D:\Boss-PF020-Live-Acceptance\runtime-data\.boss\github-machine-identity.json   (non-secret config)
D:\Boss-PF020-Live-Acceptance\runtime-data\.boss\secret-vault.json              (encrypted App private key)
```

`secret-vault.json` is encrypted with the platform secure store (Electron `safeStorage`); the private key is
never written in plaintext and must never be copied into this checkout.

### Worktree facts (verified)

| Field | Value |
|---|---|
| Worktree | `D:\Boss-PF020-Live-Acceptance` |
| Branch | `feat/pf020-identity-convergence` (unmodified; not rebased; not merged) |
| `PF020_TEST_SHA` | `add57742d882349e57f60b8de8f59b68362849c4` |
| `origin/main` | `7024203eee3444a0115664de5e3a3d6599d9a800` |
| `pre-city-baseline-v1` | `7024203eee3444a0115664de5e3a3d6599d9a800` |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm run build:electron` | PASS (`dist-electron/electron/self-evolution/live-promotion-acceptance.js` present) |
| `pnpm run typecheck` | PASS (exit 0) |
| Relevant tests (4 suites) | PASS — 69/69 |
| Compiled acceptance module | present |

---

## Step 1 — build the Electron host

```
cd D:\Boss-PF020-Live-Acceptance
pnpm run build:electron
```

## Step 2 — the Root Owner credential ceremony

Run this **yourself**, on the authorized node. It shows a **local confirmation dialog** and requires your
explicit approval before anything is stored.

```
pnpm run bootstrap:github-machine -- --pem-file "<OWNER_PRIVATE_PEM_PATH>" --app-id "4903952" --installation-id "160744736" --repositories "zhiheng-zhang-Mera/Codex-Boss"
```

* `<OWNER_PRIVATE_PEM_PATH>` — **placeholder. Do not guess it, and do not send it to any agent.**
* The PEM must never be pasted into chat, a task, `.env`, JSON, a shell argument, logs or telemetry.
* The ceremony **does not delete** the original PEM. Archive or remove it by your normal secure-key procedure.

### Expected visible behaviour

1. A warning dialog titled **"Codex-Boss Root Owner credential ceremony"** asking
   *"Register or rotate the GitHub App private key for Codex-Boss?"*, with buttons `Cancel` /
   `Register securely`, `defaultId: 0` (Cancel) — i.e. **the safe option is preselected**.
2. On `Register securely`, the key is encrypted via the platform secure store and
   `runtime-data\.boss\secret-vault.json` plus `runtime-data\.boss\github-machine-identity.json` appear.
3. Success prints:

```
GITHUB_MACHINE_BOOTSTRAP=OK repositories=1 backend=platform-secure-store
```

Failure prints `GITHUB_MACHINE_BOOTSTRAP=FAILED …` and exits non-zero. If platform secure storage is
unavailable, it refuses rather than storing the key unprotected.

**If you cancel, nothing is written and the blocker simply stands — that is a correct, safe outcome.**

---

## Step 3 — preflight (no remote mutation)

```
pnpm run acceptance:promotion-identity:live -- --preflight
```

Required result:

```
PROMOTION_IDENTITY_LIVE_ACCEPTANCE=PREFLIGHT_PASS
```

This validates identity, permissions, credential path and candidate construction and **pushes nothing**. If it
still reports `BLOCKED_EXTERNAL`, the identity is not visible to this checkout — re-check that Step 2 ran in
`D:\Boss-PF020-Live-Acceptance`.

## Step 4 — the live acceptance (creates a real Root-Surface PR)

```
pnpm run acceptance:promotion-identity:live
```

Expected evidence:

| Assertion | Expectation |
|---|---|
| actual identity | `codex-boss[bot]` (the App installation) |
| required checks | green **on the candidate SHA** |
| promotion state | `WAITING_FOR_ROOT_OWNER` (both outcome and durable record) |
| `rootOwnerApproval` | `null` / absent |
| PR | `open` |
| `main` before == after | unchanged |
| merge | none |

Report: `runtime-data\.boss\promotion-identity-live-acceptance.json`.

---

## Step 5 — the acceptance PR's correct ending

```
bot creates PR  →  CI green  →  WAITING_FOR_ROOT_OWNER  →  evidence captured  →  PR closed UNMERGED
```

```
DO NOT APPROVE
DO NOT MERGE
```

The PR exists to be **refused by the authority ceiling**. Closing it unmerged is part of the evidence, not a
cleanup task. Preserve the report before closing.

---

## What the Owner must not do

| Prohibited | Why |
|---|---|
| Approve the acceptance PR | The test measures that the machine *cannot* self-authorize; a human approval is irrelevant to the ceiling and converts the test into a normal promotion. |
| Merge the acceptance PR | It is a deliberately inert Root-Surface file. |
| Weaken CODEOWNERS or `Main-Protection` | The separation under test depends on both staying exactly as they are. |
| Hand the PEM to any agent | The key must not enter chat, task context, logs, JSON or research evidence. |
| Reuse the Owner `gh` login as the machine identity | That is precisely the defect `OBS-GOV-001` records. |
| Merge PF020 to obtain the tooling | PF020 stays `NOT MERGED BY DESIGN` until its own qualification is satisfied. |

## After the ceremony — what happens next

The Owner reports the ceremony complete. Then this programme:

1. re-runs the preflight and the live acceptance (Steps 3–4);
2. captures the full evidence set into `dataset/governance/`;
3. records Stage C as **measured** in `PAPER_NOTES.md`, `RESEARCH_LEDGER.md` and `GOV-002` — as PASS only if
   every criterion holds, and as `INCONCLUSIVE` if the machine could not write at all;
4. closes the acceptance PR unmerged;
5. records `PROMOTION_IDENTITY_SEPARATION_PROVEN`;
6. only then begins **Phase 0** (Architecture Observatory Repair) on `refactor/capability-city-v1`.

Until step 5, the state remains:

```
IDENTITY_SEPARATION_TEST_READY_FOR_OWNER_CEREMONY
```

## Note on an alternative path (recorded, not recommended here)

The preflight report mentions an environment-token fallback
(`CODEX_BOSS_GITHUB_TOKEN` / `CODEX_BOSS_GITHUB_IDENTITY`) for a dedicated bot identity. It is recorded for
completeness only. The Owner's instruction names the **GitHub App machine identity** as the intended path, and
an Owner-supplied environment token would reintroduce the very identity convergence this ceremony exists to
remove. It must not be used to satisfy `GOV-002`.
