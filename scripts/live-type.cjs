#!/usr/bin/env node
/** CDP helper: focus an element then insert real text via Input domain. */
const http = require("node:http");
const args = process.argv.slice(2);
const [selector, text] = args;
if (!selector) { console.error("usage: live-type.cjs <selector> <text>"); process.exit(2); }
function getJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: 9222, path: pathname }, (res) => {
      let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}
(async () => {
  const targets = await getJson("/json/list");
  const page = targets.find((t) => t.type === "page" && (t.url.includes("deepseek") || (t.title || "").toLowerCase().includes("deepseek")));
  if (!page) throw new Error("no deepseek page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const callId = ++id;
    const handler = (event) => { const msg = JSON.parse(event.data); if (msg.id === callId) { ws.removeEventListener("message", handler); resolve(msg); } };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  await send("Runtime.evaluate", { expression: `(()=>{const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return 'missing'; el.focus(); return 'focused:'+document.activeElement===el;})()`, returnByValue: true });
  await send("Input.insertText", { text });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 }).catch(() => {});
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 }).catch(() => {});
  ws.close();
  console.log("typed");
})().catch((e) => { console.error(String(e)); process.exitCode = 1; });
