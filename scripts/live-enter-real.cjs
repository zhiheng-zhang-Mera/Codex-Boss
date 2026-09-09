#!/usr/bin/env node
/** Trusted Enter via CDP Input domain on a provider page. Usage: live-enter-real.cjs <providerPattern> */
const http = require("node:http");
const provider = process.argv[2] ?? "chatgpt";
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
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  ws.close();
  console.log("enter-sent");
})().catch((e) => { console.error(String(e)); process.exitCode = 1; });
