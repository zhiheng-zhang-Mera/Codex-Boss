# Future opportunities — found, deliberately not built

Plan §18 forbids continuing ordinary product build-out during Phase 0 and requires
that anything discovered be recorded here instead of implemented. Nothing in this
file was built in this round.

The point of the list is that after Phase 0 the *ordinary* improvement budget
belongs to Boss's own autonomous evolution, not to the harness.

---

## 1. Root Defense follow-ups (adjacent to this round, still out of scope)

| # | Opportunity | Why it was not built now |
|---|---|---|
| FO-01 | **Wire `RootAuthority` into `main.ts` as a live IPC gate.** Today the boundary is a library with an outer integration point (`ProposalRunner` scope, promotion, rollback, emergency control); the Electron main process does not yet call `classify()` on every inbound autonomous request. | Wiring 80 KB of application bootstrap is exactly the kind of broad, risky refactor §2 and §18 exclude from a hardening round. The seam (`classify`, `enforce`) is in place and tested; connecting it is an ordinary engineering change Boss can make under the same boundary. |
| FO-02 | **Owner dashboard surface for the Root ledger and the fuse.** `RootAuditLedger.entries()`, `EmergencyControl.status()` and `PromotionController.record()` are all queryable; no UI renders them yet. | UI work is explicitly in the §18 forbidden list. |
| FO-03 | **Live GitHub reachability probe in the evolution path.** Today "GitHub is unreachable" is discovered when a promotion attempt fails and is reported as `BLOCKED_EXTERNAL`. A cheap pre-flight probe would park the run earlier. | Needs a real Boss identity to be meaningful; without one it would only add a failure mode. |
| FO-04 | **Signature over the Root ledger tail.** The ledger has a hash chain but no keyed signature, so tamper *detection* is local rather than cryptographic against an off-machine attacker. | A signing key is secret material, and §7.1 forbids keeping secrets next to the policy. It needs an Owner-side key-management decision. |
| FO-05 | **Candidate process isolation stronger than in-process supervision.** `CandidateSupervisor` currently supervises an in-process task; a crash inside the host process would still take the host down. A spawn-per-candidate model would close that. | The current model already satisfies §8.4 for the failure modes the plan lists, and spawn-per-candidate is a substantial architecture change that belongs in its own round. |
| FO-06 | **`WAITING_FOR_ROOT_OWNER` notification.** The state is durable but silent; the Owner learns about it by looking. | Notification is a product feature. |

## 2. Opportunities noticed in adjacent systems (not Root Defense)

| # | Opportunity | Area |
|---|---|---|
| FO-07 | `electron/engineering/gate-runner.ts` returns `UNAVAILABLE` for a gate with no tooling. That is honest, but a run whose only applicable gates are `UNAVAILABLE` can still converge; an explicit "no executable gate" verdict would be stricter. | Engineering loop |
| FO-08 | `electron/engineering/verification.ts` caps `maxRepairs` at 2. For a large bounded patch this is occasionally too few; making the cap a policy value would help. | Engineering loop |
| FO-09 | `engineeringChecksFor` falls back to `typecheck` + `diff` when a workspace has no tests, which means a test-less workspace can be verified without any executable test. | Engineering loop |
| FO-10 | `electron/commander/durable-json.ts` retries `rename` on Windows `EPERM`/`EACCES`/`EBUSY`; the same retry discipline is not applied to the ledger's `open`. | Durability |
| FO-11 | The repository's full test suite takes minutes; a per-file timing baseline would let a regression in suite duration be detected as a signal rather than noticed anecdotally. | Developer experience |
| FO-12 | `tests/helpers/root-fixtures.ts` currently serves only the Root Defense batteries; generalising it into a shared fixture library would reduce duplication in the existing git-heavy tests. | Test infrastructure |

---

## 3. Explicit non-goals for this round (from §18)

For the avoidance of doubt, none of the following was started: knowledge-base
content expansion, new providers, UI overhaul, novel/narrative capability, paper
length enhancement, new research features, quant functionality, generic
self-learning, provider morality scoring, new fleet topology, mobile port, new
proxy features, new login features, general performance work, and any refactor
unrelated to Root Defense.
