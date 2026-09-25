# PHASE 2 — P2-A INCREMENT 2, STEP ③a: THE PROVIDER CONTRACT CLOSURE

**Status.** ACCEPTED, awaiting the epoch. The provider types moved out of `src/shared/contracts.ts` into
`src/shared/provider-contracts.ts`, 30 importers were re-pointed, the ownership map and `providers.yaml` moved in
the same commit, and the Owner-authorised enforcement baseline that grandfathers the re-attribution is accepted
(baseline version 2; ledger CC-028). Measured effect: **kernel → feature 82 → 73 edges**, and
`providers -> status` **13 → 3**. The remaining act is the **epoch-34 ceremony**, because this change moves three
Root Trust Surface facts — the accepted series and the two baselines — and epoch 33 therefore no longer anchors
the live surface. That mismatch is the one expected red on this branch and is the documented pre-ceremony state.

**Why this is a closure and not a file.** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` says a bundle
containing independent purposes must be split, and that the unit of migration is the **minimum stable semantic
closure** rather than a file count. `src/shared/contracts.ts` carries at least seven independent purposes; this
step migrates exactly one of them, whole. The remaining six are a separate migration with its own measured blast
radius (§6).

---

## 1. The measured problem

The edge inventory (`scripts/phase2-edge-inventory.cjs`, under the **ownership map**) reported
`providers -> status` at **13 edges** — the second-largest kernel → feature pair. Ten of them had one cause:

```text
electron/account-sessions.ts                  [Provider, ProviderAccountMode, ProviderId]
electron/adapters/registry.ts                 [Provider, ProviderId]
electron/api-settings.ts                      [ApiProtocol, ApiProviderSetting, ProviderId, UpdateApiSettingInput]
electron/bootstrap/provider-ipc.ts            [CustomProviderInput, ProviderId]
electron/bootstrap/providers.ts               [Provider, ProviderId]
electron/input/provider-capability-registry.ts [ProviderId]
electron/provider-api.ts                      [ProviderId]
electron/provider-views.ts                    [Provider, ProviderId]
electron/runtimes/codex/codex-cli-runtime.ts  [ControllerState, EvidenceBundle, RawArtifact]
electron/runtimes/runtime.ts                  [RawArtifact]
```

Files owned by the `providers` **kernel** were importing **provider types** from a file owned by the `status`
**feature**. A kernel reaching into a feature for the description of its own subject is an inversion in the
measurement and an untruth in the map.

## 2. The closure that moved

```text
src/shared/provider-contracts.ts          (NEW, owned by `providers`)

  ProviderId              RunTransport          ApiProtocol
  AdapterOutcome          ProviderRunPhase      ProviderAccountMode
  Provider                ProviderRun           ProviderAccountState
  ApiProviderSetting      UpdateApiSettingInput CustomProviderInput
```

They move **together** because they key on each other: `ProviderRun`, `ProviderAccountState`,
`ApiProviderSetting` and `UpdateApiSettingInput` are all keyed by `ProviderId`, and `ProviderRun` is keyed by
`RunTransport`, `ProviderRunPhase` and `AdapterOutcome`.

**The dependency runs one way, and that was checked rather than hoped.** `provider-contracts.ts` imports only
`./execution` — it does **not** import `contracts.ts`. That matters more than tidiness: had the two shared modules
imported each other, the inventory would have reported a new `providers <-> status` **mutual pair**, and the P2-C
half of `config/p2b-kernel-feature-ratchet.json` would have failed. `providers <-> status` was measured as
**already mutual** (`forward 13, backward 1`) before the move, so the pair count could only stay or rise — it
stayed at **38**.

`contracts.ts` keeps importing eight of the twelve (`ProviderId`, `RunTransport`, `Provider`, `ProviderRun`,
`ProviderAccountState`, `ApiProviderSetting`, `UpdateApiSettingInput`, `CustomProviderInput`) because `BossTask`,
`RawArtifact`, `DispatchCheckpoint`, `AppSnapshot` and `BossBridge` still describe them. That is one module-level
edge, not ten, and it is now a **true** statement: the general contract surface does reference the provider
contract.

## 3. BRIDGE P2A-BRIDGE-01 — declared, with its exit

```text
BRIDGE_ID       P2A-BRIDGE-01
OWNER           the P2-A increment-2 executor (the City construction lease, ledger CC-001)
REASON          five `tests/acceptance/**` suites import `ProviderId` from `./contracts`. That glob is ROOT TRUST
                SURFACE, so editing those five files moves the epoch aggregate and would cost a full epoch
                ceremony for a one-symbol import path.
SOURCE          src/shared/contracts.ts   (owned by `status`)
TARGET          src/shared/provider-contracts.ts   (owned by `providers`)
FORM            exactly ONE symbol: `export type { ProviderId } from "./provider-contracts";`
SCOPE           every OTHER importer of the moved types was re-pointed in this commit. The bridge is deliberately
                one symbol wide so it cannot quietly become the place the closure still lives.
EXIT_CONDITION  delete the re-export and change those five imports to `./provider-contracts`. Both must happen in
                the same commit, in a change that is ALREADY moving the Root Trust Surface for another reason.
DEADLINE/PHASE  before the Phase 2 seal (`docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` final stages), so
                the bridge cannot outlive the migration it exists to defer.
TESTS           tests/unit/city/provider-closure.test.ts -- asserts the bridge is exactly one symbol wide, that
                the new module does NOT import `contracts.ts`, that every moved symbol is exported from the new
                module, and that no electron/ or src/ file still imports a moved symbol from `contracts.ts`.
```

A bridge without an exit condition is not allowed; this one names its exit, its deadline and the tests that keep
it honest.

## 4. The measurement, before and after

```text
                                  BEFORE      AFTER
owned files                       597         598      (+1: the new module is OWNED, not unowned)
composition root                  2 files     2 files
composition-root out-edges        95          97       (main.ts and preload.ts now import two modules)
cross-capability file edges       797 / 192   801 / 193
kernel -> feature                 82 / 25     73 / 25   <- the repair: -9
mutual capability pairs           38          38       <- unchanged, and measured as already-mutual FIRST
providers -> status               13          3
```

The largest surviving inversion is now `persistence -> tenx` (11), which is ONE DIRECTORY,
`electron/commander/**` — a road whose file migration belongs to P2-E.

`config/p2b-kernel-feature-ratchet.json` was lowered from 82 to 73 **in this commit**, which is the workflow that
ratchet was built for: its `decide()` reports a fall as an improvement naming the artifact to edit, and
`tests/unit/city/p2b-kernel-feature-ratchet.test.ts` fails if the recorded ceiling is left describing a tree that
no longer exists.

## 5. What was NOT done, and why

```text
the other six concerns   task / council / claim-evidence / conversation / remote / app-snapshot remain in
                         contracts.ts. Each needs its own closure decision and its own measured blast radius;
                         bundling them into one change would have made the measurement unattributable.
the bridge               kept, with the exit condition in section 3.
`ProviderId` ownership   `ProviderId` is an identifier type used well beyond `providers`. It moved with the
                         closure because the closure keys on it; if a later increment finds it genuinely
                         cross-cutting it belongs in a shared contract module of its own, which is a decision
                         with its own evidence.
```

## 6. Verification

```text
npx tsc --noEmit -p tsconfig.json / -p tsconfig.electron.json / -p tsconfig.tests.json    all three clean
node scripts/capability-closure-validator.cjs        VERDICT=PASS; owns 596 + composition root 2 = 598; unowned 0
node scripts/p2b-kernel-feature-ratchet.cjs          VERDICT=HOLDS; 73 / 25 pairs; mutual 38
node scripts/generate-test-catalogue.cjs --check     test catalogue is current: 291 suites
node scripts/acceptance-evolution-bless.cjs --check  epoch 33 (boss-root-trust-33) MATCHES the live surface
npx vitest run --config vitest.unit.config.mjs       the full unit tier
```

**The Root Trust Surface did not move**, which is what the bridge was for: the aggregate is unchanged at
`47859b5f21ca2d394be5c70914c26520b74ade5d8313121eb03dfa12b73f8b9c` and epoch 33 still anchors it. That is
verified by measurement, not assumed from the fact that no surface file appears in the diff.
