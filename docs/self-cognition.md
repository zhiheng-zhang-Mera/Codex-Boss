# Self Cognition — what Boss knows about itself

`CAN_DESCRIBE_SELF = YES` · `CAN_DIAGNOSE = NO` · `CAN_MUTATE_SELF = NO`

Self Cognition answers one family of questions: **what am I made of, what can I do, what depends on
what, and who may change it.** It does not decide whether anything is wrong, it proposes and
performs nothing, and it keeps no history. Those belong to Self Diagnosis and the Case Record, which
are separate modules with their own boundaries.

## Where it lives

| path | what it owns |
|---|---|
| `src/shared/self-cognition/contracts.ts` | the vocabulary: availability facts, component and capability descriptors, the self model, the graphs |
| `src/shared/self-cognition/anatomy.ts` | `buildSelfModel` and the four graphs, as pure functions of a fact bundle |
| `src/shared/self-cognition/describe.ts` | the six questions: `describeSelf`, `describeComponent`, `describeCapability`, `dependencyPath`, `affectedBy`, `authorityOf` |
| `electron/self-cognition/facts.ts` | the only module that reads the checkout, and it only reads |
| `scripts/self-view.cjs` | the runnable self view |

## The facts, and where they come from

Nothing here is a hand-written inventory. The model is derived from:

- `config/capabilities/*.yaml` — what each capability provides, requires, owns and whether it is
  critical;
- `config/capability-modules.json` — which capability owns which path;
- `electron/main.ts` — the composition root's own wiring, read from its source;
- `package.json` — the runnable entry points;
- `config/architecture-baseline.json` — the recorded density metrics;
- `src/shared/autonomous-evolution-trust.ts` (`classifySurface`) and
  `electron/root-authority/protected-surface-guard.ts` — the **real** authority classifiers.

A source that cannot be read is recorded in `SelfFacts.unreadable` with the reason and becomes a
component of its own. `查不到 != 不存在`: a manifest that failed to parse never looks like a
capability that is not there.

## The derivations that a document gets wrong

- **`dependents` is the inverse of `dependencies`.** No component declares what depends on it, so
  the two directions cannot disagree. A declared requirement is a *contract*; the dependency edge
  names the component that provides it, which is what makes dependency paths walkable. The contract
  refs stay visible as `inputs`, so an unresolved requirement is not silently dropped.
- **Authority takes the strictest verdict over a component's own paths.** A component with one Root
  Trust path is a Root Trust component however many product paths it also owns.
- **The two authority guards answer different questions and both are reported.** On this repository
  `package.json` is a `PRODUCT_SURFACE` path that an owner must still review; `trust-policy/*` and
  `tests/acceptance/*` are `ROOT_TRUST_SURFACE`; `scripts/acceptance-*.cjs` are
  `VERIFICATION_SURFACE`.
- **Absence is a status, not a default.** `UNKNOWN` means the question was asked and could not be
  answered; `NOT_MEASURED` means nothing observed it; `UNAVAILABLE` means it was established to be
  absent. None of them means "fine", and none of them means "does not exist".

## The six answers

```text
describeSelf()            components by kind, capabilities, data flows, the authority split
describeComponent(id)     responsibility, paths, registration, inputs/outputs, dependencies,
                          dependents, owned state, health signals, authority
describeCapability(id)    providers, consumers, requirements, availability, authority
dependencyPath(from, to)  the shortest declared path, and how many components were searched
affectedBy(id)            transitive dependents, blast radius, affected capabilities, owned state
authorityOf(id)           the tier, the owner-review verdict, and the paths behind them
```

`authorityOf` reports a verdict and nothing else: the answer has three fields, there is no grant
field, and `CAN_DESCRIBE_SELF != CAN_AUTHORIZE_SELF`.

## The body's identity, and drift

A self view is only comparable with another if both say which body they describe.

`selfModelHash(model)` is a fingerprint over the **anatomy** — component ids, kinds, paths,
dependencies, owned state, authority verdicts, health signals, unreadable facts, capability
providers/consumers/requirements/availability, and data flows — and deliberately **not** over
`capturedAt` or `repositoryRoot`. Two observations of the same body therefore hash the same, and a
hash that moves means the body moved. `describeSelf` carries `selfModelVersion` (`self-model-v1`)
and `selfModelHash`, so a stored self view identifies itself.

`selfModelDrift(previous, next, at)` returns a `SELF_MODEL_DRIFT_REPORT`: components added and
removed, dependencies, authority, owner-review verdicts, health signals and source paths that
changed, capability availability and authority that changed, data flows whose readers changed, and
facts that stopped or started being readable.

```bash
node scripts/self-view.cjs --json --out artifacts/self-view.json     # carry the hash
node scripts/self-view.cjs --drift artifacts/self-view.json          # what moved since
```

A drift report describes the body and **modifies nothing** — least of all a case record. A case
keeps the self model version and hash it was opened against, so a later reader can tell which body
a diagnosis was made from.

## Running it

```bash
pnpm run build:electron
node scripts/self-view.cjs
node scripts/self-view.cjs --component persistence
node scripts/self-view.cjs --capability knowledge
node scripts/self-view.cjs --path promotion knowledge
node scripts/self-view.cjs --affected persistence
node scripts/self-view.cjs --authority module:package.json
node scripts/self-view.cjs --json --out artifacts/self-view.json
```

A question the model cannot answer exits non-zero with the reason, so a script cannot mistake "not
found" for an answer.

## What it deliberately is not

- **Not a diagnosis.** The word does not appear in its implementation, and no export can produce a
  symptom, a hypothesis or a treatment. `describeSelf` reports authority *tiers*, never health.
- **Not a repair.** The pure modules contain no filesystem call at all and no verb that writes,
  applies or overrides. The host module reads and nothing else.
- **Not a knowledge base and not a case record.** It holds no history: the model is rebuilt from the
  repository every time it is asked.

These are enforced by `tests/unit/self-cognition/boundary.test.ts`, which reads the module's own
source and its own answers rather than trusting this page.
