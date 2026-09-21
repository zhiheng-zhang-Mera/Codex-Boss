# Threats to Validity — Capability City

Written **at program start**, on purpose. The brief requires this be recorded before results exist, because
threats enumerated after the fact tend to be the ones that happen to be convenient.

Each threat is stated as a threat to a specific claim, with the mitigation actually in force (or an honest
statement that none is).

---

## 1. Single codebase (external validity)

**Threat.** Every result comes from one repository, Codex-Boss. Its shape — Electron main process plus a
shared TypeScript core, 27 declared capabilities, one developer-agent workflow — may not generalize to other
systems. Conclusions of the form "machine-enforced topology rules reduce coupling" are supported, at best,
as an *existence proof and a method*, not as a general law.

**Mitigation.** None available within this program. Results must be reported with the codebase's
characteristics attached, and generalization must be labelled `DESIGN CLAIM` / `UNVERIFIED`.

## 2. Single main developer, and an agent-generated implementation

**Threat.** The architecture, the migration and the measurement instruments are authored by the same actor
(and substantially by an AI agent). Several classic confounds follow:

* instruments may be tuned to the author's expectations;
* "violations" may be classified by the same judgement that decided what a violation is;
* the migration may be performed more gently than an uninstall would be in practice.

**Mitigation (partial).** The Pre-City Baseline's own instrumented facts are frozen and content-addressed
before any change, so at least `BEFORE` is not revisable. Detector performance (RQ5) is scored against a
**seeded ground truth** rather than against the author's opinion of the output. Any tuning of a detector
against the seed set must be disclosed.

**Not mitigated.** Author/judge identity at the *human* level. This is an honest limitation.

## 3. Synthetic seeded faults, and agent-generated faults

**Threat.** Fault isolation (RQ1) and detector evaluation (RQ5) rely on **seeded** faults: a deliberately
introduced kernel→feature import, a deliberate cycle, a deliberately corrupted capability state. Seeded
faults are usually cleaner, more localized and more legible than real ones. A detector that finds every seeded
violation may still miss a subtle real one, and a system that survives every seeded removal may still fail
on a real uninstall.

**Mitigation.** Distinguish, everywhere, between a **seeded** violation and an **observed** one, and report
them separately. The Pre-City Baseline already contains a genuinely observed set to seed against honestly
(3 declared vs 187 measured edges; 43 kernel→feature edges; 43 capability-level 2-cycles; one SCC of 25/27
capabilities; 7 cross-domain state accesses) — these are real, not synthetic, and should anchor RQ3/RQ5.

**Not mitigated.** Seeded-removal gentleness. To be disclosed per experiment.

## 4. Windows-heavy environment

**Threat.** Development, CI and all measured runs are on Windows (`windows-latest` runners; a local Windows
host). Path handling, case-insensitivity, line endings and process semantics differ from Linux. Two known
instances already: a CRLF-vs-LF catalogue drift issue that required a fix (`08-production-qualification`),
and CRLF warnings on every text file this program writes. Measured timings are also
Windows-specific.

**Mitigation.** Record the platform with every measurement. Do not present a Windows-only timing or
path-behaviour result as platform-neutral. The performance measurements (§42) are explicitly
platform-bound.

## 5. Benchmark representativeness

**Threat.** The `RepairCost` comparison (RQ4) and the migration metrics are defined over *this* codebase's
capabilities. "Exact-fit repair vs oversized repair" measured on one `1×1` gap may not transfer. Likewise
`startup time`, `test time` and `build time` are affected by machine load, cold caches and Electron's own
variance.

**Mitigation.** Report raw values, the command, the machine, and the commit for every timing. Where variance
is material, report a range or repeated runs rather than a single figure. Mark single-sample comparisons as
`INCONCLUSIVE` rather than as a result.

## 6. Measurement instrumentation effects

**Threat.** The act of measuring changes the thing measured. Concretely and already visible in this program:

* The architecture observatory will be **new code**, and adding code to a repository changes the dependency
  graph the observatory measures. The instrument is inside its own sample.
* Running the acceptance chain writes into `artifacts/`, which is a declared runtime-owned path; a previous
  round already produced a CI failure by making that path own tracked files.
* Adding per-capability surfaces, registries and health reporting (§8–§9) increases file count, boot module
  count and import count. **The city architecture may increase total code size and declared edges while
  reducing coupling.** This is a live confounder for RQ3 and must be reported, not hidden.

**Mitigation.** Fix the instrument's own scope (`scripts/**` excluded from migration metrics where it would
be self-referential), and report absolute counts alongside ratios so that growth cannot masquerade as
improvement.

## 7. Instrument scope: the observatory cannot see credential-level coupling

**Threat.** RQ3 measures structural coupling in the **source graph**. The first real finding of this program,
`D-003`, is a coupling that the source graph cannot represent at all: the promotion actor and the Root Owner
shared one GitHub identity, so an independent authorization was impossible. No import edge, no manifest and
no dependency graph can express that. A program that measures only the source graph will systematically
report "no coupling" for a class of coupling that lives in **credentials, roles and platform configuration**.

**Mitigation.** Register this as a named limitation of observatory-based analysis. Where a claim is about
*authority* rather than *structure*, do not rely on the dependency graph. Track identity/role facts
separately (see `RESEARCH_LEDGER.md` D-003).

**Why recorded up front.** Because it was discovered during promotion, i.e. *before* the observatory was
built. Recording it now prevents a later claim of the form "the observatory found no violations, therefore
the system is decoupled" from being read as covering authority separation.

## 8. Instruments are retained in two versions, and the old one is not neutral

**Threat.** RQ5 compares a manifest-driven detector with a real-source-graph detector. The old detector is
retained specifically as a comparison arm (D-001). It is therefore deliberately *not* fixed — meaning it is
run in a known-defective state. Its false-negative rate is a property of that specific implementation, and
may overstate how bad manifest-driven approaches are in general.

**Mitigation.** State that the comparison is between **these two implementations**, not between "manifest
approaches" and "real-graph approaches" as classes.

## 9. Baseline drift risk

**Threat.** The `BEFORE` baseline is `pre-city-baseline-v1` = `836b5ed`. Promotion of that exact content to
`main` is currently blocked (`D-003`). If promotion is later completed with **different** content (a rebase,
an extra commit, a conflict resolution), then the `BEFORE` arm and `main` diverge, and any comparison
anchored on `main` would silently compare against the wrong tree.

**Mitigation.** The baseline is bound to a **content SHA**, not to a branch. Re-verify equality at promotion
time before re-tagging. Any divergence must be recorded as a ledger entry rather than absorbed.

## 10. Qualification semantics could be changed by the refactor

**Threat.** §39 requires an explicit judgement: **does urbanisation change qualification semantics?** If a
migration alters what a gate means, what evidence it accepts, or which checks are required, then prior
qualification does not carry over and re-qualification is mandatory. A refactor that quietly reclassifies a
trust-adjacent path is exactly the failure this needs to catch.

**Mitigation.** Treat `trust-policy/`, `credential-boundary/`, `promotion-gate/`, the required-check
declaration, trust-epoch anchors and `tests/acceptance/**` as frozen by default. Any change there must be a
separate, separately reported act with its own epoch discipline — never bundled into a migration. If such a
change is genuinely required, state that qualification semantics changed and that re-qualification is owed.

## 11. Environment-bound, irreproducible steps

**Threat.** Some required evidence cannot be produced in this environment and must not be faked:
real-host qualification, long soak, provider acceptance, installer VM cycle, machine identity. If these are
reported as anything other than `NOT_RUN` / `BLOCKED_EXTERNAL`, the study is invalid at the point of
reporting.

**Mitigation.** Hard rule, already in force from the Pre-City RC: never substitute a mock for real-host
evidence, and never read a green Desktop CI as a green real-host qualification.

---

## Standing validity rules for every claim in this program

1. Every claim binds to a **measurement**, an **experiment**, or a **source-code fact**. Otherwise:
   `DESIGN CLAIM` / `UNVERIFIED`.
2. Report `BEFORE` and `AFTER` with the **same instrument**; if the instrument changed, say so and report
   both instruments.
3. Report **absolute counts as well as ratios**, so that growth cannot read as improvement.
4. Retain **negative results** verbatim (`NO IMPROVEMENT`, `REGRESSION`, `MIXED RESULT`).
5. Distinguish **seeded** from **observed** evidence everywhere.
6. Record the **commit, command, machine and platform** with every number.
7. Never lower a threshold, delete a failing sample, or drop a regression to improve an outcome.
