# Prestart completion — `PRESTART_CERTIFIED` / `BOOTSTRAP_COMPLETE`

**Documentation records the certification; it does not constitute the certification.**

The authority is `artifacts/acceptance/prestart-attestation.json` produced by
`pnpm run acceptance:prestart` inside a successful CI run, together with that run.
This page is the durable, human-readable record of that run.

---

## 1. The certified run

| Field | Value |
| --- | --- |
| State | `PRESTART_CERTIFIED` |
| Bootstrap | `BOOTSTRAP_COMPLETE` |
| Certified commit | `ed9ce13cce7bca519cf2cc7c9c797d31e705318c` |
| Branch | `Prestart-checkpoint-3` |
| CI run | [`34695416659`](https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/34695416659) (success, 6m47s) |
| CI artifact | `prestart-attestation` (ID `10298755851`) |
| Session | `session-2026-09-12T130744824-b046578f` |
| Prestart root hash | `fd0867a50e9343712ba7952ab2336b809d05bb0cd670c7edda1f43883f55636e` |
| Gates | 16 / 16 trusted PASS (each with a valid attestation) |
| Desktop black box | 89 / 89 claims PASS under `desktop-blackbox-1` |
| Capabilities | 13 / 13 established from trusted evidence |
| Owner interventions | 0 (derived from `owner-interventions.json`, not supplied) |
| Provenance | `SAME_SESSION` / `SAME_COMMIT`, all source hashes verified |
| Adversarial acceptance | PASS, 20 mutations refused, false positives 0 |
| Trust suites | 5 / 5 PASS (EI, DB, OI, RA, AD) |

The terminal output of the authoritative run:

```
[prestart] certification session: session-2026-09-12T130744824-b046578f
[prestart] commit: ed9ce13cce7bca519cf2cc7c9c797d31e705318c

[prestart] gate evidence        16/16 PASS
[prestart] source integrity     19/19 VERIFIED
[prestart] desktop black box    89/89 PASS
[prestart] capabilities         13/13 ESTABLISHED
[prestart] owner intervention   0
[prestart] provenance           SAME_SESSION / SAME_COMMIT
[prestart] mutation defense     PASS
[prestart] root manifest        VERIFIED
[prestart] trust suites         5/5 PASS

[prestart] certificate          artifacts/acceptance/prestart-attestation.json
[prestart] root hash            fd0867a50e9343712ba7952ab2336b809d05bb0cd670c7edda1f43883f55636e

[prestart] PRESTART_CERTIFIED
[prestart] BOOTSTRAP_COMPLETE
```

## 2. What was actually proven

1. **One run, one commit.** `acceptance:session:start -- --certify --clean` refused
   to start unless the working tree was clean, fixed the commit, minted
   `session_id` and archived the previous run's evidence into
   `artifacts/acceptance/history/<session_id>/`. Every piece of evidence below is
   bound to that session and that commit; a stale or foreign artifact is refused
   (`EI-03`, `EI-11`, `EI-12`, `RA-05`, `RA-06`, `AD-13`, `AD-14`).
2. **Every gate report was strictly validated.** Schema version, non-empty unit,
   unique ids, every required id PASS, no FAIL, no undeclared NOT_RUN, consistent
   totals and `passed === true` — a report that is merely present is not evidence
   (`EI-04`..`EI-09`, `AD-03`..`AD-11`).
3. **Every report was hash-bound to its attestation.** `acceptance:attest` wrote
   `artifacts/acceptance/attestations/<gate>.json` with the report's SHA-256, the
   contract version, the required-id digest, the session and the commit. Changing a
   source after attestation invalidates the evidence (`EI-10`, `RA-03`, `RA-04`,
   `DB-12`, `AD-12`).
4. **The real desktop application satisfied its complete claim contract.** The
   Electron black box ran under `desktop-blackbox-1` with 89 stable `DB-###` claims
   and had to report exactly that set — `{}`, one claim, 88/89, one FAIL/NOT_RUN,
   a lying total, a duplicate id or a tampered contract digest are all refused
   (`DB-01`..`DB-12`, `AD-15`..`AD-17`). Live third-party AI providers remain
   explicitly out of Prestart scope (`WB-LIVE-PROVIDER` is declared NOT_RUN in the
   workbook contract, recorded in every attestation).
5. **Thirteen capabilities came from trusted evidence only.** A capability is
   established when every gate the contract maps to it has a trusted PASS; a
   deleted report or attestation removes the capability (`RA-09`, `AD-20`).
6. **Zero Owner interventions is a derived fact.** The count is the event count of
   the run's `owner-interventions.json`; the root API has no parameter for it, the
   audit takes the ledger instead, and one recorded event turns a 16/16 green run
   into `INCOMPLETE` (`OI-01`..`OI-10`, `RA-08`, `AD-18`, `AD-19`).
7. **The decision is sealed.** `bootstrap-completion.json` (schemaVersion 2)
   carries the source manifest — sixteen gates, the black box, the Owner ledger and
   the session manifest, each with its SHA-256 — and a `root_hash` over the
   canonical manifest, so any change to a source changes the root result
   (`RA-11`, `RA-12`).
8. **Hostile evidence cannot pass.** Twenty mutations of real files were applied
   and all were refused by the real host auditor; the single clean positive control
   was accepted. `false_positive_cases = 0` (`AD-01`..`AD-POSITIVE`).

## 3. How to reproduce

```bash
pnpm run build && pnpm test
pnpm run acceptance:session:start -- --certify --clean
pnpm run acceptance:workbook   && pnpm run acceptance:attest -- acceptance-workbook
# … the same pair for the other fifteen gates …
pnpm run acceptance:desktop-workbook && pnpm run acceptance:attest -- acceptance-desktop-workbook
pnpm run acceptance:bootstrap-completion
pnpm run acceptance:evidence-integrity && pnpm run acceptance:attest -- acceptance-evidence-integrity
pnpm run acceptance:desktop-contract  && pnpm run acceptance:attest -- acceptance-desktop-contract
pnpm run acceptance:owner-ledger      && pnpm run acceptance:attest -- acceptance-owner-ledger
pnpm run acceptance:root-hardening    && pnpm run acceptance:attest -- acceptance-root-hardening
pnpm run acceptance:adversarial       && pnpm run acceptance:attest -- acceptance-adversarial
pnpm run acceptance:prestart
```

A dirty working tree refuses certification; a development session
(`acceptance:session:start` without `--certify`) can run every suite but can never
print `PRESTART_CERTIFIED`.

If a run does not go green, the reasons to fix are the machine reasons the audit
printed. Reducing required ids, deleting a hostile test, accepting a missing
`passed`, allowing a NOT_RUN, defaulting the Owner count, editing a generated
attestation or marking the progress document complete are not options.

## 4. Scope boundary

Prestart proves the product path under the acceptance provider / deterministic
environment: the real Electron application, the sixteen delivery gates, the trust
boundary around their evidence, and the trusted root audit. Live third-party AI
providers, new model providers and every new capability are Post-Prestart.

**Prestart ends here (CP24). The next phase is Post-Prestart: Self-Iteration /
Operational Bootstrap.**
