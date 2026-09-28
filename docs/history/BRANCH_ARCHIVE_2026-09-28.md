# BRANCH ARCHIVE — 2026-09-28 (CC-103 post-acceptance housekeeping)

**Scope:** branch-ref housekeeping only. No functional/runtime source changed, no architecture rule changed, no CI
policy changed, no evidence tag deleted or moved, no history rewritten, squashed, rebased or force-pushed.

**Why this file exists:** so that a future reader does not mistake a historical development branch for active work,
while every deleted branch tip stays resolvable. A branch deleted by this cleanup is resolvable through EXACTLY one of
two routes, and no third state is allowed: `main` ancestry / merge commits / PR history, or an immutable annotated tag.

**A `.gitignore` interaction worth knowing about.** The root `.gitignore` line 3 is a bare `history/`, which matches
**any** directory named `history` at any depth — including `docs/history/`. This file was therefore added with
`git add -f`, and it is TRACKED, which is what matters: once a path is tracked, `.gitignore` no longer affects it. The
side effect is that a SECOND file placed in this directory would be invisible to `git status` until it too is
force-added, or until a negation rule is added. That was not added here, because this round's PR is limited by its own
instruction to the archive manifest and the paper-evidence updates.

## Summary

```text
snapshot_main_before_cleanup = bedeb8280f4bdb51e54fbead642775b1a32d16b6
paper_snapshot_tag = boss-city-cc103-paper-snapshot-v1
branches_before = 152
branches_kept = 1
branches_deleted_merged = 111
branches_archive_tagged_then_deleted = 40
unique_archive_tags_created = 39
unpreserved_deleted_tips = 0
open_prs_at_cleanup = 0
```

Remote heads after cleanup: **1** — main.

### How each class was decided

```text
KEEP                  main, and any branch a CURRENT live workflow/ruleset/environment/deployment process
                      requires. Measured live: the only active ruleset (Main-Protection, id 22746755) scopes
                      refs/heads/main; ci.yml runs on push/pull_request with no branch filter; both other
                      workflows (platform-qualification, trust-epoch-finalization) are workflow_dispatch and
                      main-only. So no non-main ref is required, and none was kept.
DELETE_MERGED         the tip is reachable from bedeb8280f4b (main at cleanup). No archive tag is needed:
                      main ancestry, the merge commits and PR history already supply traceability.
ARCHIVE_THEN_DELETE   the tip is NOT reachable from the snapshot. The tip is preserved by an immutable
                      annotated tag FIRST, verified to resolve to the exact tip, and only then deleted. One
                      tag per UNIQUE tip SHA; an existing immutable evidence tag that already points at the
                      tip is used instead of creating a duplicate.
```

An exact tip SHA is the remote tip as reported by `git ls-remote --heads origin` at inventory time, never an inferred
merge SHA. Every deletion was guarded at execution time by three re-read conditions: zero open PRs; every live tip
still equal to the inventoried tip (so a force-push since the inventory aborts the run); and a verified preservation
ref for every unmerged tip.

## Full table

| branch | tip SHA | relationship to the paper snapshot / main | preservation ref | action | note |
| --- | --- | --- | --- | --- | --- |
| `candidate/alien2-real-work-v1` | `05d63b5e61ca79af8802c5434226af5c484918bf` | reachable from bedeb82 (main ancestry: behind 308, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | existing immutable tag: alien2-real-work-v1-rc1 (annotated) |
| `chore/platform-trust-epoch-migration` | `c3c739edd46371410f03eaf2cfe62eb29103e9ed` | reachable from bedeb82 (main ancestry: behind 339, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `chore/qualification-real-host-lane` | `ac3865b022217f2eb99ece50a34f0a8ce94818ad` | reachable from bedeb82 (main ancestry: behind 333, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `chore/root-trust-authority-lockdown` | `c58cef97fa256ecfe3b20d6bfd05a1d0d13ed4b7` | reachable from bedeb82 (main ancestry: behind 334, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `city/cc103-minimum-acceptance-record` | `24be64fe5c8c388dd450efa7df89cc0600197ff8` | reachable from bedeb82 (main ancestry: behind 1, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `city/cc103-minimum-human-acceptance` | `7bcfdf75fe9b0ee15797fea623271c581555a6ce` | reachable from bedeb82 (main ancestry: behind 4, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `dev/alien2-runtime-intelligence` | `ecae925b27afa3d2b1876f0c91678818fe1127de` | NOT reachable from bedeb82 (ahead 26, behind 325) | `archive/branch-tip-20260928/ecae925b27af` | ARCHIVE_THEN_DELETE | -- |
| `dev/city-phase0-architecture-observatory` | `328537e13f060349e587a6fdf674e03e39a2de61` | NOT reachable from bedeb82 (ahead 1, behind 279); merged PR #11 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/328537e13f06` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `dev/city-phase1a-enforcement-convergence` | `993d1e21cb4a08407588841ae39872aa469d61f6` | reachable from bedeb82 (main ancestry: behind 269, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `dev/city-phase1b-hosted-enforcement` | `9e22604b5ead8382ac3719f48c6803e8051c41ce` | reachable from bedeb82 (main ancestry: behind 260, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `dev/city-phase1b-hosted-shadow` | `37bc4b21bf02781b40401b3a91e919b25c7d4948` | NOT reachable from bedeb82 (ahead 1, behind 250); merged PR #14 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/37bc4b21bf02` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `dev/city-phase1b-s2-hosted-enforce-visible` | `5b257e31ee3b2961afe0c47f1c3a28a6f31e8a43` | reachable from bedeb82 (main ancestry: behind 234, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `dev/ri-01-core` | `90f3c7f2fc4ab87ca53c65c347327c85074aa980` | NOT reachable from bedeb82 (ahead 1, behind 319) | `archive/branch-tip-20260928/90f3c7f2fc4a` | ARCHIVE_THEN_DELETE | -- |
| `dev/ri-02-evaluation` | `02fa4847e26533cf7c9c627393d3ea08d5958b7f` | NOT reachable from bedeb82 (ahead 2, behind 319) | `archive/branch-tip-20260928/02fa4847e265` | ARCHIVE_THEN_DELETE | -- |
| `dev/ri-03-prospective` | `0df14872d41627d402ee7efdc2f0ca06a738decc` | NOT reachable from bedeb82 (ahead 3, behind 319) | `archive/branch-tip-20260928/0df14872d416` | ARCHIVE_THEN_DELETE | -- |
| `dev/ri-04-live-capture` | `8929f0402b865e4326af19270cba6fc1be5a54ea` | NOT reachable from bedeb82 (ahead 4, behind 319) | `archive/branch-tip-20260928/8929f0402b86` | ARCHIVE_THEN_DELETE | -- |
| `dev/self-case-record-v1` | `6cc84d2fa310eb6dde0ea56f50f6eb3839237c00` | reachable from bedeb82 (main ancestry: behind 313, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `dev/self-cognition-v1` | `9d1b8b269ee1ad5bf0a3d3d88d08c675d3844ac8` | reachable from bedeb82 (main ancestry: behind 318, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `dev/self-diagnosis-v1` | `32bc0586442ba11c9c5a63b832fe3714aa480c6d` | reachable from bedeb82 (main ancestry: behind 316, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/cc015-flake-record` | `bfa49c50511dc382d3eb6deb617013234759541b` | reachable from bedeb82 (main ancestry: behind 187, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/cc016-flake-measurement` | `48db858a935f156f81c8ba133cd21029300fff1f` | reachable from bedeb82 (main ancestry: behind 185, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/cc017-soak-report-flake` | `f9175a60b387c632e3afa181062be344ae4dfcff` | reachable from bedeb82 (main ancestry: behind 175, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/cc036-same-commit-flake-record` | `942cc89f4cd162fd2bc6eeb920da02353128fab0` | reachable from bedeb82 (main ancestry: behind 121, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/cc039-road-class-in-matrix` | `c17569ca0a7905b310c6758e2b07fdd9b122b796` | reachable from bedeb82 (main ancestry: behind 114, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/cc050-flake-occurrence-nine` | `cb1364436b750d16bc3a17ea5c8f7a64b97ad5ed` | reachable from bedeb82 (main ancestry: behind 93, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/cc079-correction` | `fa4f587784690b0c8d58967347753c050f01eddd` | NOT reachable from bedeb82 (ahead 1, behind 27); merged PR #116 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/fa4f58778469` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-071-lane-b-classification` | `f53ae4cfbaecd4c7c55b32b45984ca264c16ce8c` | reachable from bedeb82 (main ancestry: behind 41, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-cc-073-s6-continuation` | `e7b3050a2d32c908f9739d02212a775c6d31dbdf` | reachable from bedeb82 (main ancestry: behind 37, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-cc-074-s6-dead-cluster` | `5840fd8277486ec1f5a9437c3c130ac92a32d8c5` | reachable from bedeb82 (main ancestry: behind 35, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-cc-077-cycle-cut-plan` | `bcb4b041dd7913ed8a1da569825271244402603b` | NOT reachable from bedeb82 (ahead 1, behind 30); merged PR #113 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/bcb4b041dd79` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-078-rejected-plans` | `27c32efb73624a702eca095facff3848ed9643e0` | NOT reachable from bedeb82 (ahead 1, behind 29); merged PR #114 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/27c32efb7362` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-081-debt-006-foreclosure` | `df6d2dbfb5a71724dcd18abf94ac13e883197fe7` | NOT reachable from bedeb82 (ahead 1, behind 25); merged PR #118 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/df6d2dbfb5a7` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-082-road-necessity-not-sufficiency` | `4b6f1fbe643a5f9abef8d4da126f46fec1870915` | NOT reachable from bedeb82 (ahead 1, behind 24); merged PR #119 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/4b6f1fbe643a` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-083-s2-is-not-type-artifact` | `167938c0c444f0cd12a6844bec1d057d29812abd` | NOT reachable from bedeb82 (ahead 1, behind 23); merged PR #120 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/167938c0c444` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-085-root-endpoint-refusal` | `86eea5fed6776c2c236154befc68f9c0811dc8af` | NOT reachable from bedeb82 (ahead 1, behind 21); merged PR #122 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/86eea5fed677` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-086-two-ownership-models` | `aa51676429cefb80009aaa17701ca6a85ca98d3c` | NOT reachable from bedeb82 (ahead 1, behind 20); merged PR #123 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/aa51676429ce` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-087-endpoint-refusal-persists` | `69bfb503b7e1bdc81e035d4d7f311e89d3c61e74` | NOT reachable from bedeb82 (ahead 1, behind 19); merged PR #124 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/69bfb503b7e1` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-088-composition-root-has-no-owner` | `91442b37007325076752130771adb0a8def5ae52` | NOT reachable from bedeb82 (ahead 1, behind 18); merged PR #125 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/91442b370073` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-094-workspaces-is-priced` | `da75c6090dcc8f98202705350ebb5cd7d6bb5f12` | NOT reachable from bedeb82 (ahead 1, behind 12); merged PR #131 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/da75c6090dcc` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-096-cc095-diagnosis-corrected` | `3c624bcf57f968f2e2c4c4776e9256a3ef6dbdbd` | NOT reachable from bedeb82 (ahead 1, behind 11); merged PR #133 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/3c624bcf57f9` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-099-workspaces-wont-do` | `e6813642928f3a1cbc8d2fbf5f76a975b033f5b4` | NOT reachable from bedeb82 (ahead 1, behind 10); merged PR #135 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/e6813642928f` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-101-s2-remaining-classified` | `d6a5da2d24d1ef02ebd2c6746eb420056dc9ef2c` | NOT reachable from bedeb82 (ahead 1, behind 8); merged PR #137 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/d6a5da2d24d1` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc-102-cc101-withdrawn` | `b15793a1aaa3cd8d4a45f8b41c210126f760b9a4` | NOT reachable from bedeb82 (ahead 1, behind 7); merged PR #138 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/b15793a1aaa3` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `docs/city-cc018-correction` | `e09b052b4dd8513c89c743d76861940ce2c376db` | reachable from bedeb82 (main ancestry: behind 173, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-cc019-soak-floor` | `72fde2288661264dd0639f7c6957f66c676c2175` | reachable from bedeb82 (main ancestry: behind 171, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-cc020-composition-root` | `0778e4e1652ac0b4a15506d990cf9405156dfcfa` | reachable from bedeb82 (main ancestry: behind 165, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-cc021-round-close` | `f59a6d3e4ee7010b3e002e881600421e7a1eb077` | reachable from bedeb82 (main ancestry: behind 163, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-cc022-postbuild-flake` | `adfae034b045e8b466945130c0e20ea8bba45ee1` | reachable from bedeb82 (main ancestry: behind 161, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-cc024-negative-control` | `35f2184c0f7c783fccd5b60cbb1505264b2c385d` | reachable from bedeb82 (main ancestry: behind 149, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-cc027-gate-cost` | `f069c9d07a071b4d1c2ca9e94069136284978504` | reachable from bedeb82 (main ancestry: behind 143, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-cc029-epoch34` | `676dad3243c2d7f78f1f41d35ad2ce647c7de75e` | reachable from bedeb82 (main ancestry: behind 134, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-continuous-construction-audit` | `594968f73f5bbab9f2eafc8989d41b3c85938875` | reachable from bedeb82 (main ancestry: behind 198, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-epoch26-cycle-closure-record` | `b4bd37279055e5b7f7ebe496e3f97bd8ab62050b` | reachable from bedeb82 (main ancestry: behind 240, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-phase1b-baseline-gate-defect-and-pre08` | `2183e51fabd4d25c9dc768f9f49aacaaa9564131` | reachable from bedeb82 (main ancestry: behind 216, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-s1-soak-completion-record` | `d44b5e46afe0d429b7f12ac3bc9288402b569cc4` | reachable from bedeb82 (main ancestry: behind 238, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/city-s2-exit-certification` | `f4557f6acd3808937c24718ef881a4f82c0b73a3` | reachable from bedeb82 (main ancestry: behind 147, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/epoch28-finalization-record` | `286af17676dc1ccc7bfc4e6a9f9cdfa25c8853bb` | reachable from bedeb82 (main ancestry: behind 219, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/p2a-commander-and-map-reproducibility` | `7160b1d3094e98b0624d59c4d1ee9bb9d5205aae` | reachable from bedeb82 (main ancestry: behind 177, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/p2a-reattribution-analysis` | `e8599a978a50e10f36f9334e7f4209b111561344` | reachable from bedeb82 (main ancestry: behind 179, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/p2a-resumption-brief` | `d8dcf83e719a4f1f905e74bd4ba40239907d2bd0` | reachable from bedeb82 (main ancestry: behind 155, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/p2a-selector-baseline` | `94f12e64f7dec0712d510b1316b005e6e085734e` | reachable from bedeb82 (main ancestry: behind 153, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `docs/s3-activation-and-s4-decision` | `365cbcae98edcf95227e11ffdb349b0cc6460852` | reachable from bedeb82 (main ancestry: behind 194, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `evolution/acceptance-promotion-identity-20260922002549` | `3ce1ef89ea4047f1ed90be91585e6493387de847` | NOT reachable from bedeb82 (ahead 1, behind 287) | `archive/branch-tip-20260928/3ce1ef89ea40` | ARCHIVE_THEN_DELETE | -- |
| `evolution/acceptance-promotion-identity-20260922002642` | `d8fc0fb6579173a7f6200f06a494ddd744175d61` | NOT reachable from bedeb82 (ahead 1, behind 287) | `archive/branch-tip-20260928/d8fc0fb65791` | ARCHIVE_THEN_DELETE | -- |
| `evolution/acceptance-promotion-identity-20260922010033` | `16d093d342e0ff22546654d9acfaa417d708a163` | NOT reachable from bedeb82 (ahead 1, behind 287) | `archive/branch-tip-20260928/16d093d342e0` | ARCHIVE_THEN_DELETE | -- |
| `feat/acceptance-e2-names-the-debt` | `a4c669d63cbb53cc87036997b64be02b7ca1b833` | reachable from bedeb82 (main ancestry: behind 91, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/acceptance-g3-reads-the-rule` | `e5294d9b13d43fb2f96a6afb16fb31457fe36228` | reachable from bedeb82 (main ancestry: behind 89, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/bridge-expiry-validator` | `ba7bc264cb2b8db243b0992a76f7cd58a4d0c4fa` | reachable from bedeb82 (main ancestry: behind 110, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/durable-writer-validator` | `e732848d11c641742767e1e34330ee2c3434e44e` | reachable from bedeb82 (main ancestry: behind 95, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/final-acceptance-suite` | `58f30338933c6a6582410020f90ee7c66cd75f8c` | reachable from bedeb82 (main ancestry: behind 108, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/flatness-reasons-without-measurements` | `c0e1d17d5011bd577b96017c65bebabfaca50126` | reachable from bedeb82 (main ancestry: behind 99, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/invert-providers-tenx` | `ed210d2574c39d71fab5d9425b128152d510c5d4` | reachable from bedeb82 (main ancestry: behind 101, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/p2a-provider-closure` | `864216dbcfda1d759bccd8d5598ebf905a10405c` | reachable from bedeb82 (main ancestry: behind 140, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/p2b-kernel-feature-ratchet` | `8f879b0c1ed3c8af4f624ae9e5c5e2b632da99fa` | reachable from bedeb82 (main ancestry: behind 145, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/p2c-cycle-scc-validator` | `156b5d49e5be387ea00f33b1bb01885e6a3da579` | reachable from bedeb82 (main ancestry: behind 132, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/p2d-private-state-validator` | `3873128168a94038a540116b149d1aa8ebc7ba1c` | reachable from bedeb82 (main ancestry: behind 130, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/p2e-road-batch-2` | `eb9ba7163eaea2a25c361e39eb1c2d43d9f321e2` | reachable from bedeb82 (main ancestry: behind 112, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/p2e-road-candidates` | `d7500369bee7b0dfac4bad5d651e258bcef49a4a` | reachable from bedeb82 (main ancestry: behind 119, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/p2e-road-declarations` | `d2abfc1c532cacf73db0cf5139fb4d679fb357de` | reachable from bedeb82 (main ancestry: behind 116, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/p2f-flatness-registry` | `c35ef2a8b9683f7213394b1f021e74df90ff0094` | reachable from bedeb82 (main ancestry: behind 128, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/p2h-core-growth-budget` | `65cf88bc629986617b8d539214d0028f81a3fd22` | reachable from bedeb82 (main ancestry: behind 123, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/p2i-principle-enforcement-matrix` | `f0defe8b44e291fd4aeba20bb4bff20c92d846c1` | reachable from bedeb82 (main ancestry: behind 125, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/pair-inspector-line-invariant` | `ebdd6461f8bd1c7970268384a8399a0b6be63519` | reachable from bedeb82 (main ancestry: behind 97, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/persistence-wiring` | `287765eabe830eff89b5f8ea101f6d8544ad2b18` | NOT reachable from bedeb82 (ahead 1, behind 68) | `archive/branch-tip-20260928/287765eabe83` | ARCHIVE_THEN_DELETE | -- |
| `feat/pf020-identity-convergence` | `add57742d882349e57f60b8de8f59b68362849c4` | NOT reachable from bedeb82 (ahead 2, behind 314) | `archive/branch-tip-20260928/add57742d882` | ARCHIVE_THEN_DELETE | -- |
| `feat/replacement-lifecycle` | `51c6e709fd89014a5705c2e38ee8f5a67c345f67` | reachable from bedeb82 (main ancestry: behind 106, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `feat/retire-bridge-p2a-01` | `597fdd033121e225c73d43853b114476f28bdda2` | reachable from bedeb82 (main ancestry: behind 103, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/cc065-attachments-namespace-ownership` | `71d380ab739c5bcda92bc88fab27fdcac0546fe0` | reachable from bedeb82 (main ancestry: behind 53, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/cc066-identity-namespace-ownership` | `042274e055f5c355993176d26f24d4ee00ec9297` | reachable from bedeb82 (main ancestry: behind 51, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/cc067-node-namespace-ownership` | `5a02298f53b990b83c837f66e359e4c1c5b524dc` | reachable from bedeb82 (main ancestry: behind 49, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/cc068-experience-namespace-ownership` | `f6cc152f52c1e71e89a5ff2807ca9e7275788c9f` | reachable from bedeb82 (main ancestry: behind 47, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/cc069-remove-dead-project-state` | `95957367bc2aad27e8d338f613327ed4d62c3bce` | reachable from bedeb82 (main ancestry: behind 45, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/cc070-permission-manifest-ownership` | `a54b196d1fa862b7c2b66adad3179048f83e479b` | reachable from bedeb82 (main ancestry: behind 43, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/cc072-s6-dead-helper-and-smoke-isolation` | `3cbe8e4c945d30ac9bebeb18963983a2871aec33` | reachable from bedeb82 (main ancestry: behind 39, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/cc075-intervention-read-model` | `675ab312786ebd2f33823e205ec60d79041f2482` | reachable from bedeb82 (main ancestry: behind 32, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/cc076-retire-dead-observer-cluster` | `271cede0e2bcb1b40d4c72c58d1e874aef0a3655` | NOT reachable from bedeb82 (ahead 2, behind 31); merged PR #112 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/271cede0e2bc` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `fix/cc079-stale-migration-subject` | `5471a11bca41ac638a3c2846f922b8f7e50e58bf` | NOT reachable from bedeb82 (ahead 1, behind 28); merged PR #115 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/5471a11bca41` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `fix/cc080-close-city-debt-005` | `07e034c9a5a74e889bb5b4cab6681646806b4d7c` | NOT reachable from bedeb82 (ahead 1, behind 26); merged PR #117 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/07e034c9a5a7` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `fix/cc084-runtime-budget-ownership` | `d0691abe8a8c7bc303f27128b91829c9d48ca4cf` | NOT reachable from bedeb82 (ahead 4, behind 22); merged PR #121 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/d0691abe8a8c` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `fix/cc089-composition-root-ownership` | `3b46e5bd7e52d3c1e597d87587547d5f8ffa1c0d` | NOT reachable from bedeb82 (ahead 3, behind 17); merged PR #126 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/3b46e5bd7e52` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `fix/cc090-interventions-ownership` | `13c687bd266988b0b017bae6f95bbc1d64cb57ff` | NOT reachable from bedeb82 (ahead 3, behind 16); merged PR #127 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/13c687bd2669` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `fix/cc091-external-sessions-ownership` | `6c119492678b0e4d555404857d00701c2f4b4508` | NOT reachable from bedeb82 (ahead 3, behind 15); merged PR #128 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/6c119492678b` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `fix/cc092-task-contexts-ownership` | `194ba70c5c8f0bd57ab3c8985d7f005fb5442c0b` | NOT reachable from bedeb82 (ahead 3, behind 14); merged PR #129 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/194ba70c5c8f` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `fix/cc093-workspace-selection-ownership` | `ba84ce1fbe4d7953b3eb334d42d5f1daca24c7ce` | NOT reachable from bedeb82 (ahead 3, behind 13); merged PR #130 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/ba84ce1fbe4d` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `fix/cc100-soak-sweep-followup` | `10021ec2562ea9dd23ca6fde4800e0af6ccd0c64` | NOT reachable from bedeb82 (ahead 2, behind 9); merged PR #136 (its content is in main through the squashed/merged commit, its exact tip commits are not) | `archive/branch-tip-20260928/10021ec2562e` | ARCHIVE_THEN_DELETE | squash-merged tip: content in main, exact commits preserved by tag |
| `fix/ci-windows-sandbox-test-isolation` | `3f16e44f363d8b6729dd3f62497468532e84af3b` | reachable from bedeb82 (main ancestry: behind 340, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/city-phase1b-baseline-integrity-split` | `d5571ebfafd494a8ff72fd79e0bb7686ec0520bf` | reachable from bedeb82 (main ancestry: behind 213, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/city-phase1b-epoch-transition-guards` | `f4b4b59917eaf7713eaa56035061766bc56bcf22` | reachable from bedeb82 (main ancestry: behind 246, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/postbuild-suite-budgets` | `65323c366062d7ae0815da780ae962c54d4ac50b` | reachable from bedeb82 (main ancestry: behind 159, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/root-trust-finalization-transport-handoff-v1` | `6799053467f6ab0ca260d54923f687a7a1f205cd` | reachable from bedeb82 (main ancestry: behind 227, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/root-trust-surface-epoch28-finalization-paths` | `44e03285f38358ead9342ba97723b23bc71995a6` | reachable from bedeb82 (main ancestry: behind 223, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/runtime-isolation-root-policy-v1` | `d9ddb1511adeb61dee21192a683eb7851d3ca556` | reachable from bedeb82 (main ancestry: behind 286, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/slow-tier-adversarial` | `2ee181aa9730ebb28eacc45b02a0be54f56eb2ba` | reachable from bedeb82 (main ancestry: behind 183, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/soak-null-trend` | `80bd0ebeff12824ec2de731c6eae77ea3668a777` | reachable from bedeb82 (main ancestry: behind 169, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `fix/trust-finalization-sha-bound` | `4962aa46280e3449803dc88d61411b5206352418` | reachable from bedeb82 (main ancestry: behind 210, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `governance/s3-architecture-required` | `79055de04867e714de502a696e7c73b827453750` | reachable from bedeb82 (main ancestry: behind 196, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `integration/pre-city-baseline` | `836b5ed60aa63f3334e6cd08b193113325505880` | reachable from bedeb82 (main ancestry: behind 288, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `main` | `bedeb8280f4bdb51e54fbead642775b1a32d16b6` | IS the cleanup snapshot | n/a (main is the snapshot) | KEEP | existing immutable tag: boss-city-cc103-paper-snapshot-v1 (annotated); the only ordinary active development branch; the ruleset scopes refs/heads/main |
| `p2a-composition-root-class` | `d1877c679c670a7ca4b6b463315dca042ac8b49e` | reachable from bedeb82 (main ancestry: behind 151, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `perf/pf019-real-host-scale-tier` | `7c718aa3fafcbecc54d29f78f1052e9859514579` | reachable from bedeb82 (main ancestry: behind 321, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `phase2/p2a-capability-closure-validator` | `daadb22d26e9f3cd0501e39bc825fdfd747fa062` | reachable from bedeb82 (main ancestry: behind 191, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `phase2/p2a-edge-inventory` | `e2ea963a1f4d8fc95bab4c7042bd4892188cd7f0` | reachable from bedeb82 (main ancestry: behind 189, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `platform-foundation/01-architecture-contracts` | `426f635b2a8155ec15c16fc32e9b719e163ec074` | reachable from bedeb82 (main ancestry: behind 414, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `platform-foundation/01-architecture-contracts-tmp` | `4b623b985cd9a8630a74382600780671554105d2` | reachable from bedeb82 (main ancestry: behind 419, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `platform-foundation/02-durable-state-events` | `0623e0caec3670c2d36e867e388bfac3bdb6f2a9` | reachable from bedeb82 (main ancestry: behind 407, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `platform-foundation/03-capability-security-plugins` | `977ecae92b0e788a2d502f9abac10bcc37d05d87` | reachable from bedeb82 (main ancestry: behind 401, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `platform-foundation/04-knowledge-data-lifecycle` | `c499c3e1d3f7d91487c8331d24471b7b968795fb` | reachable from bedeb82 (main ancestry: behind 399, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `platform-foundation/05-scale-verification-soak` | `14fd222aba782f97ec40662b04fc19f391f2653d` | reachable from bedeb82 (main ancestry: behind 374, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `platform-foundation/06-dogfooding-closure` | `e135f8c54fbe9dcc448c2d8f05611d344d7291a4` | reachable from bedeb82 (main ancestry: behind 363, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `platform-foundation/07-semantic-acceptance` | `c1752459ab762f16ef4d35a5bfa765b1e7a500a0` | reachable from bedeb82 (main ancestry: behind 354, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `platform-foundation/08-production-qualification` | `601285abe6500eb817fd450897afa82d0512538c` | reachable from bedeb82 (main ancestry: behind 348, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | existing immutable tag: platform-foundation-v1 (annotated) |
| `platform-stabilization/01-hardening` | `9093faba2b4d2f3c0c12ce59249485a9ba6376b5` | reachable from bedeb82 (main ancestry: behind 345, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | existing immutable tag: platform-foundation-production-v1 (annotated) |
| `Prestart` | `f4d800cde78eb229a6e2cdd7984051daf2186c95` | reachable from bedeb82 (main ancestry: behind 576, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `Prestart-checkpoint-1` | `fc860210b515e726d0ef89deb700f9d2cc632505` | reachable from bedeb82 (main ancestry: behind 572, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `Prestart-checkpoint-2` | `313e63ae0a0a1f0f0b9706554f40f5c83435436f` | reachable from bedeb82 (main ancestry: behind 538, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `Prestart-checkpoint-3` | `4ae1bb5b0666c65227068256bf87daf6413c8f53` | reachable from bedeb82 (main ancestry: behind 528, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `Prestart-checkpoint-4` | `e081f1714c18522cfb806df0202b8f34c769000c` | reachable from bedeb82 (main ancestry: behind 437, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `Prestart-checkpoint-5` | `4b623b985cd9a8630a74382600780671554105d2` | reachable from bedeb82 (main ancestry: behind 419, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `promotion-test/platform-foundation-08` | `601285abe6500eb817fd450897afa82d0512538c` | reachable from bedeb82 (main ancestry: behind 348, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | existing immutable tag: platform-foundation-v1 (annotated) |
| `refactor/capability-city-v1` | `3ab37d9f969d97af0bb8170a2517032b447e9ac9` | NOT reachable from bedeb82 (ahead 14, behind 288) | `archive/branch-tip-20260928/3ab37d9f969d` | ARCHIVE_THEN_DELETE | -- |
| `s2-negative-control-v1` | `57aeede5021f69392280cbea1bc58375fed43d82` | NOT reachable from bedeb82 (ahead 1, behind 150) | `city-evidence-s2-negative-control-v1` | ARCHIVE_THEN_DELETE | existing immutable tag: city-evidence-s2-negative-control-v1 (annotated) |
| `test/pf020-runtime-isolation-production-fix-v2` | `2f36d99aa77acf23968a0f55432dfb44cb51dbdc` | NOT reachable from bedeb82 (ahead 6, behind 314) | `archive/branch-tip-20260928/2f36d99aa77a` | ARCHIVE_THEN_DELETE | -- |
| `trust-epoch/boss-root-trust-26` | `000b0d4fc1f07716cd188dc2659271ef8ec5576c` | reachable from bedeb82 (main ancestry: behind 243, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `trust-epoch/boss-root-trust-27` | `0dda34f5fa470aabc6ba866797a45de65030380f` | reachable from bedeb82 (main ancestry: behind 232, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `trust-epoch/boss-root-trust-28` | `54d29373d0692e6a2bde9f25f59b33ead91b9455` | reachable from bedeb82 (main ancestry: behind 221, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `trust-epoch/boss-root-trust-29` | `e632d10b83dfa974b393c9aa96649e961c6ee3e6` | reachable from bedeb82 (main ancestry: behind 211, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `trust-epoch/boss-root-trust-30` | `0184008c3f97a29c72669b3cf86cf4258d70bb9c` | reachable from bedeb82 (main ancestry: behind 200, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `trust-epoch/boss-root-trust-31` | `35ea6207ccccace55c03f6c38cbdef67669d60c5` | reachable from bedeb82 (main ancestry: behind 181, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `trust-epoch/boss-root-trust-32` | `dcb09f484c803ffb0f169cc59bed0fb464a11c8b` | reachable from bedeb82 (main ancestry: behind 167, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `trust-epoch/boss-root-trust-33` | `44af1739432bf5c1ebe2e6ebb70c7ad73a5bce0d` | reachable from bedeb82 (main ancestry: behind 157, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `trust-epoch/boss-root-trust-34` | `ca311337230daa6982cee0a892d444034f25ffd6` | reachable from bedeb82 (main ancestry: behind 136, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |
| `trust/pf-debt-017-epoch-24` | `234f96ddacd6cc7d08fd8860832b2b028471d89b` | reachable from bedeb82 (main ancestry: behind 318, ahead 0) | n/a -- main ancestry / merge commits / PR history | DELETE_MERGED | -- |

## Preservation tags created by this cleanup

One annotated tag per unique unmerged tip. Its message records the exact tip, the original branch name(s), the
reason and the creation date.

```text
archive/branch-tip-20260928/ecae925b27af
    -> ecae925b27afa3d2b1876f0c91678818fe1127de
    original branch: dev/alien2-runtime-intelligence
archive/branch-tip-20260928/328537e13f06
    -> 328537e13f060349e587a6fdf674e03e39a2de61
    original branch: dev/city-phase0-architecture-observatory
archive/branch-tip-20260928/37bc4b21bf02
    -> 37bc4b21bf02781b40401b3a91e919b25c7d4948
    original branch: dev/city-phase1b-hosted-shadow
archive/branch-tip-20260928/90f3c7f2fc4a
    -> 90f3c7f2fc4ab87ca53c65c347327c85074aa980
    original branch: dev/ri-01-core
archive/branch-tip-20260928/02fa4847e265
    -> 02fa4847e26533cf7c9c627393d3ea08d5958b7f
    original branch: dev/ri-02-evaluation
archive/branch-tip-20260928/0df14872d416
    -> 0df14872d41627d402ee7efdc2f0ca06a738decc
    original branch: dev/ri-03-prospective
archive/branch-tip-20260928/8929f0402b86
    -> 8929f0402b865e4326af19270cba6fc1be5a54ea
    original branch: dev/ri-04-live-capture
archive/branch-tip-20260928/fa4f58778469
    -> fa4f587784690b0c8d58967347753c050f01eddd
    original branch: docs/cc079-correction
archive/branch-tip-20260928/bcb4b041dd79
    -> bcb4b041dd7913ed8a1da569825271244402603b
    original branch: docs/city-cc-077-cycle-cut-plan
archive/branch-tip-20260928/27c32efb7362
    -> 27c32efb73624a702eca095facff3848ed9643e0
    original branch: docs/city-cc-078-rejected-plans
archive/branch-tip-20260928/df6d2dbfb5a7
    -> df6d2dbfb5a71724dcd18abf94ac13e883197fe7
    original branch: docs/city-cc-081-debt-006-foreclosure
archive/branch-tip-20260928/4b6f1fbe643a
    -> 4b6f1fbe643a5f9abef8d4da126f46fec1870915
    original branch: docs/city-cc-082-road-necessity-not-sufficiency
archive/branch-tip-20260928/167938c0c444
    -> 167938c0c444f0cd12a6844bec1d057d29812abd
    original branch: docs/city-cc-083-s2-is-not-type-artifact
archive/branch-tip-20260928/86eea5fed677
    -> 86eea5fed6776c2c236154befc68f9c0811dc8af
    original branch: docs/city-cc-085-root-endpoint-refusal
archive/branch-tip-20260928/aa51676429ce
    -> aa51676429cefb80009aaa17701ca6a85ca98d3c
    original branch: docs/city-cc-086-two-ownership-models
archive/branch-tip-20260928/69bfb503b7e1
    -> 69bfb503b7e1bdc81e035d4d7f311e89d3c61e74
    original branch: docs/city-cc-087-endpoint-refusal-persists
archive/branch-tip-20260928/91442b370073
    -> 91442b37007325076752130771adb0a8def5ae52
    original branch: docs/city-cc-088-composition-root-has-no-owner
archive/branch-tip-20260928/da75c6090dcc
    -> da75c6090dcc8f98202705350ebb5cd7d6bb5f12
    original branch: docs/city-cc-094-workspaces-is-priced
archive/branch-tip-20260928/3c624bcf57f9
    -> 3c624bcf57f968f2e2c4c4776e9256a3ef6dbdbd
    original branch: docs/city-cc-096-cc095-diagnosis-corrected
archive/branch-tip-20260928/e6813642928f
    -> e6813642928f3a1cbc8d2fbf5f76a975b033f5b4
    original branch: docs/city-cc-099-workspaces-wont-do
archive/branch-tip-20260928/d6a5da2d24d1
    -> d6a5da2d24d1ef02ebd2c6746eb420056dc9ef2c
    original branch: docs/city-cc-101-s2-remaining-classified
archive/branch-tip-20260928/b15793a1aaa3
    -> b15793a1aaa3cd8d4a45f8b41c210126f760b9a4
    original branch: docs/city-cc-102-cc101-withdrawn
archive/branch-tip-20260928/3ce1ef89ea40
    -> 3ce1ef89ea4047f1ed90be91585e6493387de847
    original branch: evolution/acceptance-promotion-identity-20260922002549
archive/branch-tip-20260928/d8fc0fb65791
    -> d8fc0fb6579173a7f6200f06a494ddd744175d61
    original branch: evolution/acceptance-promotion-identity-20260922002642
archive/branch-tip-20260928/16d093d342e0
    -> 16d093d342e0ff22546654d9acfaa417d708a163
    original branch: evolution/acceptance-promotion-identity-20260922010033
archive/branch-tip-20260928/287765eabe83
    -> 287765eabe830eff89b5f8ea101f6d8544ad2b18
    original branch: feat/persistence-wiring
archive/branch-tip-20260928/add57742d882
    -> add57742d882349e57f60b8de8f59b68362849c4
    original branch: feat/pf020-identity-convergence
archive/branch-tip-20260928/271cede0e2bc
    -> 271cede0e2bcb1b40d4c72c58d1e874aef0a3655
    original branch: fix/cc076-retire-dead-observer-cluster
archive/branch-tip-20260928/5471a11bca41
    -> 5471a11bca41ac638a3c2846f922b8f7e50e58bf
    original branch: fix/cc079-stale-migration-subject
archive/branch-tip-20260928/07e034c9a5a7
    -> 07e034c9a5a74e889bb5b4cab6681646806b4d7c
    original branch: fix/cc080-close-city-debt-005
archive/branch-tip-20260928/d0691abe8a8c
    -> d0691abe8a8c7bc303f27128b91829c9d48ca4cf
    original branch: fix/cc084-runtime-budget-ownership
archive/branch-tip-20260928/3b46e5bd7e52
    -> 3b46e5bd7e52d3c1e597d87587547d5f8ffa1c0d
    original branch: fix/cc089-composition-root-ownership
archive/branch-tip-20260928/13c687bd2669
    -> 13c687bd266988b0b017bae6f95bbc1d64cb57ff
    original branch: fix/cc090-interventions-ownership
archive/branch-tip-20260928/6c119492678b
    -> 6c119492678b0e4d555404857d00701c2f4b4508
    original branch: fix/cc091-external-sessions-ownership
archive/branch-tip-20260928/194ba70c5c8f
    -> 194ba70c5c8f0bd57ab3c8985d7f005fb5442c0b
    original branch: fix/cc092-task-contexts-ownership
archive/branch-tip-20260928/ba84ce1fbe4d
    -> ba84ce1fbe4d7953b3eb334d42d5f1daca24c7ce
    original branch: fix/cc093-workspace-selection-ownership
archive/branch-tip-20260928/10021ec2562e
    -> 10021ec2562ea9dd23ca6fde4800e0af6ccd0c64
    original branch: fix/cc100-soak-sweep-followup
archive/branch-tip-20260928/3ab37d9f969d
    -> 3ab37d9f969d97af0bb8170a2517032b447e9ac9
    original branch: refactor/capability-city-v1
archive/branch-tip-20260928/2f36d99aa77a
    -> 2f36d99aa77acf23968a0f55432dfb44cb51dbdc
    original branch: test/pf020-runtime-isolation-production-fix-v2
```

### Already preserved by an existing immutable evidence tag (no duplicate created)

```text
s2-negative-control-v1  57aeede5021f69392280cbea1bc58375fed43d82  ->  city-evidence-s2-negative-control-v1
```

## Evidence refs deliberately untouched

No tag was deleted or moved by this round, including `boss-city-cc103-paper-snapshot-v1`, the
`city-evidence-*` tags, the phase/evidence milestone tags, the Root Trust / epoch tags, and every tag referenced by
`docs/research/PAPER_EVIDENCE_LEDGER.md` or a published acceptance record. This cleanup targets branch refs only.

## Reproducing this table

```text
git ls-remote --heads origin                 # exact remote tips
git rev-list bedeb8280f4bdb51e54fbead642775b1a32d16b6   # commits reachable from the snapshot
gh pr list --state open|merged --json number,headRefName,headRefOid,mergeCommit
git for-each-ref --format='%(refname:short) %(objecttype) %(objectname) %(*objectname)' refs/tags
```

