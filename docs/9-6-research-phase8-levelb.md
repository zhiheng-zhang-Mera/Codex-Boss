# 9-6 Research Phase 8 — Level-B Selection + Evidence-over-Vote Core

Compact handoff for codex-boss-9-6-research-plan.md Phase 8 (§8 core). Branch `9-6-research`.

## Why

Level-B research (workspace + goal → autonomous repo research) must first *select* a falsifiable
question from repo-inspection + web-AI candidates, then run a frozen protocol, and finally adopt
claims only when the plan's rule holds: **evidence > vote**. This phase ships the deterministic
selection + adjudication core; the live repo-E2E (real inspection + web-AI reviewers + real
experiments) is the remaining adoption seam and needs a GUI session.

## What was added

- **`src/shared/research-levelb.ts`** (new, pure)
  - `CandidateQuestion { id, question, hypothesis?, measurable, falsifiable, proposedBy,
    noveltyScore?, feasibilityScore? }` (+ fail-closed validation);
  - `isFalsifiable(candidate)`, `selectFalsifiableQuestion(candidates)` — measurable ∧
    falsifiable required; unmeasurable/unfalsifiable candidates rejected with reasons (never
    dropped silently); best candidate picked by novelty + feasibility heuristic.
- **`src/shared/research-adjudicate.ts`** (new, pure)
  - `ReviewerVote`, `ClaimEvidence { statisticSupported, independentReplication,
    verifiedCitations }`, `adjudicateClaim(votes, evidence, requiredVotes?)` — a claim is
    adopted only when deterministic statistics support it AND an independent replication
    exists; reviewer votes alone (even unanimous) never adopt an evidence-less claim.
- **`tests/research-levelb.test.ts`** (new, 5 tests) — falsifiable selection + reason-backed
  rejection; never picks non-falsifiable; validation fail-closed; evidence+replication adopt;
  votes-without-statistics never adopt; independent replication required.

## Verification

- Targeted: `research-levelb` (5) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Real Level-B flow: repo inspect → candidate RQs (web-AI) → `selectFalsifiableQuestion` →
  supervisor protocol freeze (Phase 5/7) → `ResearchRuntime` experiments (Phase 6) →
  statistics (Phase 10) → `adjudicateClaim` evidence>vote → evidence graph. The first real E2E
  on Codex-Boss itself is a GUI/live run, documented in the research progress doc.

## Checkpoint

Commit with: `src/shared/research-levelb.ts`, `src/shared/research-adjudicate.ts`,
`tests/research-levelb.test.ts`, this handoff.
