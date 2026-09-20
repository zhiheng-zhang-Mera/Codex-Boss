/**
 * Runtime Intelligence Plane — the policy registry and the four evidence identities.
 *
 * From this phase onward no policy is tuned against the corpus that produced it. A policy has an
 * identity, a status, and the commit and corpus version it was frozen against, so the question
 * "which version performed how, on which data?" is answerable later without archaeology.
 *
 * Four identities, kept apart on purpose:
 *
 *   FROZEN_POLICY          a policy under prospective observation; changing it silently is the
 *                          failure this registry exists to prevent
 *   CANDIDATE_POLICY       a proposed successor, evaluated beside the frozen one
 *   PROSPECTIVE_EVIDENCE   evidence produced by tasks that began AFTER the freeze
 *   RETROSPECTIVE_EVIDENCE evidence from the corpus a policy was chosen against
 *
 * The distinction is not bookkeeping. A retrospective result can always be improved by looking
 * at it again; only prospective evidence can say whether a fix generalises, and the two must
 * never be reported as one number.
 */

import { sha256Hex } from "../hash";
import { ADVISOR_WEIGHTS, TASK_KIND_PRIMARY_DIMENSION } from "./scheduling-advisor";
import { SKILL_STATE_RANK, SKILL_THRESHOLDS } from "./skill-loadout";
import { CONFIDENCE_CAP, CONFIDENCE_K, DEFAULT_PRIOR_STRENGTH } from "./model-ledger";
import { CALIBRATION_BIAS_THRESHOLD, CALIBRATION_BUCKET_COUNT, MIN_SAMPLES_FOR_CALIBRATION } from "./calibration";
import { continuationPolicyHash } from "./continuation-evaluator";

/** A policy's lifecycle status. Only a candidate may be changed, and only by a new identity. */
export const POLICY_STATUSES = ["FROZEN_FOR_PROSPECTIVE_VALIDATION", "CANDIDATE", "RETIRED"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/** What an evidence record is evidence of. A record claims exactly one of these. */
export const EVIDENCE_CLASSES = ["FROZEN_POLICY", "CANDIDATE_POLICY", "PROSPECTIVE_EVIDENCE", "RETROSPECTIVE_EVIDENCE"] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export type PolicyArea = "continuation" | "scheduler" | "skill-loadout" | "confidence";

export interface PolicyIdentity {
  policyId: string;
  policyHash: string;
  policyArea: PolicyArea;
  status: PolicyStatus;
  /**
   * The instant this identity's rules took effect. A task opened before it is retrospective.
   * Optional only because every policy in this registry was frozen at the same moment; the
   * resolver below supplies that instant.
   */
  frozenAt?: string;
  /** The commit the policy was frozen at. Absent for a candidate that is not frozen yet. */
  frozenAtCommit?: string;
  /** The corpus version it was frozen against, so a later comparison cannot be confused. */
  frozenAtCorpusVersion?: string;
  note: string;
}

/**
 * The commit `continuation-policy-v1` was frozen at, and the corpus version the retrospective
 * result belongs to.
 *
 * A frozen policy records the commit it was frozen at rather than being assumed unchanged:
 * `policyHash` proves the rules, and this proves when the freeze happened.
 */
export const CONTINUATION_V1_FROZEN_AT_COMMIT = "8b25f6a113f250d17bb90f67c585c9604db6efc2";

/**
 * The instant the freeze took effect, taken from that commit's own committer timestamp.
 *
 * A task that OPENED before this instant cannot be prospective evidence about the frozen policy,
 * however convenient it would be, and the comparison is what makes that decidable rather than a
 * matter of intent.
 */
export const CONTINUATION_V1_FROZEN_AT = "2026-09-19T20:44:35+10:00";

export const RETROSPECTIVE_CORPUS_VERSION = "retrospective-corpus-v1";

/** A fingerprint of a policy's identity from the constants that define it. */
export function policyFingerprint(policyId: string, parts: readonly (string | number)[]): string {
  return sha256Hex([`runtime-intelligence-policy-1`, policyId, ...parts.map((part) => String(part))].join("\n"));
}

/**
 * The identity of every policy the plane runs.
 *
 * The continuation hashes come from the evaluator itself, so this registry cannot disagree with
 * the code that decides; the other three are fingerprinted from the constants that define them,
 * which makes "the policy changed" detectable rather than remembered.
 */
export function policyRegistry(): PolicyIdentity[] {
  return [
    {
      policyId: "continuation-policy-v0",
      policyHash: continuationPolicyHash("continuation-policy-v0"),
      policyArea: "continuation",
      status: "RETIRED",
      frozenAtCommit: CONTINUATION_V1_FROZEN_AT_COMMIT,
      frozenAtCorpusVersion: RETROSPECTIVE_CORPUS_VERSION,
      note: "the measured baseline: STOP was the fallback, which produced a 0.5 false-stop rate. Kept runnable so the comparison stays re-measurable; never to be restored."
    },
    {
      policyId: "continuation-policy-v1",
      policyHash: continuationPolicyHash("continuation-policy-v1"),
      policyArea: "continuation",
      status: "FROZEN_FOR_PROSPECTIVE_VALIDATION",
      frozenAtCommit: CONTINUATION_V1_FROZEN_AT_COMMIT,
      frozenAtCorpusVersion: RETROSPECTIVE_CORPUS_VERSION,
      note: "STOP requires positive completion evidence and the no-rule fallback is CONTINUE. Retrospectively false-stop 0.0 against the baseline's 0.5; frozen here so prospective tasks decide whether it generalises."
    },
    {
      policyId: "scheduler-policy-v0",
      policyHash: policyFingerprint("scheduler-policy-v0", [
        ...Object.entries(ADVISOR_WEIGHTS).map(([key, value]) => `${key}=${value}`),
        ...Object.entries(TASK_KIND_PRIMARY_DIMENSION).map(([key, value]) => `${key}=${value}`)
      ]),
      policyArea: "scheduler",
      status: "FROZEN_FOR_PROSPECTIVE_VALIDATION",
      frozenAtCommit: CONTINUATION_V1_FROZEN_AT_COMMIT,
      frozenAtCorpusVersion: RETROSPECTIVE_CORPUS_VERSION,
      note: "frozen with the ranking untouched: the retrospective lift is 0 because every real dispatch succeeded, which is a statement about the corpus and not a reason to tune the ranking."
    },
    {
      policyId: "skill-loadout-policy-v0",
      policyHash: policyFingerprint("skill-loadout-policy-v0", [
        ...Object.entries(SKILL_THRESHOLDS).map(([key, value]) => `${key}=${value}`),
        ...Object.entries(SKILL_STATE_RANK).map(([key, value]) => `${key}=${value}`)
      ]),
      policyArea: "skill-loadout",
      status: "FROZEN_FOR_PROSPECTIVE_VALIDATION",
      frozenAtCommit: CONTINUATION_V1_FROZEN_AT_COMMIT,
      frozenAtCorpusVersion: RETROSPECTIVE_CORPUS_VERSION,
      note: "frozen with no real skill-usage data to evaluate it on; the loadout algorithm is not touched until such data exists."
    },
    {
      policyId: "confidence-policy-v0",
      policyHash: policyFingerprint("confidence-policy-v0", [
        `confidence-k=${CONFIDENCE_K}`,
        `confidence-cap=${CONFIDENCE_CAP}`,
        `prior-strength=${DEFAULT_PRIOR_STRENGTH}`,
        `calibration-buckets=${CALIBRATION_BUCKET_COUNT}`,
        `calibration-bias-threshold=${CALIBRATION_BIAS_THRESHOLD}`,
        `calibration-min-samples=${MIN_SAMPLES_FOR_CALIBRATION}`
      ]),
      policyArea: "confidence",
      status: "FROZEN_FOR_PROSPECTIVE_VALIDATION",
      frozenAtCommit: CONTINUATION_V1_FROZEN_AT_COMMIT,
      frozenAtCorpusVersion: RETROSPECTIVE_CORPUS_VERSION,
      note: "the confidence function is frozen unchanged. The retrospective corpus is underconfident, and a calibration transform fitted to it would be fitted to five tasks."
    }
  ];
}

/** One policy's identity, or `undefined` for an id this registry does not know. */
export function policyIdentity(policyId: string): PolicyIdentity | undefined {
  return policyRegistry().find((entry) => entry.policyId === policyId);
}

export interface PolicyIdentityCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Checks a record's claimed policy identity against the registry.
 *
 * A record whose hash does not match the registry is refused rather than relabelled: it was
 * produced by different rules, so attributing it to this policy would be a false attribution.
 */
export function checkPolicyIdentity(claim: { policyId: string; policyHash: string }): PolicyIdentityCheck {
  const identity = policyIdentity(claim.policyId);
  if (identity === undefined) return { ok: false, problems: [`policy ${claim.policyId} is not in the registry, so its evidence cannot be attributed`] };
  if (identity.policyHash !== claim.policyHash) {
    return { ok: false, problems: [`policy ${claim.policyId} hashes to ${identity.policyHash} but the record claims ${claim.policyHash}, so the rules that produced it have changed`] };
  }
  return { ok: true, problems: [] };
}

/**
 * Classifies a record into exactly one evidence class.
 *
 * A prospective record is one whose task OPENED after the freeze commit was in place; anything
 * else is retrospective, whatever it was labelled. The `frozenAtCommit` comparison is what makes
 * that decidable rather than a matter of the author's intent.
 */
export function classifyEvidence(record: { openedAt: string; policyId: string; claim?: EvidenceClass }): EvidenceClass {
  const identity = policyIdentity(record.policyId);
  if (identity === undefined) return "RETROSPECTIVE_EVIDENCE";
  if (record.claim === "CANDIDATE_POLICY") return "CANDIDATE_POLICY";
  if (record.claim === "RETROSPECTIVE_EVIDENCE") return "RETROSPECTIVE_EVIDENCE";
  if (identity.status !== "FROZEN_FOR_PROSPECTIVE_VALIDATION") return "RETROSPECTIVE_EVIDENCE";
  const opened = Date.parse(record.openedAt);
  const frozen = Date.parse(identity.frozenAt ?? CONTINUATION_V1_FROZEN_AT);
  if (!Number.isFinite(opened) || !Number.isFinite(frozen)) return "RETROSPECTIVE_EVIDENCE";
  // A task that opened before the freeze is retrospective by definition, whatever it claims.
  return opened >= frozen ? "PROSPECTIVE_EVIDENCE" : "RETROSPECTIVE_EVIDENCE";
}

/** The frozen continuation policy under observation, which is the one prospective work targets. */
export function frozenContinuationPolicy(): PolicyIdentity {
  const identity = policyIdentity("continuation-policy-v1");
  if (identity === undefined) throw new Error("the continuation policy registry is missing its frozen entry");
  return identity;
}
