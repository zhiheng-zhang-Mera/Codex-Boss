"use strict";
// Feasibility reader for A2-2 move (ii): for each candidate utility, print what it imports and who imports it, so a
// kernel-owned home can be chosen without creating a NEW kernel -> feature edge.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = process.cwd();
const closure = require(path.join(ROOT, "scripts", "capability-closure-validator.cjs"));
const inv = require(path.join(ROOT, "scripts", "phase2-edge-inventory.cjs"));
const map = closure.readOwnershipMap(ROOT);

const ownsPath = (entries, f) => {
  for (const entry of entries) {
    const n = String(entry).replace(/\\/g, "/").replace(/\/+$/, "");
    if (f === n || f.startsWith(n + "/")) return true;
  }
  return false;
};
const ownerOf = (file) => {
  let found;
  for (const [cap, pats] of Object.entries(map.capabilities)) if (ownsPath(pats, file)) found = cap;
  for (const [entry] of Object.entries(map.compositionRoot ?? {})) if (ownsPath([entry], file)) found = "<composition-root>";
  return found;
};

const EXT = new Set([".ts", ".tsx"]);
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

const candidates = process.argv.slice(2).filter((a) => !a.startsWith("--"));
for (const file of candidates) {
  console.log("=== " + file + "   owner=" + ownerOf(file));
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  console.log("  imports:");
  for (const m of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const target = inv.resolveSpecifier(m[1], file);
    if (!target) { console.log("    " + m[1] + "  (unresolved / package)"); continue; }
    console.log("    " + target + "   owner=" + ownerOf(target));
  }
  const importers = allFiles.filter((f) => f !== file && new RegExp("from\\s+[\"'][^\"']*" + path.basename(file, ".ts") + "[\"']").test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  console.log("  importers (" + importers.length + "):");
  for (const f of importers) console.log("    " + f + "   owner=" + ownerOf(f));
}
