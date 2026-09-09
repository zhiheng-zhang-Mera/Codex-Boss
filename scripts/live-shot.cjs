#!/usr/bin/env node
/** CDP screenshot of a provider page. Usage: live-shot.cjs <providerPattern> <out.png> */
const http = require("node:http");
const fs = require("node:fs");
const provider = process.argv[2];
const out = process.argv[3] ?? "artifacts/qwen-shot.png";
function getJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: 9222, path: pathname }, (res) => {
      let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}
(async () => {
  const targets = await getJson("/json/list");
  const page = targets.find((t) => t.type === "page" && ((t.title || "") + " " + t.url).toLowerCase().includes(provider));
  if (!page) throw new Error("no page " + provider);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const callId = ++id;
    const handler = (event) => { const msg = JSON.parse(event.data); if (msg.id === callId) { ws.removeEventListener("message", handler); resolve(msg); } };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.mkdirSync(require("node:path").dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(out);
  ws.close();
})().catch((e) => { console.error(String(e)); process.exitCode = 1; });
