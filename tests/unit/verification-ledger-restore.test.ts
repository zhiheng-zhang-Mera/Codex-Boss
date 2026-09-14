import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createVerificationEngine } from "../../electron/engineering/verification-engine";

/**
 * Phase H — an evidence ledger that cannot be read is not an empty ledger.
 *
 * The engine's behaviour is right and stays: a ledger it cannot parse means this
 * run starts from no evidence, so a requirement it cannot verify stays
 * NOT_VERIFIED rather than being credited with evidence nobody read. What was
 * wrong is that the two facts produced the same answer — "there is no ledger yet"
 * and "there is a ledger this build cannot parse" — and the comment on the loader
 * claimed a distinction the code did not make. A gate that fails for the second
 * reason has to say so, or the operator reads "unverified" as "no evidence exists"
 * when the evidence is on disk.
 */

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-ledger-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function engineFor(root: string, ledgerPath: string) {
  return createVerificationEngine({
    root,
    ledgerPath,
    commands: { syntax: "node --check", build_tools: [] },
    targets: { syntax: [], unit: [], module: [], integration: [] },
    harnesses: {},
    host: "unit-host"
  });
}

describe("Phase H — the verification engine's ledger", () => {
  it("says nothing when there is no ledger yet", () => {
    const root = makeTree();
    const engine = engineFor(root, path.join(root, "ledger.json"));
    expect(engine.ledgerDiagnostic()).toBeUndefined();
    expect(engine.ledger().entries).toEqual([]);
  });

  it("reports a ledger it cannot read, and still starts from no evidence", () => {
    const root = makeTree();
    const ledgerPath = path.join(root, "ledger.json");
    fs.writeFileSync(ledgerPath, "{ truncated", "utf8");
    const engine = engineFor(root, ledgerPath);
    expect(engine.ledger().entries).toEqual([]);
    expect(engine.ledgerDiagnostic()).toBeTruthy();
    // The unreadable file is left exactly as it was for inspection.
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe("{ truncated");
  });

  it("reports a ledger whose shape is wrong rather than a parse error", () => {
    const root = makeTree();
    const ledgerPath = path.join(root, "ledger.json");
    fs.writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, version: "evidence-ledger-99", entries: [] }), "utf8");
    const engine = engineFor(root, ledgerPath);
    expect(engine.ledger().entries).toEqual([]);
    expect(engine.ledgerDiagnostic()).toContain("evidence-ledger");
  });

  it("reads a ledger this build wrote, with no diagnostic", () => {
    const root = makeTree();
    const ledgerPath = path.join(root, "ledger.json");
    const written = engineFor(root, ledgerPath);
    // A real save goes through the engine's own writer, so the round trip is the
    // production one rather than a hand-built envelope.
    const first = written.ledger();
    fs.writeFileSync(ledgerPath, JSON.stringify(first), "utf8");
    const reopened = engineFor(root, ledgerPath);
    expect(reopened.ledgerDiagnostic()).toBeUndefined();
    expect(reopened.ledger().version).toBe(first.version);
  });
});
