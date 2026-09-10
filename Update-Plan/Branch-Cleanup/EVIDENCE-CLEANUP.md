# Evidence Cleanup — Phase H

Authority: `Update-Plan/cleanup.md` §11 (H1 BOM, H2 malformed JSON, H3 dangling
references, H4 orphans).

The final integration tree must not carry the evidence defects Host-M P5 found. P5
was read-only by design and recorded them as *reported, not repaired*; Phase H is the
integration-phase repair that P5 deliberately left to this stage.

## H1 — UTF-8 BOM

cleanup.md §11.1 target: *all committed JSON parseable by standard `JSON.parse`*.

| | Count |
|---|---|
| Tracked `*.json` / `*.jsonl` scanned | 218 |
| Files carrying a UTF-8 BOM **before** | **48** |
| Files carrying a UTF-8 BOM **after** | **0** |

Repair method: strip the leading `EF BB BF` and rewrite the remainder byte-for-byte.
Every file's `sha256` before and after is recorded in
`evidence/evidence-cleanup/bom-repair-report.json`, together with the byte-count
change (each file shrinks by exactly 3 bytes).

Distribution of the 48 affected files:

| Directory | Files |
|---|---|
| `Update-Plan/overcomplete/evidence/live` | 26 |
| `Update-Plan/2026-09-09-closure/evidence` | 13 |
| `Update-Plan/overcomplete/evidence/restart` | 3 |
| `Update-Plan/Host-M/evidence/P1..P7` | 5 |
| `Update-Plan/overcomplete/evidence/release` | 1 |

Before/after scan artifacts: `json-health-scan-BEFORE.json` and
`json-health-scan.json`.

### Why the citations were distinguished from the parse

Host-M P5 reported "44 evidence JSON files carry a UTF-8 BOM, which plain `JSON.parse`
rejects". The BOM is a *portability* defect, not a parse failure inside Boss: the
evidence inspector and `scripts/closure-acceptance-report.mjs` both strip the BOM
before parsing. Stripping it at the source removes the hazard for every other reader
without changing what any artifact says.

## H2 — Malformed JSON

The single file cleanup.md §11.2 names:

```
Update-Plan/overcomplete/evidence/live/live-finding-qwen-2026-09-09-07-10-04.json
```

**What it actually was.** P5 described it as "two concatenated top-level objects".
Byte-level inspection shows one valid JSON object (499 bytes, depth returning to zero
at offset 498) followed by free-form markdown prose, not a second JSON document:

```
-- round2 non-visual: geometry/aria/text/icon scans around the composer found only
voice/header controls; no send affordance discoverable. Recorded limitation.
```

So the correct repair is to separate JSON from prose, not to split two documents.

**Repair applied.**

1. The leading JSON object is kept and written back as JSON — unchanged content, no
   BOM, trailing newline added.
2. The non-JSON prose is **preserved verbatim** in a companion file,
   `…live-finding-qwen-2026-09-09-07-10-04.json.tail.md`, together with a note naming
   the original path and explaining the split. Nothing was discarded.
3. The file path itself is unchanged, so existing citations keep pointing at the
   JSON they meant.

Note that Host-M's own `PROGRESS.md` cites this file by exact path as a known
malformed artifact. Because the path is preserved and the repair is recorded, that
historical statement stays accurate as a record of what was found while no longer
describing the current tree.

## H3 — Dangling references

Classification only. cleanup.md §11.3 requires classifying references and repairing
**only** genuinely broken ones; historical archive references may keep an explanatory
note.

### 3.1 Method

Host-M's inspector resolves a citation against three anchors (the inspected root, the
citing document's own directory, and the repository). Real citations in this plan also
resolve against a fourth kind of anchor: a citation relative to a *program* evidence
directory. For example a manifest under `Update-Plan/10-x` writes
`evidence/10A/10A-architecture.json`, which lives at
`Update-Plan/10-x/evidence/10A/10A-architecture.json`.

Classifying with only the inspector's three anchors collapses "resolves under a
different anchor" into "broken". `scripts/classify-dangling-refs.ps1` therefore
re-resolves every reported reference by longest-suffix match against every tracked
path, which is what these program-relative citations require.

### 3.2 Authoritative product-facing audit

The decisive check for real breakage is a direct audit of every requirement manifest,
since those are the machine-readable acceptance records. Every `implementation` path
in all four manifests was resolved against the tracked file list:

| Manifest | Missing implementation paths |
|---|---|
| `Update-Plan/2026-09-09-closure/requirement-manifest.json` | **1 (fixed)** |
| `Update-Plan/10-x/requirement-manifest.json` | 0 |
| `Update-Plan/Engine/requirement-manifest.json` | 0 |
| `Update-Plan/Host-M/requirement-manifest.json` | 0 |

### 3.3 The one real broken reference, fixed

R-204 (TEMP-CONVERSATION) listed this implementation path:

```
contracts/store/main-commander/main.ts
```

It resolves nowhere in the repository and was never tracked on any branch. The
`contracts/` directory does not exist at all. R-204's **own evidence file**
(`evidence/r204-conversation-policy.json`) names the real implementation:

```
src/shared/conversation-policy.ts (pure)
src/shared/contracts.ts
electron/store.ts setConversationPolicy (validated, durable)
electron/commander/main-commander.ts createTask
electron/main.ts create-task / dispatch-task IPC
```

So `contracts/store/main-commander/main.ts` is a **stale pre-refactor path**, not a
missing module. Fixed at its source:

1. Corrected the manifest entry to `electron/commander/main-commander.ts` — the file
   the evidence itself names, and the module that actually consumes
   `conversationPolicyFor`.
2. Regenerated the derived documents through `scripts/closure-set-status.mjs R-204
   --refresh`, so `ACCEPTANCE-MATRIX.md` and `FINAL-ACCEPTANCE.md` match the manifest.
3. Verified no tracked file references the stale path any more, and that R-204 remains
   `PASS` (a path correction, not a status change).

### 3.4 Categories that are not repaired, and why

| Category | Count (typical scan) | Why not repaired |
|---|---|---|
| generated-runtime | 47 | The seeded acceptance creates these files (`src/shared/__seeded_a.ts`, `tests/__seeded_b.test.ts`, …) inside its own clone or temp workspace. Their absence from this checkout is by design; the evidence records runs that legitimately produced them. |
| historical-only | remainder | The referenced artifact **does** exist in this tree; only the citation's relative anchor does not match. These are historical run records whose prose is itself the evidence. Rewriting them would edit recorded history. |
| external-document | 1 target | `Update-Plan/R43-Closure-Construction-Plan.md` is cited as the *execution basis* by `FINAL-ACCEPTANCE.md`, `REQUIREMENTS.md`, the closure manifest and `closure-acceptance-report.mjs`. It was never tracked on any branch — it is the out-of-repo plan the closure program was executed against, not a missing repository file. Creating a stub would fabricate a document that never existed, so it is recorded here instead. |

### 3.5 Post-repair state

The Host-M evidence inspector now reports:

```
invalidJson : 0
unexpected  : 0
```

and the closure acceptance report reports:

```
"evidenceProblems": {}
```

(The inspector's `dangling` and `orphans` counters are citation counts across every
inspected document, so they scale with how much prose cites evidence. They are not a
defect count and were deliberately left alone beyond the classification above; see
§3.4.)

## H4 — Orphans

cleanup.md §11.4: *150 historical orphans do not all need deleting; classify as
historical evidence / obsolete generated evidence / current acceptance evidence /
unknown, and delete only what is clearly obsolete with no provenance value.*

Decision: **no orphan was deleted.**

Rationale:

- The orphan set is dominated by historical live-run and soak evidence under
  `overcomplete/evidence/**` and `owner-result/evidence/round-*/**`. Every one of
  these is a run record. cleanup.md §1.1 and §11.4 both make provenance the deciding
  value, and this project's stated goal is to *preserve* history in git rather than
  destroy it.
- "No document cites it" is not evidence of obsolescence. It frequently means the
  citing index is itself a historical artifact.
- The Phase K acceptance record must be traceable. Deleting run evidence to reduce a
  counter would damage §25's "all branch/tag SHAs traceable" and "evidence layer"
  requirements.
- Nothing in cleanup.md's §25 success criteria requires an orphan count of zero.

The inspector's orphan counter reads 0 in the final scan only because its orphan
detection is scoped to whether documents **within the inspected root** cite each
record, and the Branch-Cleanup records cite the acceptance artifacts. No artifact was
removed to achieve that.

## Summary table

| Defect | Before | After | Repaired |
|---|---|---|---|
| UTF-8 BOM in tracked JSON | 48 | 0 | yes, byte-recorded |
| Malformed JSON | 1 | 0 | yes, prose preserved |
| Missing manifest implementation path | 1 | 0 | yes, corrected at source |
| Invalid JSON per inspector | 1 | 0 | yes |
| Unexpected findings per inspector | 0 | 0 | n/a |
| Closure `evidenceProblems` | `{}` | `{}` | n/a |
| Generated-runtime dangling references | 47 | 47 | no, by design |
| External-document citation | 1 | 1 | no, recorded instead |
| Orphans deleted | — | **0** | deliberately none |
