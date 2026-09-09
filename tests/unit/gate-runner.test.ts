import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { gateCapability, runRepoGate, discoveredTestFiles } from "../../electron/engineering/gate-runner";

/**
 * R43 Phase A (R-101): real gate execution over a workspace. Assertions:
 * absence of tooling ⇒ UNAVAILABLE (never fake evidence); applicable gates run
 * real commands and PASS/FAIL accordingly; per-gate failures never throw.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-gate-runner-")); dirs.push(dir); return dir; }

it("JS-only workspace: typecheck/build UNAVAILABLE; unit/integration run and PASS; acceptance/smoke UNAVAILABLE", async () => {
  const dir = root();
  fs.writeFileSync(path.join(dir, "all.test.cjs"), "const test=require('node:test');const assert=require('node:assert/strict');test('one',()=>assert.equal(1,1));");
  expect(discoveredTestFiles(dir)).toHaveLength(1);

  expect((await runRepoGate(dir, "typecheck")).status).toBe("UNAVAILABLE");
  expect((await runRepoGate(dir, "build")).status).toBe("UNAVAILABLE");
  expect((await runRepoGate(dir, "acceptance")).status).toBe("UNAVAILABLE");
  expect((await runRepoGate(dir, "runtime-smoke")).status).toBe("UNAVAILABLE");

  const unit = await runRepoGate(dir, "unit");
  expect(unit.status).toBe("PASS");
  const integration = await runRepoGate(dir, "integration");
  expect(integration.status).toBe("PASS");
});

it("an applicable but failing test makes unit/integration FAIL (recorded, never thrown)", async () => {
  const dir = root();
  fs.writeFileSync(path.join(dir, "broken.test.cjs"), "const test=require('node:test');const assert=require('node:assert/strict');test('broken',()=>{assert.fail('boom');});");
  const unit = await runRepoGate(dir, "unit");
  expect(unit.status).toBe("FAIL");
  expect(unit.evidence ?? unit.error).toBeTruthy();
  const integration = await runRepoGate(dir, "integration");
  expect(integration.status).toBe("FAIL");
});

it("capability resolution matches reality: tsconfig-less repo has no typecheck/build capability", () => {
  const dir = root();
  fs.writeFileSync(path.join(dir, "x.cjs"), "module.exports=1;");
  expect(gateCapability(dir, "typecheck").available).toBe(false);
  expect(gateCapability(dir, "build").available).toBe(false);
});
