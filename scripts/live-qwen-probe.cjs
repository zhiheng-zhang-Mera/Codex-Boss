#!/usr/bin/env node
/**
 * Bounded live probe for Owner-Result P0-7 (Qwen Computer-Use Recovery).
 * Launches Codex-Boss against the logged-in provider partitions, opens Qwen,
 * (1) records a read-only DOM probe (composer/send candidates), (2) dispatches
 * ONE 1-AI Qwen echo through the real automation path, (3) records the honest
 * outcome (send works / blocked with message / human-gated). Evidence is
 * written to the given output path. The app is terminated afterwards.
 *
 * Usage: node scripts/live-qwen-probe.cjs <evidence-out.json>
 * This script is off by default (needs a real logged-in Qwen session).
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const project = path.resolve(__dirname, "..");
const outFile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(project, "artifacts", "live-qwen-probe.json");
const DATA_DIR = path.join(project, ".cache", "browser-profile");
const CDP_PORT = 9222;
const electron = path.join(project, "node_modules", "electron", "dist", "electron.exe");
const TASK_TITLE = "Rev2 Qwen echo 2";
const PREVIOUS_TITLES = ["Rev2 Qwen echo"];

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: CDP_PORT, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evaluate(target, expression) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const result = await new Promise((resolve) => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) resolve(message);
    };
    socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  socket.close();
  if (result.result?.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(result.result.exceptionDetails).slice(0, 500)}`);
  return result.result?.result?.value;
}

async function findTarget(pattern, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const targets = await getJson("/json/list").catch(() => []);
    const hit = targets.find((item) => item.type === "page" && `${item.title} ${item.url}`.toLowerCase().includes(pattern));
    if (hit) return hit;
    if (Date.now() > deadline) return null;
    await sleep(1500);
  }
}

(async () => {
  const started = new Date().toISOString();
  const evidence = { kind: "LIVE_QWEN_CU_PROBE", startedAt: started, status: "RUNNING", steps: [] };
  const log = (step, detail) => { evidence.steps.push({ step, at: new Date().toISOString(), ...detail }); console.log(`[probe] ${step}:`, JSON.stringify(detail).slice(0, 300)); };

  const child = spawn(electron, [project, `--remote-debugging-port=${CDP_PORT}`, `--boss-data-dir=${DATA_DIR}`], { cwd: project, stdio: ["ignore", "ignore", "ignore"], windowsHide: false });
  const cleanup = () => { try { child.kill(); } catch {} };
  try {
    log("launch", { dataDir: DATA_DIR });
    const renderer = await findTarget("codex boss", 60_000);
    if (!renderer) throw new Error("renderer not reachable within 60s");
    log("renderer-ready", { title: renderer.title });

    // Open the Qwen provider pane (persistent partition keeps the login).
    const opened = await evaluate(renderer, `window.boss.openProvider("qwen").then(s => ({open: s.providers.find(p=>p.id==="qwen")?.windowOpen ?? false}))`);
    log("open-qwen", opened || {});
    const qwenTarget = await findTarget("chat.qwen.ai", 40_000);
    if (!qwenTarget) throw new Error("qwen page target not found after openProvider");

    // 1) Read-only DOM probe: composer + send candidates (wait out /auth bounce;
    // interactive-login mode waits up to 15 minutes for the operator).
    const loginMode = process.env.LIVE_QWEN_LOGIN === "1";
    const authTries = loginMode ? 240 : 18;
    let domProbe = null;
    if (loginMode) log("interactive-login", { message: "Qwen 窗口已打开；请完成登录（Qwen 走 GitHub OAuth；须回到 chat.qwen.ai 主页且出现输入框才算完成，最长 20 分钟）" });
    for (let i = 0; i < authTries; i += 1) {
      await sleep(5000);
      domProbe = await evaluate(qwenTarget, `(() => {
        const inputs = [...document.querySelectorAll('textarea.message-input-textarea, [contenteditable="true"], [role="textbox"]')].map(el => ({
          tag: el.tagName, role: el.getAttribute('role'), placeholder: (el.getAttribute('placeholder')||'').slice(0,60),
          contenteditable: el.getAttribute('contenteditable'), cls: (String(el.className||'')).slice(0,60)
        })).slice(0,8);
        // Ready only back on chat.qwen.ai home with a composer present.
        const ready = location.hostname === 'chat.qwen.ai' && !location.pathname.includes('/auth') && inputs.length > 0;
        const sendCandidates = [...document.querySelectorAll('button, [role="button"]')].map(b => ({
          aria: (b.getAttribute('aria-label')||'').slice(0,60), title: (b.getAttribute('title')||'').slice(0,60),
          cls: (String(b.className||'')).slice(0,60), text: (b.textContent||'').trim().slice(0,30)
        })).filter(b => /send|\\u53d1\\u9001|submit|paper|arrow/i.test((b.aria||'') + ' ' + (b.title||'') + ' ' + (b.text||''))).slice(0,12);
        const composerButtons = [...document.querySelectorAll('textarea.message-input-textarea ~ *, form button, [class*="composer"] button, [class*="footer"] button')]
          .slice(0,10).map(b => ({ tag: b.tagName, aria: (b.getAttribute('aria-label')||'').slice(0,50), cls: (String(b.className||'')).slice(0,50), disabled: b.disabled === true }))
          .filter((b, index, arr) => arr.findIndex(x => x.tag === b.tag && x.cls === b.cls && x.aria === b.aria) === index);
        return JSON.stringify({ host: location.hostname, href: location.href.slice(0,160), ready, auth: !ready, inputs, sendCandidates, composerButtons });
      })()`).catch((error) => `DOM_PROBE_ERROR ${String(error).slice(0,200)}`);
      const parsed = JSON.parse(domProbe);
      if (parsed.auth !== true) break;
      if (i % 6 === 0) log("waiting-auth", { host: parsed.host, href: parsed.href });
    }
    log("dom-probe", { dom: domProbe });

    const probeOnly = process.env.LIVE_QWEN_PROBE_ONLY === "1";
    if (probeOnly) {
      // Read-only response-region census (no send, no task): sample the
      // conversation containers the capture monitor would need to key on.
      const census = await evaluate(qwenTarget, `(() => { const seen = new Set(); const els = [...document.querySelectorAll('[class*="message"], [class*="conversation"] *, [class*="chat-content"] *, main *')].slice(0,6000); const out = []; for (const el of els) { const c = String(el.className||''); if (c && c.length<90 && el.children.length<=2) { const key = el.tagName+'.'+c.split(/\\s+/)[0]; if (!seen.has(key)) { seen.add(key); if (/\\b(msg|message|answer|markdown|content|assistant|user|thread|turn|role|bubble)\\b/i.test(c)) { const t=(el.textContent||'').trim().slice(0,60); out.push({ k: key, len: t.length }); } } } } return JSON.stringify({ samples: out.slice(0,30) }); })()`).catch((error) => `CENSUS_ERROR ${String(error).slice(0,200)}`);
      log("dom-census", { census });
      evidence.status = "COMPLETED";
      evidence.finishedAt = new Date().toISOString();
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2), "utf8");
      console.log("EVIDENCE_WRITTEN", outFile);
      return;
    }

    // 2) Stabilize the page before sending: the operator reported sends going
    // out before the Qwen chat page finished loading. Wait longer and re-check
    // the composer is still present (and no chat-loading banner) right before
    // dispatch.
    log("stabilize", { waitingMs: 30_000 });
    await sleep(30_000);
    const stableProbe = await evaluate(qwenTarget, `(() => JSON.stringify({ ready: location.hostname === 'chat.qwen.ai' && !!document.querySelector('textarea.message-input-textarea'), href: location.href.slice(0,120) }))()`).catch(() => null);
    log("stabilize-recheck", { stableProbe });
    if (stableProbe) {
      const parsed = JSON.parse(stableProbe);
      if (parsed.ready !== true) log("stabilize-warning", { message: "composer not present right before send — proceeding carefully" });
    }
    // Retire EVERY non-terminal task touching the qwen provider so the busy
    // guard cannot block this dispatch (stale prepared/waiting runs persist
    // across process restarts).
    const cleanup = await evaluate(renderer, `window.boss.snapshot().then(s => { const stale = s.tasks.filter(t => !["cancelled","completed","failed"].includes(t.status) && s.runs.some(r => r.taskId === t.id && r.providerId === "qwen" && ["queued","prepared","waiting","sending","opening","blocked"].includes(r.phase))); return Promise.all(stale.map(t => window.boss.updateTask(t.id, "cancelled").catch(() => null))).then(() => JSON.stringify({ cancelled: stale.map(t => t.id) })); })`).catch(() => "no-cleanup");
    log("cleanup-stale", { cleanup });
    await sleep(8000);
    const dispatch = await evaluate(renderer, `window.boss.dispatchTask(${JSON.stringify({ title: TASK_TITLE, prompt: "Reply with exactly: QWEN-OK.", providerIds: ["qwen"], appMode: "work" })}).then(s => { const t = s.tasks.find(x => x.title === ${JSON.stringify(TASK_TITLE)}); return JSON.stringify({ taskId: t?.id, status: t?.status, nextAction: t?.nextAction }); })`);
    log("dispatch", { dispatch });

    // 3) Poll the durable run state for the honest outcome (capture can take
    // minutes; LONG mode additionally watches the Qwen page for the assistant
    // reply and keeps polling until the app-level capture finishes).
    const longMode = process.env.LIVE_QWEN_LONG === "1";
    log("poll-mode", { longMode });
    const replyText = "QWEN-OK";
    let outcome = null;
    let replySeenAt = null;
    let pageTail = null;
    // 5s per tick: ~8 min normal; up to ~27.5 min in LONG mode (capture monitor bound).
    const maxIterations = longMode ? 330 : 96;
    for (let i = 0; i < maxIterations; i += 1) {
      await sleep(5000);
      if (longMode && !replySeenAt && i % 2 === 0) {
        const pageText = await evaluate(qwenTarget, `(() => JSON.stringify({ href: location.href.slice(0,120), hasReply: (document.body.innerText||'').includes(${JSON.stringify(replyText)}), tail: (document.body.innerText||'').slice(-500) }))()`).catch(() => null);
        if (pageText) {
          const parsed = JSON.parse(pageText);
          if (parsed.hasReply) {
            replySeenAt = new Date().toISOString();
            pageTail = parsed.tail;
            log("assistant-reply-visible", { tail: pageTail.slice(-220) });
          }
        }
      }
      outcome = await evaluate(renderer, `window.boss.snapshot().then(s => { const t = s.tasks.find(x => x.title === ${JSON.stringify(TASK_TITLE)}); if (!t) return null; const runs = s.runs.filter(r => r.taskId === t.id); const final = s.finalResponses.find(f => f.taskId === t.id); return JSON.stringify({ status: t.status, nextAction: t.nextAction || null, recoveryMessage: t.recoveryMessage || null, phases: runs.map(r => r.phase).join(','), outcomes: runs.map(r => r.outcome).join(','), message: (runs.map(r => r.message).find(Boolean) || '').slice(0,300), finalPreview: final ? final.content.slice(0, 200) : null, evidenceDecision: (s.evidenceBundles.filter(b => b.taskId === t.id).sort((a,b)=> b.createdAt.localeCompare(a.createdAt))[0]?.decision) ?? null }); })`).catch(() => null);
      if (outcome) {
        const parsed = JSON.parse(outcome);
        if (parsed && (parsed.status === "completed" || parsed.status === "failed" || parsed.finalPreview)) break;
      }
    }
    log("final-outcome", { outcome, replySeenAt, pageTail: pageTail ? pageTail.slice(-220) : null });
    evidence.status = "COMPLETED";
    evidence.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2), "utf8");
    console.log("EVIDENCE_WRITTEN", outFile);
  } catch (error) {
    evidence.status = "FAILED";
    evidence.error = String(error).slice(0, 500);
    evidence.finishedAt = new Date().toISOString();
    try { fs.mkdirSync(path.dirname(outFile), { recursive: true }); } catch {}
    fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2), "utf8");
    console.error("PROBE_FAILED", String(error).slice(0, 500));
    process.exitCode = 1;
  } finally {
    cleanup();
    // Give the app a moment to write durable state before hard exit.
    await sleep(1500);
    try { child.kill(); } catch {}
  }
})();
