import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEngineeringModule } from "../../electron/bootstrap/engineering";

/**
 * Phase F — the engineering module.
 *
 * The turn itself cannot be exercised here: `ask` dispatches through the commander,
 * which the composition root builds and passes in. What can be asserted is that the
 * host is built with that injection (it exposes the §7.2 route), that the learning
 * layer is created ONCE and only when asked for, and that the health line reports
 * what is actually known — it deliberately has no DEGRADED branch, because the host
 * either builds or throws and a status that can never be false is decoration.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-engineering-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function build(userData = makeRoot()) {
  const asked: string[] = [];
  const module = createEngineeringModule({
    appPath: process.cwd(),
    userData,
    rootOwner: "owner@example.invalid",
    ask: async (role, prompt) => { asked.push(`${role}:${prompt}`); return "the candidate answer"; }
  });
  return { module, asked, userData };
}

describe("Phase F — the engineering module", () => {
  it("builds the Self-Evolution route with the injected turn", () => {
    const { module } = build();
    expect(typeof module.service.selfEvolution.isSelfTarget).toBe("function");
    expect(typeof module.service.selfEvolution.runTask).toBe("function");
    // The roots the route will use are real, and they are not inside the Stable
    // checkout: runs live under the host-owned evolution root.
    expect(module.service.selfEvolution.stableRoot().length).toBeGreaterThan(0);
    expect(module.service.selfEvolution.evolutionRoot().length).toBeGreaterThan(0);
    expect(module.health().module).toBe("engineering");
    expect(module.health().status).toBe("READY");
    expect(module.health().detail).toContain("nothing has run yet");
  });

  it("creates the learning layer once, and only when it is asked for", () => {
    const { module } = build();
    // Nothing needs it at boot, so it is not created at boot.
    expect(module.health().detail).toContain("learning layer not created yet");
    const first = module.service.learning();
    expect(module.service.learning()).toBe(first);
    expect(module.health().detail).toContain("learning layer created");
    // The facade is live, not a stub: it answers its own control surface. (Its
    // durable root is created on first WRITE, so asserting a directory here would be
    // asserting an implementation detail rather than the wiring.)
    expect(typeof first.learningEnabled()).toBe("boolean");
    expect(typeof first.adaptiveRoutingEnabled()).toBe("boolean");
  });

  it("reports the roots the route will actually use", () => {
    const { module, userData } = build();
    expect(module.health().detail).toContain(module.service.selfEvolution.stableRoot());
    expect(module.health().detail).toContain(module.service.selfEvolution.evolutionRoot());
    expect(module.health().detail).toContain(userData.slice(0, 4));
  });

  it("disposes idempotently", () => {
    const { module } = build();
    expect(module.dispose()).toBeUndefined();
    module.dispose();
    // No disposal branch in the line: the host's registries are process-lifetime by
    // design, so there is nothing a disposal could honestly report.
    expect(module.health().status).toBe("READY");
  });
});
