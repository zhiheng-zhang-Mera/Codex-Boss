"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ROOT = process.cwd();
const map = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "capability-modules.json"), "utf8"));
const FILE = "electron/commander/state-budget.ts";
const ownsPath = (entries, f) => {
  for (const entry of entries) {
    const n = String(entry).replace(/\\/g, "/").replace(/\/+$/, "");
    if (f === n || f.startsWith(n + "/")) return true;
  }
  return false;
};
const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry.name))) out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}
const allFiles = walk(path.join(ROOT, "electron")).concat(walk(path.join(ROOT, "src")));
const owner = new Map();
const trace = [];
for (const [capability, patterns] of Object.entries(map.capabilities)) {
  for (const file of allFiles) {
    if (!ownsPath(patterns, file)) continue;
    const previous = owner.get(file);
    owner.set(file, capability);
    if (file === FILE) trace.push("set by " + capability + " (previous " + previous + ")");
  }
}
console.log("trace for", FILE);
for (const line of trace) console.log("  ", line);
console.log("final:", owner.get(FILE));
