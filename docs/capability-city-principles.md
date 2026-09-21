# Capability City Principles

**Status:** FORMAL BUT NOT YET MACHINE-ENFORCED.
**Adopted:** Pre-City Baseline `pre-city-baseline-v1` (`integration/pre-city-baseline`).
**Applies to:** the Capability City / Kernelization phase that follows this baseline.

This document records principles the Owner has **already decided**. It is not a proposal and not a plan for
work to be done in the pre-city round. **Nothing in this document is implemented, and nothing here authorises
construction during the pre-city round.**

Where a principle is not yet enforced by a check in `config/`, `scripts/` or CI, it says so explicitly. The
absence of enforcement is the honest current state and is the gap the city phase closes.

The measured starting conditions these principles apply to live in `artifacts/pre-city/`:
`CAPABILITY_INVENTORY.md`, `DEPENDENCY_BASELINE.md`, `STRUCTURAL_HEALTH_BASELINE.md`, `CITY_CLASSIFICATION.md`.

---

## 15.1 Boss's Position — land, foundation, roads, pipes, municipal rules

**Boss is not a general-purpose AI, and it is not the subject of every business capability.**

Boss's final position is the platform layer:

```
land                 the substrate: durable state, the event journal
foundation           the load-bearing base everything is built on
roads                shared, opinion-free routes between plots
pipes / networks     providers, runtime resources, node registries
municipal rules      permissions, authority boundaries, capability contracts, zoning
```

Everything else — Engineering, Research, Runtime Intelligence, Self-\*, Co-Learning, Quant — is a
**building** or a **compound building** erected on that platform.

**Consequences that bind the city phase:**

* A building must not become load-bearing for the foundation. The foundation may not depend on a building.
  *(The measured current violation: kernel `persistence` imports bundle `tenx`'s Runtime Intelligence
  `live-capture` — `electron/bootstrap/persistence.ts:24`.)*
* "Done" for a capability means it is a good building on good ground — not that Boss accumulated another
  feature. **This round's achievement is a trustworthy, complete, frozen starting point, not a longer feature
  list.**
* New business function defaults to being a building. It does not enlarge the ground.

---

## 15.2 A Capability Is a Building — and buildings come in sizes

A capability may be:

```
1x1                       one purpose, one closure, its own state, tests, docs
1x2                       two tightly coupled concerns that share one invariant
2x2                       a small compound with a single external surface
large compound building   a legitimate multi-part capability
bundle                    a district: several capabilities shipped or governed together
```

**There is no requirement that everything be reduced to the smallest possible code unit.**

A large compound building is not a defect. A **bundle pretending to be a building** is. The distinction is
whether it has one coherent external purpose:

* `runtime-intelligence` is a **large compound building** — advisory core, evaluation, prospective window,
  live capture, node telemetry, one advisory report surface. Legitimate.
* `tenx` is a **bundle** — Commander, Fleet, coordination economics, resource/node models and (since this
  baseline) the whole Runtime Intelligence plane under one name. That is a district, not a building.

**Consequence:** the city phase classifies by *purpose and closure*, never by file count. A 40-file
capability with one purpose is healthier than a 6-file capability with three.

---

## 15.3 Minimum Stable Closure — the unit of division

The division granularity is:

> **the minimum stable semantic closure** — the smallest unit that can be moved, replaced or removed without
> breaking an invariant.

**Granularity must never be pursued at the cost of an invariant.** Splitting a capability below its stable
closure is a defect, not progress: it converts an internal invariant into a cross-plot contract, which is
strictly more expensive and more fragile.

**Practical test.** A unit is at its minimum stable closure when:

1. it owns the state it needs to keep its own invariant (or explicitly does not own state at all);
2. it can be tested without standing a second capability up;
3. its boundary can be stated in one sentence;
4. removing it does not require editing a third capability's invariant.

If (1) or (2) fails, the unit is **too small** — it has been split through an invariant. If (3) fails, it is
**too large** — it is a bundle.

**Honest current state:** this is **not machine-enforced**. `config/capabilities/*.yaml` declares modules and
state but does not validate closure. Two of its own entries are already inconsistent with reality
(`tenx` lists a path that does not exist; `learning` declares `state: []`/`modules: []` while owning durable
files). Enforcing closure is a city-phase deliverable.

---

## 15.4 Capability Replacement — the lifecycle that must exist

Every capability must be replaceable without a flag day. The required sequence:

```
old active
   -> new shadow          the new capability runs, observing, producing no committed effect
   -> dual validation     both run; outputs are compared against each other on real traffic
   -> traffic switch      the new one becomes authoritative
   -> old fallback        the old one stays runnable and reversible
   -> drain               the old one stops taking new work
   -> retire              the old one is removed, its evidence retained
```

**Requirements this implies:**

* An old capability must remain **runnable** after the switch. A replacement that deletes its predecessor at
  switch time has no fallback stage and therefore no safe rollback.
* Dual validation must compare on **real** traffic, not on a fixture. A shadow that only sees synthetic input
  has validated nothing.
* Every stage needs an observable declaration of which side is authoritative. An implicit "whichever is
  wired" is not a switch.

**Honest current state: this lifecycle does not exist anywhere in the tree.** The only real disable surfaces
are `adaptive-flags.ts` (5 flags, default OFF) and `EvolutionKillSwitch` (Owner-only latch). There is no
shadow/dual-validate/traffic-switch path for any capability. The city phase should treat replaceability as
**absent**, not partial.

---

## 15.5 Least-Sufficient Repair — do not over-build to fill a small hole

When a real 1×1 capability is missing:

```
first choice    exact-fit              a capability that does exactly the missing closure
second choice   smallest sufficient compatible closure
```

**Forbidden:** installing a manifestly oversized capability to fill a small gap.

Closely related, and equally binding:

> Do not lift a shared concern into the wrong building just because two buildings both need it.

If `A` and `B` both need a capability, it belongs in the **road**, not inside `A`:

```
forbidden   Research -> Quant -> Statistics
required    Research -> Statistics
            Quant    -> Statistics
```

*(Measured current violations of this shape: `research → engineering → learning`,
`engineering → learning`, `host-status → learning`, `tenx(runtime-intelligence) → learning`.)*

**Consequence:** the cheapest repair is not the one that adds fewest files — it is the one that adds fewest
**load-bearing relations**.

---

## 15.6 Flatness — the five states

Every plot must be in exactly one declared state:

```
FLAT                     nothing missing, nothing temporary
TEMPORARILY_BRIDGED      a shim/bridge exists, is understood, and is intended
PARTIALLY_DEGRADED       something is missing and work continues anyway
MIGRATION_IN_PROGRESS    a move was started and not finished
UNSAFE_GAP               something load-bearing is absent and nothing compensates
```

**Rules:**

* `TEMPORARILY_BRIDGED` must name its exit condition and its owner. A bridge with no exit condition is an
  undeclared foundation. *(The current one to watch: `src/shared/self-diagnosis.ts`, the legacy lineage that
  now shares a module specifier with the new `src/shared/self-diagnosis/` directory.)*
* `UNSAFE_GAP` blocks construction on that plot. It is not a status to be tolerated while other work
  proceeds. *(Current: capability authorization is inert in shipped wiring — `electron/main.ts:910`
  constructs `ExecutionGate()` with no authorizer, and the whole `electron/capability/**` layer has no
  production consumer.)*
* `PARTIALLY_DEGRADED` and `MIGRATION_IN_PROGRESS` must be **declared**, not discovered. An undeclared
  partial state is indistinguishable from a bug.
* Flatness is measured, not asserted. This baseline's measurements are the starting point.

---

## 15.7 Topology — what may and may not bear load

**Allowed:**

```
event bus                          opinion-free transport between plots
temporary migration bridge         a declared, owned, expiring connector
composite internal collaboration   capabilities inside one compound building coordinating freely
```

**Forbidden:**

```
uncontrolled lateral bearing dependency    a building bearing load for another building
dependency cycle                           A -> B -> A
cross-module private-state access          one plot reading another's private state
```

### The core rule

> **bridge may exist, but bridge must not become foundation.**

A bridge that becomes load-bearing is a foundation with none of a foundation's scrutiny: it was never zoned,
never contracted, and nobody owns its invariants.

### Measured starting point (all of these currently exist)

* **187** real file-level cross-capability import edges against **3** declared. The declared graph is a
  boot-contract graph, not the real one.
* **43** capability-level 2-cycles; **one SCC containing 25 of the 27 capabilities**.
* **7** measured cross-domain private-state accesses, including `host-status` raw-parsing `persistence`'s
  `state.json` by deliberate bypass (`host-observer-collector.ts:126-149`), and `tenx` opening `learning`'s
  episode store by hard-coded path.
* `knowledge-base.json` has **two writers from two different capabilities**.

**Note the measurement gap, because it changes how to read a green ratchet:** `scripts/architecture.cjs`'s
`collectImports` scans only the module lists declared in the 27 manifests (25 files of 594) and drops any
edge whose target is undeclared. `pnpm run architecture:ratchet` therefore reports `violations: []` while 43
kernel→feature implementation edges exist. **Fixing the measurement is the first act of the city phase** —
refactoring against a blind instrument cannot be verified.

---

## 15.8 Shared Capability Sink — shared things sink into the road

When two buildings both depend on a capability, that capability is **promoted to a road / infrastructure
capability**. It does not become owned by one of the buildings.

```
forbidden   Research -> Quant -> Statistics     (Statistics trapped inside Quant)
required    Research -> Statistics
            Quant    -> Statistics
```

**Test:** if removing building `A` would break building `B`, then `A` is holding a road, and the road must be
extracted from `A` before either building is zoned.

**Consequence for the current tree:** `knowledge` owns `theme`'s namespaces (`theme-registry`,
`theme-packages`) and `theme` has a declared required edge to `knowledge`. The namespaces sank into a
**building** rather than the ground. Similarly `learning`'s episode/metric surface is reached through two
different buildings (`engineering`, `host-status`) and one bundle (`tenx`) — three consumers means it is a
road wearing a building's name.

---

## 15.9 Core Growth Ban

> **Boss Core does not grow because a new business capability was added.**

Every new business capability is, by default, a capability — a building. It does not enlarge the foundation.

**If something must enter the Core, it requires a separate architecture justification**, not a PR that
happens to add it. "It needed to be there" is not a justification. The justification must answer:

1. Which existing road or foundation element could not have carried it?
2. Why is it not a building?
3. What invariant does it hold that no capability may hold?
4. What breaks if it stays outside the Core?

**Corollary:** the Core's size is a **budget**, not an outcome. A city phase that ends with a Core larger than
it started has failed, even if every individual change was justified locally.

**Adjacent rules that follow from this ban:**

* Trust domains (`promotion`, `security`, `identity`, Qualification, and the `engineering`/`status`
  acceptance surfaces) are **zoned land**. Nothing is built inside them by a capability migration. A change
  there is its own authorised act, with its own epoch/blessing discipline.
* The required-check declaration (`src/shared/promotion-checks.ts:35`) and the Root Trust Surface
  (`src/shared/autonomous-evolution-trust.ts` `ROOT_TRUST_SURFACE_PATHS`) are municipal law. A building
  cannot amend them, and a migration cannot silently widen them.
* Thresholds are policy, not implementation detail. **No migration may lower a qualification threshold to
  make construction easier.**

---

## Enforcement status — what is machine-checked today and what is not

Stated plainly so no reader mistakes an aspiration for a guard.

| Principle | Enforced today? | By what |
|---|---|---|
| 15.1 Foundation must not depend on a building | **No** | The ratchet intends this but is blind to 184 of 187 edges (15.7). |
| 15.2 Capability size is not a defect signal | **No** | Classification is documentary (`CITY_CLASSIFICATION.md`). |
| 15.3 Minimum stable closure | **No** | Manifests declare modules/state but do not validate closure; two entries are self-inconsistent. |
| 15.4 Replacement lifecycle | **No** | No shadow/dual-validate/switch/drain machinery exists. |
| 15.5 Least-sufficient repair / shared sink | **No** | No check on added lateral edges. |
| 15.6 Flatness states | **No** | `STRUCTURAL_HEALTH_BASELINE.md` measures; nothing enforces a state per plot. |
| 15.7 No cycles / no lateral bearing load / no private-state access | **Partially** | The declared-graph ratchet passes, but measures 3 edges. `no cycles` holds only for that graph. |
| 15.8 Shared capability sink | **No** | Not checked. |
| 15.9 Core growth ban | **No** | No Core-size budget exists. |
| Root Trust Surface integrity | **Yes** | `acceptance-evolution-bless.cjs --check`; trust epoch anchor in CI. |
| Required-check declaration matches the workflow | **Yes** | `tests/unit/promotion-gate.test.ts` (`src/shared/promotion-checks.ts:35` vs `.github/workflows/ci.yml`). |
| Test catalogue completeness | **Yes** | `pnpm run test:catalogue:check` (274 suites). |
| Trust epoch not stale after a surface change | **Yes** | CI's `acceptance:autonomous-evolution`. |

**The honest summary:** the trust boundary is genuinely machine-enforced. The **city's** structural principles
are almost entirely not. Making 15.1–15.9 enforceable — starting with an honest dependency measurement — is
the first substantive deliverable of the Capability City / Kernelization phase.

---

## What this document does not authorise

Explicitly, so the next phase cannot read this as a work order:

```
DO NOT BEGIN     Capability City / Kernelization construction from this document
DO NOT IMPLEMENT Co-Learning
DO NOT IMPLEMENT Judgment Growth
DO NOT BUILD     Decision Ledger v2
DO NOT BEGIN     a judgment model
DO NOT BEGIN     an Owner model
DO NOT CONNECT   Quant
DO NOT ADD       PhD-specific capability
```

**Bridge to the next phase:**

```
PRE_CITY_BASELINE
        |
        v
Capability City / Kernelization Refactor
```

Beyond that, do not continue expanding.
