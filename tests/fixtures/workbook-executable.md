# Local Acceptance WorkBook

## Goal

Verify that Codex-Boss can compile a bounded WorkBook into a task contract.

## Scope

- The selected temporary acceptance workspace only.
- No network access and no repository publication.

## Constraints

- Preserve all existing files.
- Do not expose credentials or weaken verification.

## Deliverables

- A task-contract summary containing this goal and the acceptance criterion.

## Acceptance Criteria

- The WorkBook is classified as executable with a non-empty objective.
- Analysis-only wording prevents provider dispatch.

## Tasks

1. Ingest the WorkBook.
2. Compile its declared fields.
3. Report the resulting contract.
