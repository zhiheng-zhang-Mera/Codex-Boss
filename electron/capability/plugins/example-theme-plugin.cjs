/**
 * The bundled `ui.theme` example plugin (platform foundation, Phase 03 gate 5).
 *
 * A real plugin running across the real boundary: it is loaded by `plugin-host.ts` into a child
 * process under Node's permission model, and it can only act by calling `boss.invoke`, which the
 * broker answers. It exists to prove the boundary works on something harmless before anything
 * dangerous is allowed near it.
 *
 * ## What it demonstrates
 *
 *  - a plugin CAN do its job: read the active theme and propose another one;
 *  - a plugin CANNOT reach the machine: the `selfTest()` it reports is measured inside its own
 *    process, and the escape suite asserts on it;
 *  - a plugin CANNOT use a capability it was not granted: it asks for the filesystem, the shell,
 *    the network, a credential and `github.write`, and every one comes back denied by the broker
 *    rather than by its own restraint.
 *
 * ## What is deliberately absent
 *
 * No `require`, no `import`, no `process` and no filesystem access. The runner passes exactly three
 * names into this function — `module`, `exports` and `boss` — so a plugin cannot even name the
 * things it is not allowed to have.
 */

const THEME_CAPABILITY = "ui.theme";

/** Capabilities this plugin attempts and expects to be refused, recorded for the artifact. */
const ATTEMPTS = [
  { capability: "project.files", action: "read", resource: "project:workspace/package.json", label: "read a project file" },
  { capability: "process.exec", action: "spawn", resource: "process:shell", label: "start a child process" },
  { capability: "network.fetch", action: "request", resource: "network:api.example.com", label: "make a network request" },
  { capability: "credential.use", action: "use", resource: "credential:github", label: "use a stored credential" },
  { capability: "github.write", action: "commit.push", resource: "repo:owner/name", label: "push a commit" },
  { capability: "email.send", action: "send", resource: "email:owner", label: "send mail" }
];

exports.create = function create() {
  const state = { reads: 0, proposals: 0, refusals: [] };

  /**
   * Attempt every capability this plugin should not have, and report the outcome.
   *
   * The plugin is not asked to behave; it is asked to TRY. Each answer comes from the broker, so
   * the result is evidence about the boundary rather than about the plugin's manners.
   */
  async function probe() {
    const results = [];
    for (const attempt of ATTEMPTS) {
      const answer = await boss.invoke({ capability: attempt.capability, action: attempt.action, resource: attempt.resource });
      results.push({
        label: attempt.label,
        capability: attempt.capability,
        allowed: answer.allowed === true,
        reason: answer.reason ?? (answer.allowed ? "ALLOWED" : "denied")
      });
      if (answer.allowed !== true) state.refusals.push(attempt.capability);
    }
    return results;
  }

  return {
    /**
     * Called by the host for each capability invocation the BROKER authorized.
     *
     * `respond` is how a plugin settles a call it could not answer synchronously. A plugin's work
     * usually needs to go BACK through `boss.invoke` — that is the point of the boundary — so the
     * result cannot also be this function's return value. The first version returned the value
     * directly, which silently discarded an awaited `boss.invoke` and reported only `{handled:true}`.
     */
    async onInvoke(request, respond) {
      if (request.capability !== THEME_CAPABILITY) {
        return { handled: false, detail: `this plugin only handles ${THEME_CAPABILITY}` };
      }
      if (request.action === "read") {
        state.reads++;
        const answer = await boss.invoke({ capability: THEME_CAPABILITY, action: "read", resource: "ui.theme:current" });
        respond({ handled: true, theme: answer.allowed ? answer.result : { denied: answer.reason } });
        return;
      }
      if (request.action === "propose") {
        state.proposals++;
        const answer = await boss.invoke({
          capability: THEME_CAPABILITY,
          action: "propose",
          resource: "ui.theme:proposal",
          input: request.input ?? { name: "example", tokens: { accent: "#8ab4f8" } }
        });
        respond({ handled: true, proposal: answer.allowed ? answer.result : { denied: answer.reason } });
        return;
      }
      /**
       * Attempt every capability this plugin should not have, and report the outcome.
       *
       * The plugin is not asked to behave; it is asked to TRY, and every answer comes from the
       * broker over the real channel. This exists so the escape suite can drive the probe from
       * outside rather than trusting the plugin's own summary of itself.
       */
      if (request.action === "probe") {
        const results = await probe();
        // The sandbox's own verdict travels with the probe, measured INSIDE this process. Reported
        // here rather than only on a health message so a caller gets the evidence in one round trip
        // — the first version left it on a channel nothing asked for, and the report recorded `null`
        // for the very evidence it was supposed to contain.
        respond({ handled: true, probes: results, sandbox: boss.selfTest() });
        return;
      }
      return { handled: false, detail: `unsupported action ${request.action}` };
    },

    /**
     * Attempt every capability this plugin should not have.
     *
     * Exposed as `probeBoundary` for a caller that reaches it directly, and reached through the
     * `probe` action over the channel by the escape suite.
     */
    async probeBoundary() {
      return probe();
    },

    health() {
      return {
        status: "READY",
        detail: `example theme plugin: ${state.reads} read(s), ${state.proposals} proposal(s), ${state.refusals.length} refused attempt(s)`
      };
    },

    dispose() {
      // Nothing durable is held, so disposal is a state change rather than a resource release.
      state.reads = 0;
      state.proposals = 0;
    },

    /** The sandbox measured from inside the child process. */
    selfTest() {
      return boss.selfTest();
    }
  };
};
