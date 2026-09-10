#!/usr/bin/env node
/**
 * DEPRECATED (Host-A §6): the legacy soak harness must NOT be the final
 * acceptance authority. It wrote a bare `status: PASS` artifact without run
 * identity, a deterministic fault schedule, required counters or a continuity
 * proof — none of which the hardened R-901 evidence validator accepts.
 *
 * This file is kept only as a fail-closed compatibility shim: it refuses to run
 * on its own and points at the hardened engine instead.
 *
 *   Hardened engine:  node scripts/r901-soak.cjs [...]
 *   Durable runner:   powershell -NoProfile -File scripts/start-r901-soak.ps1
 *
 * The old behaviour is deliberately removed rather than silently delegated so a
 * stale caller can never produce a non-authoritative R-901 PASS artifact again.
 */
console.error(
  [
    "R901_LEGACY_HARNESS_DISABLED",
    "scripts/closure-soak-2h.cjs is deprecated (Host-A §6) and cannot produce acceptance evidence.",
    "",
    "Use the hardened harness instead:",
    "  formal (>=7200s):  node scripts/r901-soak.cjs --seconds 7200",
    "  quick validation:  node scripts/r901-soak.cjs --validate-only --validate-seconds 90",
    "  durable detached:  powershell -NoProfile -File scripts/start-r901-soak.ps1",
    "",
    "Acceptance evidence is r901-<runId>.json + r901-<runId>.heartbeat.jsonl and is",
    "judged only by the dedicated R-901 validator.",
  ].join("\n"),
);
process.exit(2);
