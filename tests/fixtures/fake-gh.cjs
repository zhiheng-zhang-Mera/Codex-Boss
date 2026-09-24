#!/usr/bin/env node
/**
 * THE FAKE EXECUTOR OF THE DISPATCH-HELPER PROOF.
 *
 * The dispatch-helper tests must prove that a DRY RUN cannot reach an executor. The only way to prove that at the
 * real process boundary is to have a WORKING executor available and to show it was never invoked.
 *
 * A `.cmd` or shell wrapper cannot serve as that executor: the helper spawns argv arrays with no shell
 * (`shell: true` would make an operator-supplied `--reason` injectable), and on Windows a `.cmd` is not resolvable
 * by CreateProcess without PATHEXT. A fake executor that cannot be reached would make every "it never dispatched"
 * assertion vacuous.
 *
 * So the fake is a PRELOAD, and it counts DEPTH to tell the CLI under test from the CLI's children:
 *
 *   - The test sets `NODE_OPTIONS=--require=<this file>`, so this file runs in every process in the tree.
 *   - The first process to load it (`FAKE_GH_DEPTH` unset) is the CLI under test. This shim arms the next level and
 *     gets out of the way, so the CLI is not replaced by its own fixture -- which is what keeps the "a confirmed run
 *     DOES reach the executor" case from being vacuous.
 *   - A process that loads it with the depth ALREADY set is something the CLI spawned. That process is the executor
 *     being faked: its argv is recorded and it is killed with the requested status before it can run anything.
 *     `process.exit` rather than `process.exitCode` is deliberate -- the child must not be able to continue after
 *     the recorder has run, whatever it is.
 *
 * The depth counter is what makes this distinction without depending on PATH, on PATHEXT, or on the child being a
 * shell script. It also makes the fixture self-checking: if the CLI were replaced by the recorder, the "confirmed
 * run" case would find an empty log and fail loudly instead of passing for the wrong reason.
 */

"use strict";

const fs = require("node:fs");

const LOG = process.env.FAKE_GH_LOG;

/** The depth this process was loaded at: 1 means the CLI itself, higher means something it spawned. */
function depth() {
  // The environment value is read ONCE, and its absence is distinguished from zero on purpose: "not armed" is a
  // different state from "armed at depth 0", and collapsing the two is how a fixture starts recording its own runner.
  const raw = process.env.FAKE_GH_DEPTH;
  if (raw === undefined || raw === "") return 0;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

if (LOG) {
  const current = depth();
  if (current === 0) {
    // THE CLI UNDER TEST. Arm the next level and continue.
    process.env.FAKE_GH_DEPTH = "1";
  } else {
    // A CHILD OF THE CLI: this is an executor. Record it, then refuse to run it.
    const status = Number(process.env.FAKE_GH_STATUS ?? 0);
    try {
      // Append, never truncate: the tests count invocations, and a truncating recorder could hide a second call.
      //
      // `slice(1)` rather than `slice(2)`: `process.argv[1]` is this shim, and everything after it is the command
      // that was asked for. The preload runs before Node has finished preparing `process.argv`, so when this shim is
      // loaded by `--require` the tail can legitimately be EMPTY -- and the case that proves the recorder works is a
      // spawn of `node -e`, whose argv tail is not the command anyway. Recording whatever is visible, and never
      // silently recording nothing, is what keeps the fixture from failing open.
      const visible = process.argv.slice(1).join(" ");
      fs.appendFileSync(LOG, `${visible === "" ? `<no-argv:${process.execPath}>` : visible}\n`, "utf8");
    } catch {
      // A recorder that cannot write must not let the child continue as if it had been recorded.
      process.exit(97);
    }
    process.exit(Number.isInteger(status) ? status : 0);
  }
}

module.exports = {};
