#!/usr/bin/env node
/**
 * Phase 0 §4.3 — Electron WorkBook black-box smoke.
 *
 * Update-Plan/checkpoint-1.md §4.3 requires one REAL desktop pass:
 *
 *   Launch
 *   → enter Work mode
 *   → select workspace
 *   → attach executable WorkBook
 *   → empty/minimal prompt
 *   → intake
 *   → task contract
 *   → dispatch boundary
 *
 * and it must prove UI → IPC → main process → WorkBook production path is
 * genuinely connected — "不得再只依赖 direct function call".
 *
 * This script is the black box. It launches the ordinary Electron app with a
 * throwaway `--boss-data-dir` and a remote-debugging port, then drives ONLY the
 * renderer over the Chrome DevTools Protocol: it clicks the real Work switch,
 * types the real workspace field, adds a provider through the real composer
 * form, drops a real File onto the real attachment tray and clicks the real
 * submit button. Nothing in the app is told what to execute, and no production
 * function is called directly.
 *
 * The main-process truth is then read from the durable files the app wrote
 * (`state.json`, `.boss/workbook-registry.json`) rather than from anything the
 * renderer claims:
 *
 *   - the executable WorkBook was classified, ingested and compiled into a
 *     Task Contract, and the intake stage ladder is complete;
 *   - the dispatch boundary was reached: a dispatch checkpoint exists for the
 *     task and was rolled back WITH a message, i.e. provider work was really
 *     attempted and honestly refused rather than faked;
 *   - no artifact, final response or "completed" status was fabricated for the
 *     task, and the registry revision is linked to the real task id.
 *
 * Bounded provider: the app runs with `--boss-offline-providers`, so provider
 * panes are real WebContentsViews that are never navigated, and the smoke uses
 * a custom provider (no adapter). Acceptance therefore never contacts a live AI
 * page and never sends a message to one; the dispatch boundary result it
 * records is the honest refusal of that bounded provider. Live provider
 * execution stays explicitly NOT_RUN — see `externalLiveProviderExecution` in
 * the report.
 *
 * Usage: node scripts/acceptance-desktop-workbook.cjs
 */
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const PROJECT = path.resolve(__dirname, "..");
const ROOT = path.join(PROJECT, "artifacts", "desktop-workbook-" + randomUUID());
const DATA_ROOT = path.join(ROOT, "data");
const WORKSPACE = path.join(ROOT, "workspace");
const RESULT_FILE = path.join(ROOT, "desktop-workbook-smoke.json");
const REPORT_FILE = path.join(ROOT, "desktop-workbook-smoke.md");
const SCREENSHOT_FILE = path.join(ROOT, "desktop-workbook-smoke.png");
const STATE_FILE = path.join(DATA_ROOT, "state.json");
const REGISTRY_FILE = path.join(DATA_ROOT, ".boss", "workbook-registry.json");
const KNOWLEDGE_FILE = path.join(DATA_ROOT, ".boss", "knowledge-base.json");

const WORKBOOK_NAME = "latency-guard-workbook.md";
const WORKBOOK_TEXT = [
  "# Bounded desktop smoke work book",
  "",
  "## Goal",
  "Add a per-request latency guard to the checkout handler so slow gateway calls fail fast.",
  "",
  "## Scope",
  "- checkout request handler",
  "- gateway adapter retry budget",
  "",
  "## Deliverables",
  "- latency guard module",
  "- gateway timeout wiring",
  "",
  "## Acceptance Criteria",
  "- [ ] AC-1 the guard aborts a gateway call that exceeds its budget",
  "- [ ] AC-2 the checkout response reports the aborted call"
].join("\n");

const CUSTOM_PROVIDER_NAME = "Bounded Acceptance Provider";
/** https-only by policy; never navigated in this mode, so it is never fetched. */
const CUSTOM_PROVIDER_URL = "https://bounded-provider.invalid/chat";

const SETTLE_TIMEOUT_MS = 120_000;
const BOOT_TIMEOUT_MS = 90_000;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function prepareFixtures() {
  fs.mkdirSync(path.join(WORKSPACE, "src"), { recursive: true });
  fs.mkdirSync(path.join(WORKSPACE, "tests"), { recursive: true });
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(path.join(WORKSPACE, "package.json"), JSON.stringify({
    name: "bounded-desktop-smoke-workspace",
    private: true,
    version: "0.0.1",
    scripts: { test: "node tests/checkout.test.js" }
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "README.md"), "# Checkout service\n\nLatency budget fixture for the Boss desktop smoke.\n", "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "src", "checkout.js"), [
    "'use strict';",
    "// Fixture: the WorkBook asks for a latency guard around this call.",
    "async function checkout(gateway) {",
    "  return gateway.charge({ amount: 100 });",
    "}",
    "module.exports = { checkout };",
    ""
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "tests", "checkout.test.js"), [
    "'use strict';",
    "const assert = require('node:assert');",
    "const { checkout } = require('../src/checkout.js');",
    "(async () => {",
    "  const result = await checkout({ charge: async () => ({ ok: true }) });",
    "  assert.strictEqual(result.ok, true);",
    "  console.log('checkout fixture ok');",
    "})();",
    ""
  ].join("\n"), "utf8");
}

/* ------------------------------------------------------------------ *
 * CDP client
 * ------------------------------------------------------------------ */

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: pathname, timeout: 5000 }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.on("timeout", () => request.destroy(new Error("CDP list request timed out")));
    request.on("error", reject);
  });
}

async function waitForTarget(port, deadline) {
  let lastError = "no CDP target yet";
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(port, "/json/list");
      const page = targets.find((item) => item.type === "page" && `${item.title} ${item.url}`.includes("index.html"))
        ?? targets.find((item) => item.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
      lastError = `CDP exposed ${targets.length} target(s), none is the renderer`;
    } catch (error) {
      lastError = String(error.message ?? error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`renderer CDP target never appeared (${lastError})`);
}

function connectCdp(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 0;
    socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.id !== undefined && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolve(message.result);
      }
    };
    socket.onerror = () => reject(new Error("CDP socket error"));
    socket.onopen = () => resolve({
      call(method, params = {}) {
        const id = ++nextId;
        return new Promise((done, fail) => {
          pending.set(id, { resolve: done, reject: fail, method });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { try { socket.close(); } catch { /* already closed */ } }
    });
  });
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new Error(`renderer evaluation failed: ${detail}`);
  }
  return result.result.value;
}

/**
 * A page target exists from the moment the webContents is created, so the first
 * evaluate can land in the initial (still empty) document and lose its context
 * when `loadFile(dist/index.html)` commits. That boot race is retried; the
 * driver itself is NOT retried, so a context destroyed mid-driver still fails
 * the acceptance instead of being papered over.
 */
const BOOT_RACE = /Execution context was destroyed|Cannot find context|Inspected target navigated or closed|Target closed|Session closed/i;

async function waitForRendererBoot(client, deadline) {
  let lastError;
  while (Date.now() < deadline) {
    try {
      const ready = await evaluate(client, `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const until = Date.now() + 20000;
        while (Date.now() < until) {
          if (window.boss && typeof window.boss.dispatchTask === "function" && document.querySelector(".composer-zone")) return { ready: true, title: document.title };
          await sleep(100);
        }
        return { ready: false, title: document.title };
      })()`);
      if (ready?.ready) return ready;
      lastError = new Error(`renderer reported not ready (${JSON.stringify(ready)})`);
    } catch (error) {
      lastError = error;
      if (!BOOT_RACE.test(String(error.message ?? error))) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`renderer never finished booting: ${lastError?.message ?? lastError}`);
}

/* ------------------------------------------------------------------ *
 * Driver: pure renderer interaction (no app knowledge, no direct calls)
 * ------------------------------------------------------------------ */

function driverExpression(parameters) {
  return `(async () => {
  const parameters = ${JSON.stringify(parameters)};
  const log = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const record = (name, ok, detail) => { log.push({ step: name, ok, detail }); };
  const fail = (name, detail) => { record(name, false, detail); throw new Error(name + " :: " + JSON.stringify(detail)); };
  const waitFor = async (probe, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let value;
      try { value = probe(); } catch { value = undefined; }
      if (value) return value;
      if (Date.now() > deadline) fail("wait:" + label, { timeoutMs });
      await sleep(50);
    }
  };
  const textOf = (element) => (element && element.textContent ? element.textContent.trim() : "");
  const setValue = (element, value) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };

  // 1. Renderer bridge and composer are live.
  await waitFor(() => window.boss && document.querySelector(".composer-zone"), 30000, "composer zone");
  record("renderer_ready", true, { bridge: typeof window.boss.dispatchTask === "function", title: document.title });

  // 2. Enter Work mode through the real navigation button.
  const workButton = [...document.querySelectorAll(".top-view-nav button")].find((button) => textOf(button) === "Work");
  if (!workButton) fail("enter_work_mode", { reason: "Work button missing" });
  workButton.click();
  const activeNav = await waitFor(() => {
    const active = document.querySelector(".top-view-nav button.active");
    return textOf(active) === "Work" ? active : undefined;
  }, 10000, "Work mode active");
  record("enter_work_mode", true, { clicked: "Work", active: textOf(activeNav) });

  // 3. Select the workspace through the real Work-mode field.
  const workspaceInput = await waitFor(() => document.querySelector('input[aria-label="工作区路径"]'), 10000, "workspace field");
  setValue(workspaceInput, parameters.workspace);
  await waitFor(() => workspaceInput.value === parameters.workspace, 5000, "workspace value applied");
  record("select_workspace", true, { ariaLabel: workspaceInput.getAttribute("aria-label"), value: workspaceInput.value });

  // 4. Bring one provider up through the real composer form. The pane this
  //    opens is bounded/offline, so no live AI page is ever contacted; the
  //    point of the step is that a provider exists the way a user would make
  //    one exist, and the dispatch guard has a real selection to validate.
  const addProvider = await waitFor(() => document.querySelector(".add-provider"), 10000, "custom provider opener");
  addProvider.click();
  const form = await waitFor(() => document.querySelector(".custom-provider-form"), 10000, "custom provider form");
  const inputs = form.querySelectorAll("input");
  if (inputs.length < 2) fail("add_bounded_provider", { reason: "custom provider form is not the expected shape", inputs: inputs.length });
  setValue(inputs[0], parameters.providerName);
  setValue(inputs[1], parameters.providerUrl);
  const submitProvider = form.querySelector('button[type="submit"]');
  await waitFor(() => !submitProvider.disabled, 5000, "custom provider submit enabled");
  submitProvider.click();
  const selectedChoice = await waitFor(() => {
    const selected = [...document.querySelectorAll(".provider-choice.selected .provider-toggle")];
    return selected.length ? selected : undefined;
  }, 20000, "selected provider");
  const pickerLabel = textOf(document.querySelector(".picker-label b"));
  record("add_bounded_provider", true, { selected: selectedChoice.map((button) => textOf(button)), pickerLabel });

  // 5. Attach the executable WorkBook by dropping a real File on the tray —
  //    the renderer's own drag-drop handler turns it into the real upload IPC.
  const tray = await waitFor(() => document.querySelector(".attachment-tray"), 10000, "attachment tray");
  const file = new File([parameters.workbookText], parameters.workbookName, { type: "text/markdown" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  for (const type of ["dragenter", "dragover", "drop"]) {
    tray.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }
  const chip = await waitFor(() => {
    const chips = [...document.querySelectorAll(".attachment-chip .attachment-name")];
    return chips.find((item) => textOf(item) === parameters.workbookName);
  }, 30000, "attachment chip");
  record("attach_workbook", true, { droppedVia: "DragEvent(drop)", chip: textOf(chip) });

  // 6. Attachment-only request: the prompt stays empty on purpose.
  const composer = document.querySelector(".prompt-composer textarea");
  if (!composer) fail("blank_prompt", { reason: "composer textarea missing" });
  record("blank_prompt", composer.value === "", { promptLength: composer.value.length });

  const inlineError = document.querySelector(".inline-error");
  if (inlineError) fail("pre_submit_clean", { inlineError: textOf(inlineError) });

  // 7. Submit through the real button.
  const submit = document.querySelector('.prompt-composer button[type="submit"]');
  if (!submit) fail("submit", { reason: "submit button missing" });
  const blockReason = textOf(document.querySelector(".composer-block-reason"));
  if (submit.disabled) fail("submit", { disabled: true, blockReason });
  submit.click();
  record("submit", true, { blockReason, disabled: false });

  // 8. The task must come back rendered, with its WorkBook status and contract.
  const status = await waitFor(() => document.querySelector(".workbook-status"), 90000, "workbook status rendered");
  const contract = document.querySelector(".workbook-contract");
  const afterError = document.querySelector(".inline-error");
  if (afterError) fail("post_submit_clean", { inlineError: textOf(afterError) });
  const stages = [...status.querySelectorAll(".workbook-stage-list li b")].map((item) => textOf(item));
  record("workbook_rendered", true, {
    classification: textOf(status.querySelector("header b")),
    stage: textOf(status.querySelector("header strong")),
    stages,
    stagesRendered: stages.length,
    contractVisible: Boolean(contract),
    summary: textOf(status.querySelector("p"))
  });

  return {
    ok: true,
    activeMode: textOf(document.querySelector(".top-view-nav button.active")),
    pickerLabel,
    chip: textOf(chip),
    workbook: {
      classification: textOf(status.querySelector("header b")),
      stage: textOf(status.querySelector("header strong")),
      stages,
      contractVisible: Boolean(contract),
      contractRoad: contract ? [...contract.querySelectorAll("dt")].map((item) => textOf(item)) : []
    },
    steps: log
  };
})()`;
}

/* ------------------------------------------------------------------ *
 * Durable truth (read from the files the main process wrote)
 * ------------------------------------------------------------------ */

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
}

/** Waits until the WorkBook task and its dispatch checkpoint stop changing. */
async function waitForSettledTask(deadline) {
  let previous = "";
  let stable = 0;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = readJson(STATE_FILE);
    if (snapshot?.tasks?.length) {
      const task = snapshot.tasks.find((item) => item.workbookDispatch);
      if (task) {
        const runs = (snapshot.runs ?? []).filter((run) => run.taskId === task.id);
        const checkpoints = (snapshot.dispatchCheckpoints ?? []).filter((item) => item.taskId === task.id);
        const busy = runs.some((run) => ["sending", "preparing"].includes(run.phase));
        const signature = JSON.stringify([task.status, task.workbookDispatch.stage, runs.map((run) => run.phase), checkpoints.map((item) => item.status)]);
        if (!busy && signature === previous) {
          stable += 1;
          if (stable >= 3) return { snapshot, task, runs, checkpoints };
        } else stable = 0;
        previous = signature;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return snapshot ? { snapshot, task: (snapshot.tasks ?? []).find((item) => item.workbookDispatch), runs: [], checkpoints: [] } : undefined;
}

/* ------------------------------------------------------------------ *
 * Claims
 * ------------------------------------------------------------------ */

class Claims {
  constructor() { this.entries = []; }
  check(claim, expected, observed) {
    const expectedText = typeof expected === "string" ? expected : JSON.stringify(expected);
    const observedText = typeof observed === "string" ? observed : JSON.stringify(observed);
    this.entries.push({ claim, expected: expectedText, observed: observedText, ok: expectedText === observedText });
  }
  get failed() { return this.entries.filter((entry) => !entry.ok); }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = require("node:net").createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  prepareFixtures();
  const port = await freePort();
  const electron = path.join(PROJECT, "node_modules", "electron", "dist", "electron.exe");
  if (!fs.existsSync(electron)) throw new Error(`electron binary missing: ${electron}`);
  if (!fs.existsSync(path.join(PROJECT, "dist", "index.html"))) throw new Error("dist/index.html missing — run `pnpm run build` first");

  const env = { ...process.env, TEMP: path.join(ROOT, "tmp"), TMP: path.join(ROOT, "tmp") };
  delete env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(env.TEMP, { recursive: true });
  const stdout = fs.openSync(path.join(ROOT, "electron.stdout.log"), "w");
  const stderr = fs.openSync(path.join(ROOT, "electron.stderr.log"), "w");

  const child = spawn(electron, [
    PROJECT,
    "--boss-workbook-smoke",
    "--boss-offline-providers",
    "--boss-data-dir=" + DATA_ROOT,
    "--remote-debugging-port=" + port
  ], { cwd: PROJECT, env, windowsHide: true, stdio: ["ignore", stdout, stderr] });

  let exit = undefined;
  child.on("close", (code) => { exit = code; });
  let client;
  let driver;
  let durable;
  let screenshot = false;
  const claims = new Claims();

  try {
    const target = await waitForTarget(port, Date.now() + BOOT_TIMEOUT_MS);
    client = await connectCdp(target.webSocketDebuggerUrl);
    await waitForRendererBoot(client, Date.now() + BOOT_TIMEOUT_MS);
    driver = await evaluate(client, driverExpression({
      workspace: WORKSPACE,
      workbookName: WORKBOOK_NAME,
      workbookText: WORKBOOK_TEXT,
      providerName: CUSTOM_PROVIDER_NAME,
      providerUrl: CUSTOM_PROVIDER_URL
    }));

    try {
      const shot = await client.call("Page.captureScreenshot", { format: "png" });
      if (shot?.data) { fs.writeFileSync(SCREENSHOT_FILE, Buffer.from(shot.data, "base64")); screenshot = true; }
    } catch (error) {
      // Screenshot is supporting visual evidence, not an acceptance claim: a
      // capture failure is recorded but never turns a verified path red.
      console.warn(`[desktop-smoke] screenshot unavailable: ${String(error.message ?? error)}`);
    }

    durable = await waitForSettledTask(Date.now() + SETTLE_TIMEOUT_MS);
  } finally {
    if (client) client.close();
    if (exit === undefined) { try { child.kill(); } catch { /* already gone */ } }
    try { fs.closeSync(stdout); fs.closeSync(stderr); } catch { /* best effort */ }
  }

  /* ---- claims: the UI path really happened ---- */
  for (const step of driver.steps) claims.check(`renderer step ${step.step}`, "true", String(step.ok === true));
  claims.check("Work mode was entered through the real nav button", "Work", driver.activeMode);
  claims.check("the dropped WorkBook appears as a real attachment chip", WORKBOOK_NAME, driver.chip);
  claims.check("exactly one provider is selected through the real composer form", "1 / 5", driver.pickerLabel);
  claims.check("the WorkBook status panel is rendered", true, driver.workbook.contractVisible);
  claims.check("the rendered classification is the executable WorkBook", "EXECUTABLE_WORKBOOK", driver.workbook.classification);

  /* ---- claims: the main process recorded the production path ---- */
  const found = durable?.task !== undefined;
  claims.check("a durable task carries a WorkBook record", true, found);
  if (found) {
    const task = durable.task;
    const record = task.workbookDispatch;
    const documents = record.documents ?? [];
    const stages = (record.stageHistory ?? []).map((entry) => entry.stage);
    const runs = durable.runs ?? [];
    const checkpoints = durable.checkpoints ?? [];
    const registry = readJson(REGISTRY_FILE);
    const revisions = (registry?.entries ?? []).flatMap((entry) => entry.revisions ?? []);

    claims.check("classification is EXECUTABLE_WORKBOOK", "EXECUTABLE_WORKBOOK", record.classification);
    claims.check("the WorkBook is auto-run eligible", "true", String(record.auto_run === true));
    claims.check("the ingested document is the dropped file", WORKBOOK_NAME, documents[0]?.file_name);
    claims.check("the WorkBook hash is a content hash", 64, String(record.workbook_hash ?? "").length);
    claims.check("exactly one document was ingested", 1, documents.length);
    claims.check("the document was parsed into sections", true, (documents[0]?.sections ?? 0) > 0);
    claims.check("a Task Contract was compiled", true, record.contract !== undefined);
    claims.check("the contract carries executable goal items", true, (record.contract?.goal ?? []).flatMap((item) => item.items ?? []).length > 0);
    claims.check("the contract carries acceptance criteria from the WorkBook", true, JSON.stringify(record.contract?.acceptance_criteria ?? []).includes("AC-1"));
    claims.check("the compiled objective never embeds the document body", false, String(task.prompt ?? "").includes("# Bounded desktop smoke work book"));
    claims.check("the objective is the compiled contract, not the raw attachment", true, String(task.prompt ?? "").includes("latency guard"));
    claims.check("repository discovery ran against the selected workspace", true, (record.discovery?.files ?? 0) > 0);
    claims.check("discovery found the workspace test files", true, (record.discovery?.test_files ?? 0) > 0);

    for (const stage of ["INPUT_RECEIVED", "INGESTING", "CLASSIFYING", "COMPILING", "DISCOVERING", "PLANNING", "READY"]) {
      claims.check(`intake stage ${stage} was recorded`, true, stages.includes(stage));
    }
    claims.check("the dispatch boundary was entered (RUNNING after READY)", true, stages.indexOf("RUNNING") > stages.indexOf("READY"));

    // Dispatch boundary: provider work was really attempted, then rolled back
    // with a recorded reason — never faked into a completion.
    claims.check("a dispatch checkpoint exists for the task", 1, checkpoints.length);
    claims.check("the checkpoint expected the selected provider", 1, (checkpoints[0]?.expectedProviderIds ?? []).length);
    claims.check("the checkpoint was rolled back", "ROLLED_BACK", checkpoints[0]?.status);
    claims.check("the rollback carries a real reason", true, String(checkpoints[0]?.message ?? "").length > 0);
    claims.check("the rollback needs no reconciliation (nothing was sent)", "false", String(checkpoints[0]?.requiresReconciliation));
    claims.check("provider runs were created for the task", 1, runs.length);
    claims.check("provider runs were restored to their pre-send baseline", true, runs.every((run) => ["queued", "prepared", "blocked", "failed"].includes(run.phase)));
    claims.check("no artifact was fabricated", 0, (durable.snapshot.artifacts ?? []).filter((item) => item.taskId === task.id).length);
    claims.check("no final response was fabricated", true, (durable.snapshot.finalResponses ?? []).every((item) => item.taskId !== task.id));
    claims.check("the task never claims completion", true, ["running", "waiting", "queued"].includes(task.status));
    claims.check("the registry revision is linked to the real task id", task.id, revisions[0]?.task_id);
    claims.check("the registry revision is the ingested content hash", record.workbook_hash, revisions[0]?.hash);
    claims.check("the bounded provider was refused honestly, not silently", true, /适配器|未找到|输入区域|发送/.test(String(checkpoints[0]?.message ?? "")));

    // checkpoint-1 §5: the same real dispatch must have recorded project
    // knowledge through the write gate — this is the Knowledge Foundation
    // running inside the shipped app, not only inside the test suite.
    const knowledge = readJson(KNOWLEDGE_FILE);
    const knowledgeObjects = (knowledge?.objects ?? []).filter((object) => object?.provenance?.task_ref === task.id);
    const knowledgeLog = (knowledge?.gate_log ?? []).filter((entry) => entry?.task_ref === task.id);
    claims.check("the real app recorded project knowledge for this dispatch", true, knowledgeObjects.length > 0);
    claims.check("every recorded object is ACTIVE", true, knowledgeObjects.every((object) => object.status === "ACTIVE"));
    claims.check("every recorded object carries provenance", true, knowledgeObjects.every((object) => /^[0-9a-f]{64}$/.test(object.provenance.source_hash) && Boolean(object.provenance.produced_by) && Number.isFinite(Date.parse(object.provenance.captured_at))));
    claims.check("the knowledge write gate logged the decision", true, knowledgeLog.length > 0);
    claims.check("nothing was quarantined or rejected for this dispatch", 0, knowledgeLog.filter((entry) => entry.outcome === "QUARANTINE" || entry.outcome === "REJECT").length);
    claims.check("the recorded knowledge names a real knowledge type", true, knowledgeObjects.every((object) => /^[A-Z_]+$/.test(object.type)));
  }

  const report = {
    schemaVersion: 1,
    unit: "PHASE_0_DESKTOP_WORKBOOK_SMOKE",
    generatedAt: new Date().toISOString(),
    providerExecution: "BOUNDED_OFFLINE_PROVIDER",
    externalLiveProviderExecution: "NOT_RUN",
    screenshotCaptured: screenshot,
    driver,
    claims: claims.entries,
    totals: {
      pass: claims.entries.filter((entry) => entry.ok).length,
      fail: claims.failed.length
    },
    passed: claims.failed.length === 0,
    artifacts: {
      root: ROOT,
      state: fs.existsSync(STATE_FILE) ? STATE_FILE : undefined,
      registry: fs.existsSync(REGISTRY_FILE) ? REGISTRY_FILE : undefined,
      knowledge: fs.existsSync(KNOWLEDGE_FILE) ? KNOWLEDGE_FILE : undefined,
      screenshot: screenshot ? SCREENSHOT_FILE : undefined
    }
  };
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(RESULT_FILE, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(REPORT_FILE, renderMarkdown(report), "utf8");

  for (const entry of claims.entries) {
    console.log(`[desktop-smoke] ${entry.ok ? "PASS" : "FAIL"} ${entry.claim} — expected ${entry.expected}, observed ${entry.observed}`);
  }
  console.log(`[desktop-smoke] totals: PASS ${report.totals.pass} FAIL ${report.totals.fail}`);
  console.log(`[desktop-smoke] report: ${path.relative(PROJECT, RESULT_FILE)}`);
  if (screenshot) console.log(`[desktop-smoke] screenshot: ${path.relative(PROJECT, SCREENSHOT_FILE)}`);
  if (!report.passed) {
    console.error(`[desktop-smoke] FAILED: ${claims.failed.map((entry) => entry.claim).join(" | ")}`);
    process.exitCode = 1;
  } else {
    console.log("[desktop-smoke] UI → IPC → main process → WorkBook production path verified up to the dispatch boundary");
  }
}

function renderMarkdown(report) {
  const lines = [
    "# Phase 0 §4.3 desktop WorkBook black-box smoke",
    "",
    `Generated: ${report.generatedAt}`,
    `Provider execution: ${report.providerExecution}`,
    `External/live provider execution: ${report.externalLiveProviderExecution}`,
    "",
    `Totals: PASS ${report.totals.pass} / FAIL ${report.totals.fail}`,
    "",
    "| Claim | Expected | Observed | OK |",
    "| --- | --- | --- | --- |"
  ];
  for (const entry of report.claims) {
    lines.push(`| ${entry.claim} | ${entry.expected} | ${entry.observed} | ${entry.ok ? "yes" : "NO"} |`);
  }
  lines.push("", "## Renderer steps", "");
  for (const step of report.driver?.steps ?? []) {
    lines.push(`- ${step.ok ? "ok" : "FAILED"} **${step.step}** — ${JSON.stringify(step.detail)}`);
  }
  return lines.join("\n") + "\n";
}

main().catch((error) => {
  console.error(`[desktop-smoke] harness error: ${error?.stack ?? error}`);
  console.error(`[desktop-smoke] artifacts: ${ROOT}`);
  process.exitCode = 1;
});
