# GOV-004 — Runtime-isolation nested-root defect: scope determination

```
CLASSIFICATION        PRODUCTION_AND_INSTRUMENT
SUBJECT_SHA           add57742d882349e57f60b8de8f59b68362849c4  (feat/pf020-identity-convergence)
PREDICATE             electron/stable-candidate/runtime-isolation.ts:174-182  verifyRuntimeSeparation()
PROBE                 read-only; no file patched, no test mocked, no state changed
OWNER_REVIEW_REQUIRED yes — see "Required Owner decision"
```

## 0. Method

Three steps, in order, before any code was touched:

1. **Enumerate every caller** of `createCandidateWorkspace`, `evolutionLayout` and `verifyRuntimeSeparation`
   (proposal §1).
2. **Trace the geometry each caller instantiates**, from the production composition root down.
3. **Call the real predicate** with those exact geometries, using the compiled module
   (`dist-electron/electron/stable-candidate/runtime-isolation.js`) so the determination rests on the shipped
   predicate rather than on a re-implementation of it.

## 1. Caller census

| Function | Caller | Classification |
|---|---|---|
| `createCandidateWorkspace` | `electron/self-evolution/live-promotion-acceptance.ts:187` | **instrument** |
| | `electron/self-evolution/self-evolution-coordinator.ts:337` | **production** |
| | `tests/unit/root-authority-red-team.test.ts:62` | test |
| | `tests/unit/stable-candidate.test.ts:139,169,171,178,179,180,181,187` | test |
| `evolutionLayout` | `electron/stable-candidate/workspace-manager.ts:103` | shared helper (both paths) |
| | `electron/self-evolution/self-evolution-coordinator.ts:819` (re-export) | production |
| | `tests/unit/stable-candidate.test.ts`, `tests/unit/stable-candidate-fault-isolation.test.ts`, `tests/unit/root-authority-red-team.test.ts` | test |
| `verifyRuntimeSeparation` | `electron/stable-candidate/workspace-manager.ts:117` | **the single enforcement point** |
| | `tests/unit/stable-candidate.test.ts:109,112` | test |

**The enforcement point is unique.** `verifyRuntimeSeparation` is called in exactly one production location —
`workspace-manager.ts:117`, inside `createCandidateWorkspace`. Both the instrument and production reach it
through the same function. So the question reduces to: **what paths does each caller pass?**

## 2. The instrument's geometry

```
live-promotion-acceptance.ts:58    const dataRoot     = appDataUnder(process.cwd());
live-promotion-acceptance.ts:186   const evolutionRoot = path.join(dataRoot, "evolution");
live-promotion-acceptance.ts:187   createCandidateWorkspace({ stableRoot: process.cwd(), evolutionRoot, ... })
```

With `appDataUnder(root) = <root>/runtime-data` (`runtime-paths.ts`):

```
stableRoot    = <checkout>
evolutionRoot = <checkout>/runtime-data/evolution
```

→ nested.

## 3. The production geometry — same shape

The coordinator does **not** compute a root of its own; it uses the root injected by the host:

```
self-evolution-coordinator.ts:337   createCandidateWorkspace({ stableRoot, evolutionRoot: this.options.evolutionRoot, ... })
self-evolution-coordinator.ts:313   const stableRoot = selfTarget.stableRoot ?? path.resolve(this.options.stableRoot);
```

That injected value comes from the host default, because the composition root deliberately omits the option:

```
bootstrap/engineering.ts:45-46   /** Explicit evolution roots. Omitted in production, where the host's own defaults apply. */
bootstrap/engineering.ts:61      ...(options.evolution ?? {})          ← main.ts passes no `evolution`
self-evolution-host.ts:153       const stableRoot    = path.resolve(options.stableRoot ?? detectRepositoryRoot(appPath) ?? appPath);
self-evolution-host.ts:154       const evolutionRoot = path.resolve(options.evolutionRoot ?? path.join(options.userData, "evolution"));
```

and `userData` is the app data root, which in development is **inside the checkout**:

```
main.ts:162                    app.setPath("userData", dataRoot)
runtime-paths.ts:100           const appData = override ?? appDataUnder(installRoot);   // <installRoot>/runtime-data
main.ts:869-871                createEngineeringModule({ appPath: app.getAppPath(), userData: app.getPath("userData"), ... })
```

`detectRepositoryRoot` walks up for `.git` (`self-evolution-host.ts:270-278`), so `stableRoot` resolves to the
checkout in both dev and packaged runs.

### Development geometry (the configuration boss actually runs in)

| Root | Value |
|---|---|
| `stableRoot` | `<checkout>` |
| `userData` | `<checkout>/runtime-data` |
| `evolutionRoot` | `<checkout>/runtime-data/evolution` |
| `candidateRoot` | `<checkout>/runtime-data/evolution/<runId>` |

→ **candidate root inside stable root.**

### Packaged geometry

`userData` is `%LOCALAPPDATA%\Codex-Boss`, which is **outside** the checkout, so the default happens to be
outside Stable. The geometry is therefore path-dependent, not structurally guaranteed.

## 4. Predicate result — measured, not inferred

Run against the compiled shipped predicate, `dist-electron/electron/stable-candidate/runtime-isolation.js`,
via a read-only probe (`probe-isolation-scope.cjs`, untracked scratch; no file patched, no mock introduced):

| # | Geometry | `separated` | `overlaps` | Verdict |
|---|---|---|---|---|
| 1 | **PRODUCTION dev** (`stable=<checkout>`, `evolution=<checkout>/runtime-data/evolution`) | `false` | `["<candidate root inside stable root>"]` | **REJECT** |
| 2 | **INSTRUMENT acceptance** (identical shape) | `false` | `["<candidate root inside stable root>"]` | **REJECT** |
| 3 | PRODUCTION packaged (`userData` outside checkout) | `true` | `[]` | ACCEPT |
| 4 | Proposed instrument v2 (external sibling) | `true` | `[]` | ACCEPT |
| 5 | CONTROL — historical failure, explicitly nested | `false` | `["<candidate root inside stable root>"]` | REJECT |

Rows 1 and 2 are identical in shape and produce the **same** refusal. Row 5 confirms the predicate still
detects the failure it was built for.

## 5. Classification

```
PRODUCTION_AND_INSTRUMENT
```

**Reason:** the nested-root geometry is **not** an artefact of the acceptance instrument. The production
self-evolution composition draws the same shape in development. `live-promotion-acceptance.ts` and
`self-evolution-coordinator.ts` feed the same predicate the same invalid geometry.

Corroborating evidence **already in the source**, written by the authors of that area — the host carries
comments recording that this exact geometry previously broke production:

```
self-evolution-host.ts:155-157
  // Root controls must be a sibling of the Candidate tree. Keeping governance
  // under evolutionRoot made the production composition root fail closed at
  // startup and caused every packaged smoke run to hang before renderer boot.

self-evolution-host.ts:174-176
  // Only the Stable tree is denied. `evolutionRoot` lives under userData, so
  // denying userData would refuse the coordinator's own Candidate grant.
  denyRoots: [stableRoot],
```

So a **previous, related instance of this defect class was already found and fixed in production** (by moving
`governanceRoot` out from under `evolutionRoot`). The `evolutionRoot`-under-Stable case was left in place,
with its own explanatory comment, and is the one now failing.

## 6. Scope of impact

| Path | Status |
|---|---|
| Production self-evolution in **development** (`app.isPackaged === false`) | **AFFECTED** — same invalid geometry; `createCandidateWorkspace` refuses |
| Production self-evolution in a **packaged** build | Not affected *by default*, because `userData` is outside the checkout. Path-dependent, not guaranteed. |
| Verification function `verifyRuntimeSeparation` | **CORRECT** — it behaved exactly as specified. It is not the defect. |
| Acceptance instrument `live-promotion-acceptance.ts` | **AFFECTED** — instantiates the same invalid layout |

**The invariant is not the defect.** `runtime-isolation.ts:180` correctly refused a Candidate inside Stable.
Per §21 of the round brief: *do not repair the safety invariant because the acceptance cannot satisfy it.*
Nothing in this determination weakens, excepts, or special-cases that predicate.

## 7. Required Owner decision

The brief states: *"If production self-evolution uses the same invalid geometry, STOP after documenting it.
Do NOT casually patch production and continue the experiment. Return
`PRODUCTION_RUNTIME_ISOLATION_DEFECT_DISCOVERED` for Owner review. Only continue automatically if
classification is `INSTRUMENT_ONLY`."*

The classification is **`PRODUCTION_AND_INSTRUMENT`**, so **this programme stops here** and does not proceed
to repairs #1/#2, tests, preflight or live Stage C.

```
RETURNED    PRODUCTION_RUNTIME_ISOLATION_DEFECT_DISCOVERED
```

### The decision the Owner faces

Patching `evolutionRoot` so it lands outside Stable is not a change to one instrument — it is a change to the
**production self-evolution composition's** root policy (`self-evolution-host.ts:154`, and/or the composition
root at `bootstrap/engineering.ts:61` / `main.ts:869`). It therefore leaves the authorised scope of this round
("PF020 LIVE ACCEPTANCE INSTRUMENT REPAIR" and explicitly *not* a production repair), and it touches a
component that is part of the subject under test.

Two candidate repairs exist and they are **not** equivalent:

| Option | Change | Why it may be wrong |
|---|---|---|
| **A — instrument-local** | Give only `live-promotion-acceptance.ts` an external evolution root (CLI flag or resolver). Production is left untouched and continues to fail closed in dev. | Makes the acceptance pass while the production path it is supposed to represent still cannot create a candidate in dev. That risks testing a configuration the product does not actually use — the inverse of the mistake §8 forbids. |
| **B — production fix** | Make the production default external too (e.g. a sibling of Stable rather than under `userData`). | Outside this round's authorised scope; changes a subject-under-test component; and needs its own justification, tests and disclosure because it alters Candidate/Stable root policy for real evolution runs. |

**Neither option is executed here.** Option A alone would let Stage C run, but it would do so by modelling a
geometry production does not use, which would weaken the experiment's external validity. Option B is a
production repair requiring separate authorisation. The Owner must choose, and the choice must be recorded as
its own decision entry before the instrument work resumes.
