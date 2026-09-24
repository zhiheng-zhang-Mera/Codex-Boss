# BOSS CITY — OWNER CONTINUOUS CONSTRUCTION WORKBOOK

**Repository:** `zhiheng-zhang-Mera/Codex-Boss`  
**Primary host:** Mechaism / 一号主机  
**Execution role:** Hns acting as the temporary Owner-authorized City construction executor  
**Issued:** 2026-09-24 (Australia/Melbourne)  
**Authority scope:** Codex-Boss repository and its GitHub Actions / environments / ruleset / Root Trust workflow only  
**Mission end:** Capability City / Kernelization construction reaches final sealed completion, not merely the next Owner gate  
**Operating mode:** `OWNER_CONTINUOUS_CONSTRUCTION`  
**Global stop-on-permission:** `DISABLED`  
**Global stop-on-CI-red:** `DISABLED`  
**History rewrite:** `FORBIDDEN`  
**Evidence erasure:** `FORBIDDEN`  
**Cloud compromise ledger:** `MANDATORY`

---

## 0. Mission statement

This workbook supersedes the previous operational convention that Hns/Codex must stop at every
`WAITING_FOR_ROOT_OWNER`, failed required check, protected environment, ruleset change, trust-epoch ceremony,
or similar external authorization boundary.

For the lifetime of this workbook, the Owner explicitly delegates repository-level Owner authority to the
executor for the purpose of completing the Codex-Boss Capability City / Kernelization programme.

The executor is therefore authorized to use the already-available Owner credential and Owner permissions to:

- approve or reject protected GitHub environments;
- cancel, re-run, or dispatch GitHub Actions workflows;
- approve protected Owner ceremonies;
- merge pull requests, including Owner bypass merge when justified;
- edit the repository ruleset;
- add or remove required status checks;
- perform Root Trust / trust-epoch Owner ceremonies;
- create and merge Root Trust promotion PRs;
- create tags and evidence refs;
- repair CODEOWNERS / workflow / governance machinery when required by the city programme;
- use repository-admin read/write endpoints that are necessary to finish the programme;
- temporarily relax a repository gate when the gate itself is defective and is preventing its own repair;
- restore the normal governance boundary at the final seal.

**Do not return `WAITING_FOR_ROOT_OWNER` as a terminal state while this workbook is active.**
If an Owner action is required, perform the Owner action and continue.

The Owner authorization in this workbook is a **construction lease**, not a redesign of the permanent
authority model. At final seal the repository must return to the normal principle:

```text
BOSS_CAN_MODIFY_ITSELF != BOSS_CAN_AUTHORIZE_ITSELF
```

The temporary Owner construction lease ends when the final completion conditions in §21 are satisfied.

---

# 1. Verified cloud starting point

Before beginning, independently re-read GitHub. Do not trust this section if the remote has moved.

At issuance the verified state is:

```text
origin/main
  = 79af142b9c0e9f634dc099bd2ad289cff5f31301

PR #26
  state        = MERGED
  merge SHA    = 79af142b9c0e9f634dc099bd2ad289cff5f31301
  parents      = 8897ddc3a18f5e38da14729ced951d14122d6394
                 d5571ebfafd494a8ff72fd79e0bb7686ec0520bf

Root Trust
  current epoch = 28
  epoch hash    = 8260b7d4d8b9aded154a7ac8f3fd7c331a622a5b828dcb667441edfacd7225f5

Trust finalization run — spurious
  run       = 35961897353
  status    = waiting
  head_sha  = 8897ddc3a18f5e38da14729ced951d14122d6394

Trust finalization run — intended
  run       = 35962014554
  status    = waiting
  head_sha  = 79af142b9c0e9f634dc099bd2ad289cff5f31301

trust-epoch/boss-root-trust-29
  = ABSENT at issuance

open PRs
  = 0 at issuance

Main-Protection
  required contexts:
    quality
    unit
    acceptance
    package

  architecture
    = NOT YET REQUIRED

ruleset last observed update
  = 2026-09-19T18:08:25.639+10:00
```

The current `trust-epoch-finalization.yml` uses:

```yaml
actions/checkout@v4
with:
  ref: main
```

rather than an immutable dispatch SHA. Therefore a waiting workflow can have:

```text
github run head_sha != tree actually checked out after approval
```

This is a provenance / TOCTOU defect and must be repaired during this workbook.

---

# 2. Definition of “do not stop”

“Do not stop” does **not** mean “pretend failure is success”.

It means:

```text
BLOCKED LANE != BLOCKED PROGRAMME
RED CHECK    != STOP ALL WORK
OWNER GATE   != ASK OWNER AND WAIT
UNKNOWN      != INVENT PASS
```

Whenever a lane becomes blocked:

1. classify the blocker;
2. preserve the evidence;
3. use Owner authority if the blocker is authorization;
4. repair or bypass if the blocker is defective governance;
5. open a parallel worktree / branch for independent work;
6. leave an explicit debt record if the problem cannot be closed immediately;
7. return to the debt before final seal.

There is no permission-induced global pause and no CI-induced global pause.

A single lane may be quarantined if executing the next mutation would destroy evidence, leak credentials, or
rewrite history. While that lane is quarantined, continue all independent city work.

---

# 3. Non-negotiable invariants

Owner authority is broad, but the following are **not authorized**:

```text
NO force-push to main
NO rebase of already-published city history
NO amend of already-published city commits
NO squash that destroys required research / defect history
NO moving an existing evidence tag
NO deleting or editing historical evidence to make the programme appear cleaner
NO hiding failed Actions runs
NO converting an unexplained red into a claimed PASS
NO weakening a threshold merely to make CI green
NO silent baseline widening
NO silent grandfathering of new architecture debt
NO storing an Owner PAT/token/key in the repository
NO printing raw Owner credentials into logs, artifacts, issues or PR text
NO leaving a permanent Owner credential inside autonomous Boss runtime
NO fabricating the 30-merge legacy-retirement window
```

Normal history-preserving merge commits are preferred throughout the city programme.

If a bypass merge is used, use a merge commit unless GitHub makes that impossible.

---

# 4. Cloud audit system — create this before further construction

Create the following cloud records on a dedicated branch and land them early:

```text
docs/city/
  OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md
  OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md
  CITY_RENOVATION_DEBT_REGISTER.md
  incidents/
    2026-09-24-spurious-trust-epoch-dispatch.md
```

The workbook committed to GitHub must contain the effective instructions actually used. This local workbook
is the source for that first version.

## 4.1 `OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md`

Append-only.

Every Owner-level intervention, compromise, bypass, workaround, semantic reinterpretation, temporary bridge,
CI exception, retry, rollback, or governance repair must add an entry.

Each entry must contain:

```text
ENTRY_ID
timestamp_utc
executor
authority_level
main_before
main_after
branch
PR
workflow_run_ids
checks_observed
problem
classification
normal_path
why_normal_path_was_not_used
action_taken
files_or_rules_changed
known_risk
evidence_preserved
rollback
temporary_debt_created
debt_id
exit_condition
closure_status
research_value
```

Never rewrite an earlier entry. Correction is a new entry pointing back to the old entry.

## 4.2 `CITY_RENOVATION_DEBT_REGISTER.md`

Every compromise that remains live after its originating commit must have a debt ID:

```text
CITY-DEBT-###
```

Required fields:

```text
introduced_at
introduced_by
reason
affected_surface
exact compromise
why construction continued
risk
containment
owner
exit condition
latest review
status = OPEN | CONTAINED | CLOSED | ACCEPTED_PERMANENT
closure evidence
```

An entry may become `ACCEPTED_PERMANENT` only if a final architectural decision explicitly says why it is not
temporary debt.

## 4.3 Incident record

The spurious run `35961897353` is currently not represented by an incident file on `main`.

Create:

```text
docs/city/incidents/2026-09-24-spurious-trust-epoch-dispatch.md
```

Record facts only:

- helper intended as dry-run performed a real dispatch;
- run id;
- run head SHA;
- intended run id;
- intended run head SHA;
- no attempt to conceal the run;
- helper subsequently requires explicit confirmation;
- impact on correctness;
- impact on provenance;
- cancellation result;
- follow-up hardening.

Do not delete the Actions run from the history.

## 4.4 Paper evidence

When a construction defect, counterfactual, correction, bypass, or failure has research value, append a concise
fact-only entry to:

```text
docs/research/PAPER_EVIDENCE_LEDGER.md
```

Do not turn every operational log into paper evidence. Use the paper ledger for findings that illustrate a
general mechanism or lesson.

---

# 5. CI red policy — RED MAY CREATE DEBT, RED MAY NOT CREATE A STOP

Classify every red into exactly one of the following.

## R0 — expected experimental red

Examples:

- deliberate S2 negative control;
- a known stale epoch anchor before the authorized epoch ceremony;
- a test deliberately injected to prove fail-closed behavior.

Policy:

```text
record
prove it is the expected red
do not repair the experiment into green
continue immediately
```

The red itself may be the evidence of success.

## R1 — known unrelated / flaky red

Examples:

- hosted timing flake already disproved on same tree by rerun or independent host;
- failure in a non-city lane with no semantic relation to the city change.

Policy:

```text
capture run + exact failing test
perform bounded rerun / independent check
if classification is supported:
    Owner bypass is allowed
    create ledger entry
    create debt only if underlying flake remains unresolved
continue
```

## R2 — city defect with understood repair

Policy:

```text
repair on same branch or follow-up branch
do not globally pause
continue independent work in parallel
merge only when the repair path is understood
```

If merging the red state is necessary to unblock a protected transition, Owner bypass is permitted, but the
broken state must receive a debt ID and must not survive final seal.

## R3 — governance/gate defect

Examples:

- required context not emitted;
- workflow prevents the test needed to validate itself;
- baseline integrity logic conflates frozen-artifact integrity with candidate-tree identity;
- protected workflow checks floating `main` rather than the dispatch SHA.

Policy:

```text
treat the gate as the defect
preserve the defect
repair the gate
use Owner bypass / temporary ruleset relaxation if the defective gate blocks its own repair
record exact before/after semantics
restore protection after repair
continue
```

## R4 — unexplained red

An unexplained red is never renamed “flaky”.

Policy:

```text
quarantine the affected lane
open an investigation branch/worktree
continue independent city construction
do not certify the affected phase
```

Owner bypass may be used to keep the programme moving only if:

- the failure is preserved;
- the affected guarantee is explicitly marked unproven;
- a debt entry is opened;
- the final seal cannot occur while that debt is unresolved or formally replaced by a stronger proof.

---

# 6. Permission / governance escalation ladder

Use the least invasive action that does not cause a programme pause.

```text
L0 normal machine/App path
L1 retry / repair / alternate non-Owner path
L2 Owner environment approval / review / workflow action
L3 Owner merge bypass
L4 temporary ruleset exception or required-check relaxation
L5 Owner direct governance write / direct protected-file repair
L6 emergency direct-main write
```

`L6` is allowed only if all PR-based paths are themselves broken.

If L6 is ever used:

- make one minimal history-preserving commit;
- never force-push;
- include the audit record in the same commit if technically possible;
- otherwise make the audit follow-up immediately;
- open a reconstruction PR or comparison record showing exactly what would have been reviewed;
- restore the normal PR path before continuing ordinary construction.

Use of L4-L6 is automatically a ledger entry.

---

# 7. Owner credential handling

The executor may use the already-configured Owner credential.

It must not:

- read the raw token merely to prove it exists;
- print the token;
- copy it into a repo file;
- add it to `.env`;
- persist it in runtime-data intended for Boss;
- place it into GitHub Actions secrets as a workaround;
- make the autonomous Boss identity inherit it.

Use GitHub's existing authenticated client / credential manager / secure local store.

The authorization is to **perform actions**, not to duplicate or expose the credential.

---

# 8. Stage A — take control of the current epoch-29 boundary

Do this first.

## A1. Re-read remote state

Verify:

```text
origin/main
PR #26
run 35961897353
run 35962014554
open PRs
ruleset
current trust epoch
epoch-29 branch
```

If the remote has moved, record the delta before continuing.

## A2. Cancel the spurious run

Cancel:

```text
35961897353
```

Expected terminal status:

```text
cancelled
```

Record the cancellation in the incident and continuous-construction ledger.

Do **not** approve that run.

## A3. Approve the intended epoch-29 run

Approve protected environment:

```text
boss-root-trust-owner
```

for:

```text
run 35962014554
head_sha = 79af142b9c0e9f634dc099bd2ad289cff5f31301
```

Do not wait for an external Owner response; this workbook is the Owner authorization.

## A4. Finish epoch 29

After the workflow finishes, verify:

```text
--advance produced only trust-policy/trust-epoch.json
--check = MATCHES
candidate epoch = 29
root surface = the post-PR#26 surface
parent epoch hash = epoch 28 hash
epoch branch exists
handoff is valid
workflow conclusion is success
```

If the machine identity can create the promotion PR, prefer it.

If the App path fails only because of transport/permission, use Owner authority to create the same PR and log
the substitution.

Do not stop.

## A5. Promotion

Require the best available five-job proof.

If all jobs green:

```text
merge normally
```

If the only red is a classified known/expected governance artifact:

```text
Owner bypass merge
record it
continue
```

After merge:

```text
main carries epoch 29
acceptance-evolution-bless.cjs --check = MATCHES
Root Trust is no longer stale
```

---

# 9. Stage B — close the trust-finalization provenance defect

The current finalization workflow is vulnerable to a waiting-run / floating-main mismatch because it checks
out `main`.

Repair it.

## B1. Required semantic change

A finalization run must authorize the exact commit it was dispatched on.

Preferred implementation:

```yaml
actions/checkout@v4
with:
  ref: ${{ github.sha }}
  fetch-depth: 0
```

Then assert:

```text
git rev-parse HEAD == github.sha
github.ref == refs/heads/main
```

The proposal/handoff must record both:

```text
dispatch_sha
checked_out_sha
```

and they must be identical.

Do not make approval of a waiting run silently pick up a newer `main`.

## B2. Dispatch helper hardening

The helper that caused `35961897353` must:

```text
perform no write without an explicit --confirm
have a true read-only / dry-run path
print the exact write it would perform before confirmation
have tests that prove dry-run cannot dispatch
```

## B3. Test the TOCTOU counterfactual

Create a safe test fixture or mocked workflow test demonstrating:

```text
dispatch at SHA A
main later becomes SHA B
approval occurs
finalization remains on A
```

The test must fail against the old semantic shape and pass against the repair.

## B4. Root Trust handling

If the workflow repair moves the Root Trust Surface:

```text
measure
propose next epoch
use Owner authority
finalize
promote
merge
verify
continue
```

Do not stop at the next epoch ceremony.

The number may become epoch 30. Never hard-code the number; derive it from live state.

---

# 10. Stage C — Phase E hosted negative control

The negative control is not a “bad PR accidentally failing”. It is an experiment.

Create a dedicated branch from exact current `main`.

Inject one known undeclared cross-capability edge that the engine must reject.

Requirements:

```text
baseline artifact integrity        PASS
baseline series authorization      PASS
shadow                             PASS process / reports violation
enforce                            FAIL process / same finding identity
engine_errors                      0
legacy ratchet behavior            recorded
hosted architecture job            reaches enforce
failure reason                     exactly the injected violation
```

Use an isolated temporary/evidence branch.

Do not merge the injected debt into main.

Preserve the exact experimental commit with an immutable evidence ref, preferably an annotated tag such as:

```text
city-evidence-s2-negative-control-v1
```

If that tag name already exists, never move it; derive the next version.

Close the experiment PR after evidence capture.

Append the finding to the paper evidence ledger.

---

# 11. Stage D — certify S2 exit

Re-audit S2 from real GitHub hosted history.

The prior closing report measured:

```text
30 consecutive valid runs
0 excluded
0 unexplained
same findings hash throughout
```

Do not simply inherit that statement. Recompute against the actual post-epoch state.

The S2 exit record must contain:

```text
window definition
first run id
last run id
commit SHAs
shadow finding identity/hash
enforce finding identity/hash
engine error counts
all excluded runs and why
all retries
all flakes
negative-control PR
negative-control run id
negative-control exact violation
local/hosted parity evidence
```

If there are more than the required 10 valid runs, record the real count.

If an unexpected run appears, classify it under §5 rather than restarting the whole programme blindly.

S2 is exited only after the negative control is proven.

---

# 12. Stage E — S3 ruleset activation

S3 is a governance act.

Use Owner authority directly.

Modify `Main-Protection` so that required status checks become:

```text
quality
unit
acceptance
package
architecture
```

Pin `architecture` to the correct GitHub Actions integration id, matching the existing hosted job.

Keep:

```text
strict_required_status_checks_policy = true
```

Do not remove the four existing checks.

Do not change unrelated rules in the same act unless a live defect makes it necessary. If unrelated changes are
necessary, record them separately in the ledger.

After the ruleset write, verify from GitHub:

```text
architecture is required
architecture is emitted by the workflow
integration id matches
strict mode remains enabled
CODEOWNERS/review rules still exist
Owner bypass actor did not accidentally expand
```

Then create or use a benign PR to prove a normal green `architecture` check satisfies the required context.

Record S3 activation as a distinct cloud event.

---

# 13. Stage F — S4 decision: do not fabricate 30 promotion merges

The Phase 1B specification permits either:

- retire the legacy ratchet after H5 evidence, or
- keep it and record the decision.

H5 requires at least 30 **real promotion merges** after `architecture` is required.

Do not create meaningless PRs merely to satisfy this number.

For this city completion programme, the default decision is therefore:

```text
RETAIN_LEGACY_RATCHET
```

until the organic H5 window is earned.

Record:

```text
legacy ratchet retained deliberately
reason = H5 organic evidence window not yet earned
this does not block city completion
future retirement remains a separate Owner act
```

This is not debt and must not be represented as a failure. It is an explicit S4 Owner decision permitted by
the specification.

---

# 14. Stage G — create Phase 2 architecture-migration specification, then immediately execute it

Phase 1B explicitly says Phase 2 is the architecture debt-reduction / migration / structural-repair phase.

There is no completed Phase 2 work order in the current tree.

Do not stop to request one.

Create:

```text
docs/city/PHASE2_ARCHITECTURE_MIGRATION_SPEC.md
docs/city/PHASE2_ARCHITECTURE_MIGRATION_ACCEPTANCE.md
```

The spec must be based on a fresh measurement of current `main`, not on the pre-city historical counts alone.

Freeze the Phase 2 starting measurement before making structural migrations.

The Phase 2 spec must map directly to Capability City Principles 15.1–15.9.

---

# 15. Phase 2 work package P2-A — truthful capability map and minimum stable closure

Re-measure all capability manifests and the real source graph.

Repair stale or false capability metadata, including any still-existing examples such as:

```text
manifest path does not exist
declared state=[] while durable state exists
module ownership differs from real tree
declared dependency graph omits real cross-capability relations
```

Build machine validation for:

```text
declared module exists
declared state ownership matches reality
every source module has an owner or explicit infrastructure classification
every cross-capability relation resolves to known endpoints
capability boundary has one declared external purpose
```

Do **not** split by file count.

The unit of migration is minimum stable semantic closure.

A large coherent compound building is allowed.

A bundle containing independent purposes must be split.

Acceptance:

```text
no stale manifest paths
no known unowned city source files
no silent capability state ownership mismatch
closure validator runs in CI
```

---

# 16. P2-B — foundation must not depend on a building

Re-measure all foundation/kernel → capability implementation dependencies.

Known historical example:

```text
electron/bootstrap/persistence.ts
  -> tenx/runtime-intelligence live-capture
```

Do not assume it still exists.

For every live inversion:

1. identify the invariant;
2. move the required abstraction to land/foundation/road if it is truly shared infrastructure;
3. otherwise invert control so the building depends on the platform contract;
4. preserve behavior with tests;
5. remove the load-bearing building dependency.

Acceptance:

```text
foundation -> building implementation edges = 0
```

Add a machine check so this cannot silently regress.

---

# 17. P2-C — cycles and uncontrolled lateral bearing dependencies

Freshly compute capability-level SCCs and cycles.

Historical baseline contained:

```text
43 capability-level 2-cycles
1 SCC containing 25 of 27 capabilities
```

Those are historical values, not current truth.

Migrate incrementally.

Preferred tactics:

```text
extract road/interface
invert dependency
event bus
explicit contract
split bundle
move shared service to shared infrastructure
temporary bridge with declared expiry
```

For every temporary bridge:

```text
bridge id
owner
reason
source
target
exit condition
deadline/phase
tests
```

A bridge without an exit condition is not allowed.

Acceptance target:

```text
capability dependency cycles = 0
uncontrolled load-bearing lateral dependencies = 0
all allowed cross-capability dependencies are declared and policy-valid
```

Do not reduce the numbers by hiding files from the scanner.

---

# 18. P2-D — private-state access and multiple writers

Freshly measure all cross-domain private-state reads/writes.

Historical examples include:

```text
host-status parsing persistence state.json
tenx opening learning episode store by hard-coded path
knowledge-base.json written by two capabilities
```

Repair the live instances by introducing explicit owner APIs, event streams, read models, or shared road
capabilities.

Rules:

```text
one durable state object has one authoritative owner
cross-capability private path access = forbidden
consumers use a contract, event, query API, or declared read model
```

Acceptance:

```text
cross-domain private-state accesses = 0
uncontrolled multi-writer durable stores = 0
```

Machine-enforce both.

---

# 19. P2-E — shared capability sink / roads

Identify shared concerns currently trapped inside buildings.

A capability needed by several independent buildings is a road candidate.

Do not blindly move code into Core.

For every extraction, prove:

```text
why it is shared infrastructure
why it is not business capability
which consumers use it
what invariant it owns
what its minimal contract is
```

Historical candidates mentioned in the city principles include learning episode/metric surfaces and theme /
knowledge namespace ownership. Re-measure before acting.

Acceptance:

```text
no building is load-bearing solely because it accidentally owns a shared road
road ownership is explicit
new road does not expand Core without separate justification
```

---

# 20. P2-F — flatness states and migration lifecycle

Every capability/plot must have one machine-readable state:

```text
FLAT
TEMPORARILY_BRIDGED
PARTIALLY_DEGRADED
MIGRATION_IN_PROGRESS
UNSAFE_GAP
```

Create or extend a canonical city state registry.

Machine requirements:

```text
exactly one state per plot
bridge requires owner + exit condition
degraded state requires declared missing element
migration state requires source/target/exit
unsafe gap blocks that plot's promotion
```

The programme as a whole may continue while one plot is under declared migration, but final seal may not
contain:

```text
UNSAFE_GAP
MIGRATION_IN_PROGRESS
undeclared PARTIALLY_DEGRADED
expired TEMPORARILY_BRIDGED
```

A deliberate permanent degradation must be renamed into an explicit supported architecture state, not left as
temporary debt forever.

---

# 21. P2-G — capability replacement lifecycle

The city principles require:

```text
old active
 -> new shadow
 -> dual validation
 -> traffic switch
 -> old fallback
 -> drain
 -> retire
```

Do not attempt to replace every capability merely to exercise this.

Instead build a reusable replacement-governance mechanism and prove it on at least one real, bounded capability
migration.

Required machinery:

```text
authoritative-side declaration
shadow execution mode
dual-output comparison
traffic switch
rollback to old side
drain state
retirement evidence
```

Use real traffic or real host replay where the principle requires it; synthetic-only proof is insufficient.

Acceptance:

```text
replacement state is observable
rollback is executable
one real migration demonstrates the lifecycle
tests pin the lifecycle semantics
future capabilities can adopt it without inventing a new protocol
```

---

# 22. P2-H — Core growth ban

Measure the city-phase starting Core/foundation surface using a stable classification.

Create a machine-enforced budget.

During migration:

```text
new business capability does not enlarge Core
shared road != automatic Core
trust-domain changes remain separately authorized
```

If Core must grow, require a separate architecture record answering:

1. why an existing road/foundation element cannot carry it;
2. why it is not a building;
3. what invariant only Core can hold;
4. what breaks if it remains outside Core.

Final acceptance:

```text
Core size <= Phase 2 starting Core size
```

unless every increase has a separate Owner-approved architecture exception.

An exception does not silently redefine the baseline.

---

# 23. P2-I — make principles 15.1–15.9 machine-enforced

At the beginning of the original city programme, most principles were documentary.

City construction is not finished merely because the code “looks cleaner”.

Before final seal, produce an enforcement matrix for 15.1–15.9.

Target:

```text
15.1 foundation must not depend on building           MACHINE ENFORCED
15.2 size is not itself a defect signal               MACHINE SEMANTICS PINNED
15.3 minimum stable closure                           MACHINE CHECKED where decidable + explicit review record
15.4 replacement lifecycle                            MACHINE-STATEFUL + real proof
15.5 least-sufficient repair/shared sink              MACHINE CHECK on prohibited added lateral load
15.6 flatness states                                  MACHINE ENFORCED
15.7 no cycles/lateral bearing/private state access   MACHINE ENFORCED
15.8 shared capability sink                           MACHINE CHECK / explicit road classification
15.9 Core growth ban                                  MACHINE ENFORCED
```

For a principle that cannot be fully automated without pretending to solve a semantic judgment problem,
implement:

```text
machine-enforced evidence requirement
+
explicit structured architecture decision
```

Do not fake semantic certainty.

---

# 24. Baseline evolution during Phase 2

The enforcement baseline may evolve only through the already-governed acceptance mechanism.

A baseline change must distinguish:

```text
retired debt
new legitimate declared relation
new grandfathered debt
```

The last category is exceptional.

Do not silently add a new violation to the baseline just to make CI green.

If new grandfathered debt is unavoidable:

- Owner authorize it;
- enumerate the identity;
- explain why;
- assign a debt ID;
- state the exit condition;
- record it in the baseline series and construction ledger.

Count compensation is not acceptable.

Removing one old edge does not license adding another undeclared one.

Reintroducing retired debt must remain a failure.

---

# 25. Continuous construction branch strategy

Use multiple worktrees/branches when it prevents idle time.

Recommended lanes:

```text
lane/governance
lane/phase2-measurement
lane/phase2-closure
lane/phase2-topology
lane/phase2-state
lane/phase2-replacement
lane/evidence
```

Do not allow two lanes to mutate the same protected authority file concurrently.

Before merging a lane:

```text
sync from current main using a history-preserving merge
re-run the lane's proof
record conflicts
do not rebase published evidence branches
```

A blocked governance lane must not stop measurement or independent structural lanes.

---

# 26. Commit / PR rules

Prefer small semantic commits.

Every substantial migration PR must state:

```text
what city principle it addresses
measured before state
measured after state
what debt was retired
what new relation was introduced
tests
rollback
ledger/debt IDs
```

For bypass merges, additionally state:

```text
BYPASS_USED = YES
BYPASS_LEVEL = L3/L4/L5/L6
BLOCKING_CHECKS
EXPECTED_RED
UNEXPECTED_RED
WHY_MERGE_IS_SAFE_ENOUGH_TO_CONTINUE
DEBT_CREATED
FOLLOWUP
```

Preserve the original failing run.

---

# 27. Temporary ruleset changes

If a ruleset rule prevents repair of the rule itself, the executor may temporarily relax it.

Procedure:

```text
snapshot exact ruleset JSON
record hash / relevant fields
apply minimal relaxation
perform repair
restore protection
compare restored ruleset to intended final policy
record both mutations
```

Never “temporarily” remove a rule and forget it.

A live temporary relaxation receives a debt ID until restored.

Final seal requires zero unaccounted temporary relaxations.

---

# 28. Trust epochs under continuous Owner construction

A Root Trust movement is no longer a stop boundary.

Whenever a Root Trust change occurs:

```text
measure live surface
generate proposal
Owner-authorize finalization
advance exactly one epoch
verify --check MATCHES
create promotion branch/PR
prove checks
merge or justified bypass
verify main
continue
```

Do not batch unrelated Root Trust changes merely to reduce epoch count.

Do not write a future epoch number by hand.

Do not skip the evidence chain because Owner authority is available.

Owner authority removes waiting; it does not remove provenance.

---

# 29. Research preservation

The city programme has already produced valuable defect material.

Preserve:

- baseline integrity/identity conflation defect;
- PRE-08 stage-progression discrepancy;
- hosted runner flaky-check examples;
- epoch-finalization transport history;
- spurious dispatch incident;
- floating-main finalization defect;
- negative-control evidence;
- any future case where the gate catches its own design error;
- any compromise/bypass later removed.

Do not “clean up” those historical commits out of existence.

A clean final architecture and a messy but honest historical trail are compatible.

---

# 30. Final-city acceptance suite

Before declaring the city complete, run the full normal repository suite plus city-specific qualification.

At minimum verify:

```text
pnpm install --frozen-lockfile
build
typecheck
lint / quality
unit
acceptance
package where applicable

architecture observe
architecture baseline integrity
architecture baseline series authorization
architecture shadow
architecture enforce
architecture hosted parity
architecture legacy ratchet
test catalogue
Root Trust --check

capability ownership/manifest validator
foundation inversion validator
cycle/SCC validator
private-state-access validator
durable-writer validator
flatness registry validator
bridge expiry validator
Core budget validator
replacement-lifecycle tests
```

Hosted CI must emit and pass:

```text
quality
unit
acceptance
package
architecture
```

on the final main SHA.

No final result may depend solely on a local run.

---

# 31. Final debt review

Enumerate every `CITY-DEBT-*`.

Final state may contain only:

```text
CLOSED
ACCEPTED_PERMANENT
```

No `OPEN` debt.

No `CONTAINED` temporary debt.

Every `ACCEPTED_PERMANENT` item must point to a real architecture decision, not “ran out of time”.

Retained legacy ratchet is an explicit S4 governance decision, not renovation debt.

---

# 32. Final governance restoration

Before finishing, end the temporary Owner construction lease.

Verify:

```text
Owner credential is not present in repo
Owner credential is not in runtime-data
Owner credential is not in Actions secrets added by this work
autonomous machine identity remains separate
normal CODEOWNERS boundary is active
boss-root-trust-owner environment is protected
ruleset is active
architecture is required
strict required checks are active
no temporary bypass actor was added
no temporary ruleset relaxation remains
Root Trust --check = MATCHES
```

Do not remove the Owner's normal GitHub always-bypass capability if it is part of the intended repository
governance. The goal is to remove the **delegated construction use**, not to cripple the Owner account.

Add a final ledger entry:

```text
OWNER_CONTINUOUS_CONSTRUCTION = CLOSED
```

---

# 33. City completion definition

Do not declare completion at epoch 29, S2 exit, S3 activation, or the first successful Phase 2 migration.

The programme is complete only when all of the following are true.

## Governance

```text
[ ] architecture hosted job exists
[ ] architecture is a required status check
[ ] strict required checks remain active
[ ] negative control has proved fail-closed behavior
[ ] local/hosted parity is proved
[ ] Root Trust anchors the final live surface
[ ] trust-finalization dispatch is immutable-SHA bound
[ ] spurious dispatch incident is recorded
[ ] legacy-ratchet S4 decision is recorded
```

## Structure

```text
[ ] capability ownership/manifest map is truthful
[ ] foundation -> building implementation edges = 0
[ ] capability dependency cycles = 0
[ ] uncontrolled lateral bearing dependencies = 0
[ ] cross-domain private-state access = 0
[ ] uncontrolled multi-writer durable stores = 0
[ ] shared roads are explicitly classified
[ ] every plot has a valid flatness state
[ ] no unsafe gap remains
[ ] no migration-in-progress remains
[ ] no expired temporary bridge remains
[ ] reusable replacement lifecycle exists and has one real proof
[ ] Core budget is enforced and final Core does not exceed the permitted budget
[ ] principles 15.1–15.9 have enforceable guards / evidence requirements
```

## Evidence / debt

```text
[ ] all compromises are in the cloud ledger
[ ] all live renovation debt is CLOSED or ACCEPTED_PERMANENT
[ ] paper-useful findings are in PAPER_EVIDENCE_LEDGER
[ ] no historical failure was erased
[ ] final acceptance record exists
```

## Final main

```text
[ ] one final main SHA is named
[ ] all five hosted checks green on that SHA
[ ] city-specific acceptance is green
[ ] Root Trust --check MATCHES on that SHA
[ ] working tree clean
[ ] no hidden local-only patch
```

Only then:

```text
FINAL_STATUS = CAPABILITY_CITY_CONSTRUCTION_COMPLETE
```

---

# 34. What must never be used as a fake completion shortcut

Do not declare completion by:

```text
lowering a threshold
excluding difficult source files from measurement
widening the baseline to swallow unexplained debt
marking unknown red as flaky
turning enforce into shadow
making architecture non-required again
removing a failing test without replacing its guarantee
moving a tag
rewriting the commit history
merging a temporary bridge with no exit condition
renaming MIGRATION_IN_PROGRESS to FLAT without measurement
creating dummy promotion merges to satisfy H5
keeping Owner construction authority active forever
```

---

# 35. Reporting cadence

Do not stop for confirmation after every stage.

Continue autonomously.

At natural checkpoints, update the cloud ledger and optionally emit progress reports, but a report is not an
authorization request.

Useful checkpoints:

```text
CHECKPOINT 1  epoch 29 closed
CHECKPOINT 2  trust-finalization provenance repaired
CHECKPOINT 3  negative control proven / S2 exited
CHECKPOINT 4  S3 activated
CHECKPOINT 5  Phase 2 frozen starting measurement
CHECKPOINT 6  topology/private-state repair substantially complete
CHECKPOINT 7  lifecycle/core/flatness enforcement complete
CHECKPOINT 8  final seal
```

If the operator asks “做到哪里了”, report current checkpoint without interrupting active construction.

---

# 36. Final closing report format

At completion, report:

```text
FINAL_STATUS = CAPABILITY_CITY_CONSTRUCTION_COMPLETE

START_MAIN_SHA =
FINAL_MAIN_SHA =

ROOT_TRUST_START_EPOCH =
ROOT_TRUST_FINAL_EPOCH =
ROOT_TRUST_FINAL_SURFACE =
ROOT_TRUST_CHECK =

S2_EXIT =
S3_ARCHITECTURE_REQUIRED =
S4_LEGACY_RATCHET_DECISION =

PHASE2_START_MEASUREMENT =
PHASE2_FINAL_MEASUREMENT =

FOUNDATION_TO_BUILDING_EDGES =
CAPABILITY_CYCLES =
UNCONTROLLED_LATERAL_EDGES =
PRIVATE_STATE_ACCESSES =
MULTI_WRITER_STORES =
UNSAFE_GAPS =
MIGRATIONS_IN_PROGRESS =
TEMP_BRIDGES =
CORE_BUDGET_RESULT =

REPLACEMENT_LIFECYCLE_PROOF =

CITY_DEBT_OPEN =
CITY_DEBT_CLOSED =
CITY_DEBT_ACCEPTED_PERMANENT =

OWNER_BYPASS_COUNT =
RULESET_TEMP_RELAXATION_COUNT =
DIRECT_MAIN_WRITE_COUNT =
FORCE_PUSH_USED = NO
HISTORY_REWRITTEN = NO

FINAL_REQUIRED_CHECKS =
FINAL_HOSTED_RUN_IDS =
FINAL_ROOT_TRUST_PROOF =

OWNER_CONTINUOUS_CONSTRUCTION = CLOSED
```

Then provide a compact list of:

- every Owner bypass used;
- every temporary compromise;
- every permanent design compromise;
- every incident;
- every future renovation note;
- all evidence/tag/PR/run references required to reconstruct the work.

---

# 37. Execution command

Begin immediately from live remote state.

Do not ask the Owner to manually perform GitHub actions that the delegated Owner credential can perform.

Do not stop at permission gates.

Do not stop the global programme because a CI lane is red.

Do not hide red.

Do not erase history.

Record compromises in the cloud.

Repair or contain debt.

Continue through Phase 1B, S3, Phase 2, final governance restoration, and final seal.

The mission ends only at:

```text
FINAL_STATUS = CAPABILITY_CITY_CONSTRUCTION_COMPLETE
```
