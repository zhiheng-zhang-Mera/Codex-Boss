#!/usr/bin/env node
/**
 * Trust Epoch Finalization — the terminal decision, the idempotency rule, and the PR handoff.
 *
 * WHY THIS MODULE EXISTS
 *
 *   The finalization workflow used to end with `gh pr create`. Repository policy does not let the Actions
 *   `GITHUB_TOKEN` create pull requests, so that step failed — and it failed for two consecutive epochs, 26 and 27:
 *
 *       epoch 26:  ceremony PASS, --advance PASS, --check PASS, branch pushed PASS, gh pr create FAIL
 *       epoch 27:  ceremony PASS, --advance PASS, --check PASS, branch pushed PASS, gh pr create FAIL
 *
 *   The epoch was correctly produced and anchored in both cases, and the workflow was nonetheless reported as
 *   FAILED. That is a **semantic** defect before it is an operational one: the workflow's terminal state described
 *   its TRANSPORT rather than its CEREMONY. A reader could not tell "the epoch is wrong" from "the epoch is right
 *   and nobody was told".
 *
 *   This module states the corrected semantics in one place, as a pure function so it can be tested exhaustively
 *   without a runner, a network or an epoch:
 *
 *       produce + verify + push + hand off  ->  SUCCESS (EPOCH_BRANCH_READY)
 *       nothing to migrate                  ->  SUCCESS (NO_MIGRATION, and nothing is written)
 *       the branch is already exactly right ->  SUCCESS (EPOCH_BRANCH_ALREADY_READY, no re-advance)
 *       the branch exists and disagrees     ->  FAILURE (EPOCH_BRANCH_CONFLICT, fail closed)
 *
 *   PR transport is NOT part of this decision. It belongs to the Codex-Boss App machine identity, which is the
 *   repository's existing machine transport (`createGitHubMachineRuntime` -> `GitHubGateway.createPullRequest`).
 *   The workflow therefore ends SUCCESS after handing off, and the App opens the PR.
 *
 * AUTHORITY IS REDUCED, NOT MOVED
 *
 *   The workflow keeps `contents: write` (it must commit and push the epoch branch) and loses
 *   `pull-requests: write` (it no longer creates pull requests). No Owner credential, no App private key and no
 *   broader GitHub permission is added anywhere. The protected `boss-root-trust-owner` environment, the
 *   `refs/heads/main` refusal, the `--advance` -> `--check` sequence and the branch push are all preserved
 *   unchanged.
 */

"use strict";

const SCHEMA_VERSION = 1;
const HANDOFF_SCHEMA = "city-trust-epoch-pr-handoff/1";

/** The terminal states. Two are successes, one is a considered non-action, one is a refusal. */
const STATE = {
  NO_MIGRATION: "NO_MIGRATION",
  EPOCH_BRANCH_READY: "EPOCH_BRANCH_READY",
  EPOCH_BRANCH_ALREADY_READY: "EPOCH_BRANCH_ALREADY_READY",
  EPOCH_BRANCH_CONFLICT: "EPOCH_BRANCH_CONFLICT",
};

/** Which states end the workflow successfully, and therefore which the workflow step must exit 0 on. */
const SUCCESS_STATES = [STATE.NO_MIGRATION, STATE.EPOCH_BRANCH_READY, STATE.EPOCH_BRANCH_ALREADY_READY];

function isSuccessState(state) {
  return SUCCESS_STATES.includes(state);
}

/** A hex digest of the expected width, or null. Used to compare two records without caring which is "right". */
function normalizeHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

/** A git object id (40-hex), or null. */
function normalizeCommit(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value) ? value : null;
}

/**
 * Section 9 B1 — the checkout binding, declared in the artifact rather than only in the workflow.
 *
 * WHY THE HANDOFF CARRIES IT
 *   The workflow now checks out `${{ github.sha }}` and asserts `git rev-parse HEAD` equals it. That assertion is
 *   the mechanism, but a mechanism proves nothing to a reader of the ARTIFACT: the handoff is what the App consumes
 *   and what an auditor reads months later, and until now it named `base_sha` (a value Stage A measured) without
 *   ever stating which commit the runner actually had checked out. A handoff that says "finalization of epoch N"
 *   while being silent about the tree would leave exactly the ambiguity this repair exists to remove.
 *
 *   So the record states both facts and refuses to be well-formed when they disagree. This is the same shape the
 *   workflow's `github run head_sha != checked-out tree` defect had, moved into the artifact where it is testable
 *   without a runner.
 *
 *   Both fields are OPTIONAL as a pair, because a caller that has not been taught the binding must not be able to
 *   fabricate one: absent means "this handoff does not state the binding" (visible as an absence), while a single
 *   present field is refused rather than half-answered.
 *
 *   An UNPARSEABLE value is preserved rather than normalized away. `normalizeCommit` returns null for `main`, for a
 *   short SHA and for a non-string, and if that null were stored then a handoff stating `dispatch_sha: "main"` would
 *   look exactly like a handoff that stated nothing -- the validator would accept it and the disagreement would be
 *   invisible again. So the raw value is kept, and `validateHandoff` refuses a present-but-not-a-commit value.
 */
function provenanceOf(dispatchSha, checkedOutSha) {
  const dispatch = normalizeCommit(dispatchSha);
  const checkedOut = normalizeCommit(checkedOutSha);
  return {
    // The normalized commits, when each value IS a commit.
    dispatch_sha: dispatch,
    checked_out_sha: checkedOut,
    // What the caller actually stated, so a value that is not a commit stays visible to the validator instead of
    // being normalized into the same shape as an absent one.
    stated_dispatch_sha: dispatchSha ?? null,
    stated_checked_out_sha: checkedOutSha ?? null,
    bound: Boolean(dispatch && checkedOut),
  };
}

/**
 * Compare the epoch record this run produced with the one already on the remote branch.
 *
 * Returns the set of fields that disagree, so a conflict can be REPORTED as a disagreement rather than as a bare
 * boolean. `matching` is the only thing the decision needs; `differences` is what a human needs.
 */
function compareEpochRecord(expected, existing) {
  if (!existing || typeof existing !== "object") {
    return { comparable: false, matching: false, differences: ["the existing epoch record could not be read"] };
  }
  const fields = ["trust_epoch", "root_contract_version", "root_surface_hash", "parent_epoch_hash", "epoch_hash"];
  const differences = [];
  for (const field of fields) {
    const a = expected?.[field] ?? null;
    const b = existing?.[field] ?? null;
    if (a !== b) differences.push(`${field}: expected ${JSON.stringify(a)}, found ${JSON.stringify(b)}`);
  }
  return { comparable: true, matching: differences.length === 0, differences };
}

/**
 * Decide the terminal state.
 *
 * Inputs are all facts the workflow has already measured; this function decides nothing it was not told.
 *
 * @param {object} input
 * @param {boolean} input.needsMigration        from Stage A's proposal
 * @param {boolean} input.branchExists          whether the epoch branch already exists on the remote
 * @param {object|null} input.expectedRecord    the epoch record this run produced (null when there was nothing)
 * @param {object|null} input.existingRecord    the record committed on the existing branch, when one exists
 * @param {number|null} input.candidateEpoch    the epoch number Stage A proposed
 */
function decideTerminalState(input) {
  const { needsMigration, branchExists, expectedRecord = null, existingRecord = null, candidateEpoch = null } = input ?? {};

  // Nothing to migrate: the committed epoch already anchors the live surface. This is a SUCCESS and a
  // deliberate non-action. It must exit 0 -- a workflow that fails because the repository was already correct
  // teaches its operators to re-run it until it does something, which is the opposite of a trust gate.
  if (!needsMigration) {
    return {
      state: STATE.NO_MIGRATION,
      success: true,
      wrote_anything: false,
      message: "the committed epoch already anchors the live Root Trust Surface; no epoch was advanced and no branch was created",
    };
  }

  // A migration was needed, but the branch is already there. The ONLY safe reading of that is: compare it. If it
  // says the same thing, this run's work was already done -- reuse it and succeed, WITHOUT advancing again.
  // Re-advancing would either be a no-op or, worse, silently produce a different record.
  if (branchExists) {
    const comparison = compareEpochRecord(expectedRecord, existingRecord);
    if (comparison.matching) {
      return {
        state: STATE.EPOCH_BRANCH_ALREADY_READY,
        success: true,
        wrote_anything: false,
        re_advanced: false,
        message: "the epoch branch already carries exactly this epoch record; reusing it rather than advancing again",
        comparison,
      };
    }
    // It exists and disagrees. Fail closed and say so: overwriting an Owner-authorised epoch branch, or force
    // pushing over it, would destroy the record of a ceremony that already happened.
    return {
      state: STATE.EPOCH_BRANCH_CONFLICT,
      success: false,
      wrote_anything: false,
      re_advanced: false,
      message: "the epoch branch exists and does not carry the expected epoch record; refusing to overwrite or force-push it",
      comparison,
      candidate_epoch: candidateEpoch,
    };
  }

  return {
    state: STATE.EPOCH_BRANCH_READY,
    success: true,
    wrote_anything: true,
    message: "the Owner-authorised epoch branch was produced, verified with --check, and pushed; PR transport is the machine identity's",
    candidate_epoch: candidateEpoch,
  };
}

/**
 * The machine-readable handoff the App identity consumes to open the PR.
 *
 * It is a REQUEST, never an authorisation: `pr_required` says a pull request is needed, and `pr_creator` names who
 * may open it. Nothing here grants anyone the right to merge, and nothing here carries a credential.
 */
function buildHandoff(input) {
  const {
    repository, finalizationRunId, baseBranch, baseSha, epoch, epochBranch, epochCommit,
    rootSurfaceHash, epochHash, prRequired, result, dispatchSha = null, checkedOutSha = null,
  } = input;
  const provenance = provenanceOf(dispatchSha, checkedOutSha);
  return {
    schema_version: SCHEMA_VERSION,
    schema: HANDOFF_SCHEMA,
    state: result.state,
    repository,
    finalization_run_id: String(finalizationRunId),
    base_branch: baseBranch,
    base_sha: baseSha,
    epoch,
    epoch_branch: epochBranch,
    epoch_commit: epochCommit,
    root_surface_hash: rootSurfaceHash,
    epoch_hash: epochHash,
    pr_required: Boolean(prRequired),
    // A NAME, never a credential. The App private key lives in the platform vault and is never in this artifact.
    pr_creator: "codex-boss-machine-identity",
    // Section 9 B1: which commit the run was DISPATCHED on, and which commit it actually MEASURED. A reader must
    // not have to infer either from the run id, and the two must be equal -- `validateHandoff` refuses otherwise.
    provenance: {
      dispatch_sha: provenance.dispatch_sha,
      checked_out_sha: provenance.checked_out_sha,
      stated_dispatch_sha: provenance.stated_dispatch_sha,
      stated_checked_out_sha: provenance.stated_checked_out_sha,
      checkout_is_sha_bound: provenance.bound,
      basis: "the workflow checks out ${{ github.sha }} and asserts `git rev-parse HEAD` equals it before measuring",
    },
    // Stated in the artifact itself so a consumer does not have to infer it from absence.
    authority: {
      workflow_permissions: { contents: "write" },
      workflow_may_create_pull_requests: false,
      owner_merge_required: true,
      owner_credential_in_artifact: false,
    },
    finalization: {
      message: result.message,
      success: result.success,
      re_advanced: result.re_advanced ?? false,
    },
  };
}

const REQUIRED_HANDOFF_FIELDS = [
  "schema_version", "state", "repository", "finalization_run_id", "base_branch", "base_sha",
  "epoch", "epoch_branch", "epoch_commit", "root_surface_hash", "epoch_hash", "pr_required", "pr_creator",
];

/**
 * Fields that only exist when the run actually PRODUCED the epoch branch.
 *
 * A no-migration run advances nothing and a rerun onto an already-ready branch produces nothing new, so neither
 * has a commit or an epoch hash of its own to report -- and demanding one would force this program to invent a
 * value, which is exactly what a governance artifact must never do. The two fields are therefore required only in
 * `EPOCH_BRANCH_READY`, and their ABSENCE in the other states is a fact rather than an omission.
 */
const PRODUCED_FIELDS = ["epoch_commit", "epoch_hash"];
const STATES_THAT_PRODUCE = [STATE.EPOCH_BRANCH_READY];

/**
 * Validate a handoff object. Returns every problem rather than the first, and refuses anything that looks like
 * credential material anywhere in the document.
 */
function validateHandoff(value) {
  const problems = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, problems: ["the handoff is not an object"] };
  }
  const produces = STATES_THAT_PRODUCE.includes(value.state);
  const required = REQUIRED_HANDOFF_FIELDS.filter((field) => produces || !PRODUCED_FIELDS.includes(field));
  for (const field of required) {
    if (value[field] === undefined || value[field] === null) problems.push(`missing required field: ${field}`);
  }
  if (value.schema !== HANDOFF_SCHEMA) problems.push(`schema is ${JSON.stringify(value.schema)}, expected ${HANDOFF_SCHEMA}`);
  if (value.state !== undefined && !Object.values(STATE).includes(value.state)) {
    problems.push(`state ${JSON.stringify(value.state)} is not one of ${Object.values(STATE).join(", ")}`);
  }
  if (value.root_surface_hash !== undefined && value.root_surface_hash !== null && !normalizeHash(value.root_surface_hash)) {
    problems.push("root_surface_hash is not a sha256 hex digest");
  }
  if (value.epoch_hash !== undefined && value.epoch_hash !== null && value.epoch_hash !== "" && !normalizeHash(value.epoch_hash)) {
    problems.push("epoch_hash is not a sha256 hex digest");
  }
  if (value.epoch_commit !== undefined && value.epoch_commit !== null && value.epoch_commit !== "" && !/^[0-9a-f]{40}$/.test(String(value.epoch_commit))) {
    problems.push("epoch_commit is not a git object id");
  }
  // When this run produced the branch, the two produced fields must be REAL values, not empty placeholders: a
  // handoff that says "ready" while naming no commit is a request the App cannot act on.
  if (produces) {
    if (!/^[0-9a-f]{40}$/.test(String(value.epoch_commit ?? ""))) problems.push("epoch_commit is not a git object id");
    if (!normalizeHash(value.epoch_hash)) problems.push("epoch_hash is not a sha256 hex digest");
  }
  if (value.base_sha !== undefined && value.base_sha !== null && !/^[0-9a-f]{40}$/.test(String(value.base_sha))) {
    problems.push("base_sha is not a git object id");
  }
  if (value.epoch_branch !== undefined && value.epoch_branch !== null && !/^trust-epoch\/boss-root-trust-\d+$/.test(String(value.epoch_branch))) {
    problems.push(`epoch_branch ${JSON.stringify(value.epoch_branch)} does not match trust-epoch/boss-root-trust-<epoch>`);
  }
  if (typeof value.epoch === "number" && typeof value.epoch_branch === "string" && !value.epoch_branch.endsWith(`-${value.epoch}`)) {
    problems.push(`epoch_branch ${value.epoch_branch} disagrees with epoch ${value.epoch}`);
  }

  // Section 9 B1: the checkout provenance. Half a binding is refused rather than tolerated, and a mismatch between
  // the two stated commits is the exact condition the repair exists to make impossible -- so the artifact refuses to
  // validate when it is present, rather than leaving the disagreement for a reader to notice.
  //
  // The STATED values are what is validated, not the normalized ones: `normalizeCommit` maps `"main"` and `""` to the
  // same `null`, so validating the normalized form would make a handoff that was dispatched on the literal string
  // `main` indistinguishable from one that stated nothing at all. That is the defect in miniature.
  if (value.provenance !== undefined) {
    const provenance = value.provenance;
    if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
      problems.push("provenance is present but is not an object");
    } else {
      const stated = (raw, normalized) => (raw === undefined || raw === null || raw === "" ? normalized ?? null : raw);
      const dispatchSha = stated(provenance.stated_dispatch_sha, provenance.dispatch_sha);
      const checkedOutSha = stated(provenance.stated_checked_out_sha, provenance.checked_out_sha);
      const present = (candidate) => candidate !== undefined && candidate !== null && candidate !== "";
      if (present(dispatchSha) !== present(checkedOutSha)) {
        problems.push("provenance states the dispatch SHA without the checked-out SHA, or the reverse; a half-stated checkout binding is not a binding");
      }
      for (const [name, candidate] of [["dispatch_sha", dispatchSha], ["checked_out_sha", checkedOutSha]]) {
        if (present(candidate) && !normalizeCommit(candidate)) problems.push(`provenance.${name} is not a git object id`);
      }
      if (present(dispatchSha) && present(checkedOutSha) && dispatchSha !== checkedOutSha) {
        problems.push(`provenance.dispatch_sha (${dispatchSha}) and provenance.checked_out_sha (${checkedOutSha}) disagree: the run was approved for one commit and measured another`);
      }
    }
  }

  // CREDENTIAL REFUSAL. An artifact that carried a token would put it in the Actions artifact store and in every
  // download of it, which is exactly the boundary this repair is tightening. The check is deliberately blunt: it
  // scans the serialized document for shapes that must never appear.
  const serialized = JSON.stringify(value);
  const forbidden = [
    { name: "a PEM private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: "a GitHub token", pattern: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
    { name: "an authorization header", pattern: /authorization\s*:\s*(bearer|basic)/i },
    { name: "a private key field", pattern: /"(private_?key|client_secret|app_private_key)"\s*:/i },
  ];
  for (const { name, pattern } of forbidden) {
    if (pattern.test(serialized)) problems.push(`the handoff contains ${name}, which must never be in a generated artifact`);
  }
  return { ok: problems.length === 0, problems };
}

module.exports = {
  SCHEMA_VERSION,
  HANDOFF_SCHEMA,
  STATE,
  SUCCESS_STATES,
  REQUIRED_HANDOFF_FIELDS,
  isSuccessState,
  normalizeHash,
  normalizeCommit,
  provenanceOf,
  compareEpochRecord,
  decideTerminalState,
  buildHandoff,
  validateHandoff,
};
