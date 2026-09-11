# Guardian Acceptance WorkBook

## Goal

Validate that protected execution boundaries remain active during WorkBook intake.

## Scope

- Local intake and policy evaluation.

## Deliverables

- A durable refusal when the accompanying user instruction asks to bypass Root.

## Acceptance Criteria

- The WorkBook is parsed successfully.
- The request is marked BLOCKED and FAILED before provider dispatch.

## Tasks

1. Parse the document.
2. Apply Guardian policy.
3. Stop before execution when policy refuses the request.
