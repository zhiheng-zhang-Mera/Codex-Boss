#!/usr/bin/env node
/**
 * Minimal CDP evaluate helper against the running Codex-Boss instance.
 * Usage: node scripts/live-cdp.cjs "<JS expression>" [target-pattern]
 * Target defaults to the Codex Boss renderer (title "Codex Boss").
 */
const http = require("node:http");

const expression = process.argv[2];
if (!expression) { console.error("usage: live-cdp.cjs <expression> [targetPattern]"); process.exit(2); }
const pattern = (process.argv[3] ?? "Codex Boss").toLowerCase();

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: 9222, path: pathname }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }).on("error", reject);
  });
}

(async () => {
  const targets = await getJson("/json/list");
  const target = targets.find((item) => item.type === "page" && `${item.title} ${item.url}`.toLowerCase().includes(pattern))
    ?? targets.find((item) => item.type === "page");
  if (!target) throw new Error("no page target");
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
  if (result.result?.exceptionDetails) {
    console.error("EVAL_ERROR", JSON.stringify(result.result.exceptionDetails, null, 2));
    process.exitCode = 1;
    return;
  }
  const value = result.result?.result?.value;
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value, null, 2));
})().catch((error) => { console.error(String(error)); process.exitCode = 1; });
