/**
 * OFF-REPO WORKING TOOL (post-CC103 closeout, T3).
 *
 * For every kernel -> feature edge target, print the import statements the kernel actually uses and the shape of the
 * target file (interfaces / type aliases / const tables / functions / classes), so each edge can be classified as
 * PURE-CONTRACT (safe to re-attribute) or REAL-BEHAVIOUR (must be repaired by re-pointing or inverting).
 *
 * It reads the same ownership map and import pattern the CI gate uses. Reader only.
 *
 * usage: node classify-kf.cjs [--json]
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const REPO = process.env.BOSS_REPO ?? "D:/Codex-Boss";

const IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;
const inv = require(path.join(REPO, "scripts", "phase2-edge-inventory.cjs"));
const closure = require(path.join(REPO, "scripts", "capability-closure-validator.cjs"));
const map = closure.readOwnershipMap(REPO);
const manifests = closure.readManifests(REPO);
const kinds = new Map(manifests.filter((m) => m.id).map((m) => [m.id, m.kind ?? null]));

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(path.extname(entry.name))) out.push(path.relative(REPO, full).split(path.sep).join("/"));
  }
  return out;
};
const allFiles = walk(path.join(REPO, "electron")).concat(walk(path.join(REPO, "src")));
const ownsPath = (entries, file) => entries.some((entry) => {
  const n = String(entry).replace(/\\/g, "/").replace(/\/+$/, "");
  return file === n || file.startsWith(`${n}/`);
});
const owner = new Map();
for (const [cap, patterns] of Object.entries(map.capabilities ?? {})) for (const f of allFiles) if (ownsPath(patterns, f)) owner.set(f, cap);
const COMPOSITION_ROOT = "<composition-root>";
for (const [entry] of Object.entries(map.compositionRoot ?? {})) for (const f of allFiles) if (ownsPath([entry], f)) owner.set(f, COMPOSITION_ROOT);
const ROAD = "<road>";
const roadConfig = JSON.parse(fs.readFileSync(path.join(REPO, "config", "capability-roads.json"), "utf8"));
const roadOwner = new Map(Object.entries(roadConfig.roads ?? {}).map(([f, e]) => [f, String(e.owner)]));
for (const f of allFiles) if (roadOwner.has(f)) owner.set(f, ROAD);

/** shape: what the module exports at RUNTIME (approximate but conservative) */
function shape(file) {
  const text = fs.readFileSync(path.join(REPO, file), "utf8");
  const has = (re) => re.test(text);
  return {
    interfaces: (text.match(/^\s*export\s+interface\s+\w+/gm) ?? []).length,
    typeAliases: (text.match(/^\s*export\s+type\s+\w+/gm) ?? []).length,
    enums: (text.match(/^\s*export\s+(?:const\s+)?enum\s+\w+/gm) ?? []).length,
    consts: (text.match(/^\s*export\s+const\s+\w+/gm) ?? []).length,
    functions: (text.match(/^\s*export\s+(?:async\s+)?function\s+\w+/gm) ?? []).length,
    classes: (text.match(/^\s*export\s+(?:abstract\s+)?class\s+\w+/gm) ?? []).length,
    defaultExport: has(/^\s*export\s+default\b/m),
    importsNode: has(/^\s*import\s[^;\n]*from\s+["']node:/m),
    importsFs: has(/["'](?:node:)?(?:fs|path|os|crypto|child_process)["']/),
    runtimeValueExports: has(/^\s*export\s+const\s+\w+\s*[:=]/m) || has(/^\s*export\s+(?:async\s+)?function\s+\w+/m) || has(/^\s*export\s+class\s+\w+/m) || has(/^\s*export\s+enum\s+\w+/m),
  };
}

const edges = [];
for (const file of [...owner.keys()].sort()) {
  const text = fs.readFileSync(path.join(REPO, file), "utf8");
  for (const m of text.matchAll(IMPORT_PATTERN)) {
    const s = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (!s) continue;
    const target = require(path.join(REPO, "scripts", "phase2-edge-inventory.cjs")).resolveSpecifier(s, file);
    if (!target || !owner.has(target)) continue;
    const from = owner.get(file);
    const to = owner.get(target);
    const effectiveTo = to === ROAD ? roadOwner.get(target) : to;
    if (from === effectiveTo) continue;
    const fromKind = kinds.get(from) ?? (from === COMPOSITION_ROOT ? "composition-root" : null);
    const toKind = kinds.get(to) ?? (to === ROAD ? "road" : null);
    if (fromKind !== "kernel" || toKind !== "feature") continue;
    const line = text.slice(0, m.index).split("\n").length;
    edges.push({ from, to, fromFile: file, toFile: target, line, statement: m[0].trim().split("\n").join(" ").slice(0, 200) });
  }
}

const audited = [];
const seen = new Set();
for (const e of edges.sort((a, b) => (a.toFile + a.fromFile).localeCompare(b.toFile + b.fromFile))) {
  if (seen.has(e.toFile)) continue;
  seen.add(e.toFile);
  audited.push({ ...e, targetShape: shape(e.toFile), importers: [...new Set(edges.filter((x) => x.toFile === e.toFile).map((x) => x.fromFile))] });
}

const args = process.argv.slice(2);
if (args.includes("--json")) process.stdout.write(`${JSON.stringify(audited, null, 2)}\n`);
else {
  process.stdout.write(`distinct kernel->feature TARGET files: ${audited.length}\n`);
  for (const a of audited) {
    const s = a.targetShape;
    const verdict = !s.runtimeValueExports ? "PURE-CONTRACT" : s.functions + s.classes > 0 ? "BEHAVIOUR" : "CONST-TABLE";
    process.stdout.write(`\n[${verdict}] ${a.toFile}  (${a.from} -> ${a.to})  importers=${a.importers.length}\n`);
    process.stdout.write(`    iface=${s.interfaces} type=${s.typeAliases} enum=${s.enums} const=${s.consts} fn=${s.functions} class=${s.classes} node/fspath=${s.importsFs}\n`);
    process.stdout.write(`    ${a.statement}\n`);
  }
}
