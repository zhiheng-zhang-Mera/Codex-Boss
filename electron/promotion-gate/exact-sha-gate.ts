import { candidateHeadSha } from "../stable-candidate/workspace-manager";
import { evaluateExactShaBinding, type ExactShaBinding, type ExactShaVerdict } from "../../src/shared/root-authority/promotion-state";

/**
 * Exact-SHA gate (Update-Plan/Isolation-Finalization.md §11.2, §14 RT-14/RT-15).
 *
 * The pure rule lives in `src/shared/root-authority/promotion-state.ts`. This is
 * the host half: it reads the Candidate's *actual* HEAD from git and refuses to
 * evaluate a binding whose recorded head no longer matches reality. Without this
 * step the four SHAs could all agree on a value that the workspace has already
 * moved away from — a self-consistent lie.
 */

export interface ExactShaGateResult extends ExactShaVerdict {
  /** HEAD observed in the Candidate workspace at gate time. */
  observedCandidateHeadSha: string | null;
}

export class ExactShaGate {
  constructor(private readonly workspace: string) {}

  /**
   * Evaluates the binding against the live workspace.
   *
   * Returns `SHA_MISMATCH` when the workspace HEAD has moved away from
   * `binding.candidateHeadSha`; the caller must re-run validation rather than
   * reuse the previous PASS (§11.2 "旧 PASS 作废").
   */
  async evaluate(binding: ExactShaBinding): Promise<ExactShaGateResult> {
    let observed: string | null = null;
    try {
      observed = await candidateHeadSha(this.workspace);
    } catch {
      observed = null;
    }
    if (!observed) {
      return { ok: false, code: "SHA_MISSING", detail: "the candidate workspace has no resolvable HEAD", observedCandidateHeadSha: null };
    }
    if (binding.candidateHeadSha && binding.candidateHeadSha !== observed) {
      return {
        ok: false,
        code: "SHA_MISMATCH",
        detail: `candidate workspace HEAD ${observed.slice(0, 12)} no longer matches the recorded candidateHeadSha ${binding.candidateHeadSha.slice(0, 12)}; the previous validation is void`,
        observedCandidateHeadSha: observed
      };
    }
    const verdict = evaluateExactShaBinding({ ...binding, candidateHeadSha: observed });
    return { ...verdict, observedCandidateHeadSha: observed };
  }
}

/**
 * §11.2 invalidation for stored evidence: after a head movement, any previously
 * recorded CI PASS for the old SHA must be discarded before re-evaluation.
 */
export function invalidateStaleEvidence(binding: ExactShaBinding, observedHead: string): ExactShaBinding {
  if (binding.ciValidatedSha && binding.ciValidatedSha !== observedHead) {
    return { ...binding, ciValidatedSha: null, prHeadSha: binding.prHeadSha === observedHead ? binding.prHeadSha : null };
  }
  return binding;
}
