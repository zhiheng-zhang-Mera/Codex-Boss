#!/usr/bin/env node
/** Focus textarea on the provider page and press Enter (visible-send check). */
const http = require("node:http");
const provider = process.argv[2] ?? "deepseek";
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
  if (!page) throw new Error("page not found for " + provider);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const callId = ++id;
    const handler = (event) => { const msg = JSON.parse(event.data); if (msg.id === callId) { ws.removeEventListener("message", handler); resolve(msg); } };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  await send("Runtime.evaluate", { expression: `(()=>{const ta=document.querySelector('textarea,[contenteditable=true]'); if(!ta) return 'no-input'; ta.focus(); const enter=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}); ta.dispatchEvent(enter); const up=new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}); ta.dispatchEvent(up); return 'enter-dispatched';})()`, returnByValue: true });
  await new Promise((r) => setTimeout(r, 4000));
  const result = await send("Runtime.evaluate", { expression: `(()=>{const ta=document.querySelector('textarea,[contenteditable=true]'); return JSON.stringify({cleared:ta?(ta.value||'').trim().length===0:null,value:(ta&&ta.value||'').slice(0,60)});})()`, returnByValue: true });
  console.log(result.result.result.value ?? result.result.result.description);
  ws.close();
})().catch((e) => { console.error(String(e)); process.exitCode = 1; });
