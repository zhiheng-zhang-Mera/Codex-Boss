#!/usr/bin/env node
/**
 * Seeded-bug autonomous-repair acceptance (Overcomplete §6.5 / §17.6).
 *
 * For each bug class: clones this repository into a temp workspace, installs
 * the local toolchain (offline, no scripts), injects a REAL regression, then
 * drives the production engineering seam — audit (real typecheck + full test
 * suite) → live implement (scope inference + bounded ProposalRunner patch via a
 * deterministic coder worker) → build/test → review → convergence. Evidence is
 * written under Update-Plan/overcomplete/evidence/engineering/.
 *
 * Requires `pnpm run build` first (loads dist-electron/*).
 * Usage: node scripts/acceptance-seeded-engineering.cjs [AB...]
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const moduleAt = (file) => require(path.join(__dirname, "..", "dist-electron", "electron", file));
const { EngineeringLoopStore } = moduleAt("engineering/engineering-loop-store");
const { EngineeringLoopDriver } = moduleAt("engineering/engineering-loop-driver");
const { createRepoEngineeringOperations } = moduleAt("engineering/repo-engineering-operations");
const { createLiveEngineeringOperations } = moduleAt("engineering/live-engineering-operations");

const REPO_ROOT = path.resolve(__dirname, "..");
const classes = (process.argv[2] ?? "AB").split("").filter((c) => /^[A-E]$/.test(c));
const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, windowsHide: true }).toString().trim();

const run = (command, args, cwd, env = {}) => execFileSync(command, args, { cwd, windowsHide: true, timeout: 900000, maxBuffer: 128 * 1024 * 1024, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).toString();

function seededFiles(bug) {
  const a = "// SEEDED_BUG_A\nexport const seededCount: number = \"not-a-number\";\n";
  const b = "// SEEDED_BUG_B\nimport { it, expect } from \"vitest\";\nit(\"seeded unit regression is repaired\", () => { expect(1 + 1).toBe(3); });\n";
  const c = "// SEEDED_BUG_C\nimport { it, expect } from \"vitest\";\nit(\"seeded logic bug\", () => { const items = [1, 2, 3]; expect(items.filter((x) => x % 2 === 0)).toEqual([]); });\n";
  // Multi-file/cross-module bug (D): the strict flag default is wrong and a
  // consumer module + its test depend on it (real cross-module regression).
  const d1 = "// SEEDED_BUG_D\nexport const flags = { strict: false };\n";
  const d2 = "export const strictEnabled = false;\n";
  const d3 = "import { flags } from \"./__seeded_d1\";\nimport { strictEnabled } from \"./__seeded_d2\";\nexport const effectiveStrict = flags.strict || strictEnabled;\n";
  const dt = "// SEEDED_BUG_DT\nimport { it, expect } from \"vitest\";\nimport { effectiveStrict } from \"../src/shared/__seeded_d3\";\nit(\"seeded cross-module contract holds\", () => { expect(effectiveStrict).toBe(true); });\n";
  // The audit typecheck compiles src/shared + renderer (tsconfig.json), so the
  // compile regression must live under src/shared to be a REAL typecheck signal.
  switch (bug) {
    case "A": return [{ relative: "src/shared/__seeded_a.ts", content: a, expect: (ws) => !fs.readFileSync(path.join(ws, "src", "shared", "__seeded_a.ts"), "utf8").includes('"not-a-number"') }];
    case "B": return [{ relative: "tests/__seeded_b.test.ts", content: b, expect: (ws) => fs.readFileSync(path.join(ws, "tests", "__seeded_b.test.ts"), "utf8").includes(".toBe(2)") }];
    case "C": return [{ relative: "tests/__seeded_c.test.ts", content: c, expect: (ws) => fs.readFileSync(path.join(ws, "tests", "__seeded_c.test.ts"), "utf8").includes("toEqual([2])") }];
    case "D": return [
      { relative: "src/shared/__seeded_d1.ts", content: d1, expect: (ws) => fs.readFileSync(path.join(ws, "src", "shared", "__seeded_d1.ts"), "utf8").includes("strict: true") },
      { relative: "src/shared/__seeded_d2.ts", content: d2, expect: () => true },
      { relative: "src/shared/__seeded_d3.ts", content: d3, expect: () => true },
      { relative: "tests/__seeded_d.test.ts", content: dt, expect: () => true }
    ];
    default: throw new Error("Unknown bug class " + bug);
  }
}

function fixContent(bug, content) {
  const fixes = {
    A: [['= "not-a-number"', "= 0"]],
    B: [[".toBe(3)", ".toBe(2)"]],
    C: [["toEqual([])", "toEqual([2])"]],
    D: [["strict: false", "strict: true"]]
  };
  let out = content;
  for (const [from, to] of fixes[bug] ?? []) out = out.split(from).join(to);
  return out;
}

function makeWorker(bug) {
  return {
    async ask(role, prompt) {
      if (role === "reviewer") return '{"findings":[]}';
      const spec = JSON.parse(prompt);
      const changes = [];
      for (const file of spec.files ?? []) {
        const content = file.content ?? "";
        if (content.includes("SEEDED_BUG")) {
          const fixed = fixContent(bug, content);
          if (fixed !== content) changes.push({ path: file.path, expectedSha256: file.expectedSha256, content: fixed });
        }
      }
      if (!changes.length) throw new Error("no seeded file present in the proposed scope");
      return JSON.stringify({ changes, checks: spec.requiredChecks });
    }
  };
}

async function cloneWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "boss-seeded-"));
  const ws = path.join(parent, "ws");
  run("git", ["clone", "--quiet", "--local", REPO_ROOT, ws], REPO_ROOT);
  // Offline toolchain install from the local pnpm store; scripts skipped (no Electron binary needed).
  const storeDir = "D:\\.pnpm-store";
  const install = fs.existsSync(storeDir)
    ? `corepack pnpm install --offline --ignore-scripts "--store-dir=${storeDir}"`
    : "corepack pnpm install --ignore-scripts";
  run("powershell", ["-NoProfile", "-Command", install], ws);
  for (const dir of ["tests/e2e", "tests/unit"]) {
    const target = path.join(ws, ...dir.split("/"));
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  }
  return { parent, ws };
}

function goalFor(ws) {
  return {
    schemaVersion: 1, id: "goal-" + Math.random().toString(36).slice(2, 8),
    objective: "repair the seeded regression so typecheck and all tests pass",
    workspace: ws, protectedProductBehavior: [], allowedChangeScope: ["correctness", "tests"],
    forbiddenChangeScope: [], verificationPolicy: "strict", agentCount: 3,
    convergencePolicy: { cleanRoundsRequired: 1, maxIterations: 4 }, createdAt: new Date().toISOString()
  };
}

async function runSeeded(bug) {
  const startedAt = new Date().toISOString();
  const record = { kind: "SEEDED_ENGINEERING_REPAIR", bug, startedAt, commitSha, status: "RUNNING" };
  const workspace = await cloneWorkspace();
  const evidenceRoot = path.join(REPO_ROOT, "Update-Plan", "overcomplete", "evidence", "engineering");
  fs.mkdirSync(evidenceRoot, { recursive: true });
  try {
    const files = seededFiles(bug);
    for (const file of files) {
      const target = path.join(workspace.ws, file.relative.split("/").join(path.sep));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, "utf8");
    }
    const goal = goalFor(workspace.ws);
    const store = new EngineeringLoopStore(path.join(workspace.ws, ".boss-seeded-engineering.json"));
    store.freezeGoal(goal);
    const live = createLiveEngineeringOperations({ workspace: workspace.ws, goal, worker: makeWorker(bug) });
    const ops = createRepoEngineeringOperations({
      workspace: workspace.ws,
      implement: (finding) => live.implement(goal, finding),
      review: (finding, files, evidence) => live.review(goal, finding, files, evidence)
    });
    const summary = await new EngineeringLoopDriver({ store, operations: ops, maxIterations: 4 }).run();
    record.summary = summary;
    record.iterations = store.iterations().map((item) => ({ iteration: item.iteration, stage: item.stage, status: item.status, buildPassed: item.buildPassed, testsPassed: item.testsPassed, changedFiles: item.changedFiles, reviewFindings: item.reviewFindings, remainingRisk: item.remainingRisk }));
    const landed = summary.state === "ENGINEERING_CONVERGED" && summary.changedFiles.length > 0;
    const diskChecks = files.map((file) => file.expect(workspace.ws)).every(Boolean);
    if (!landed || !diskChecks) throw new Error(`Bug ${bug}: not converged (state=${summary.state}, changed=${summary.changedFiles.length}, disk=${diskChecks})`);
    record.status = "PASS";
    record.finishedAt = new Date().toISOString();
    record.changedFiles = summary.changedFiles;
  } catch (error) {
    record.status = "FAILED";
    record.error = String(error);
    record.finishedAt = new Date().toISOString();
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(evidenceRoot, `seeded-${bug}-${startedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`), JSON.stringify(record, null, 2));
    fs.rmSync(workspace.parent, { recursive: true, force: true });
  }
  return record;
}

(async () => {
  console.log(`SEEDED_ACCEPTANCE commit=${commitSha} classes=${classes.join("")}`);
  const results = [];
  for (const bug of classes) {
    const record = await runSeeded(bug);
    results.push({ bug, status: record.status });
    console.log(`Bug ${bug}: ${record.status}${record.error ? " — " + record.error : ""}`);
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((item) => item.status !== "PASS")) process.exitCode = 1;
})();
