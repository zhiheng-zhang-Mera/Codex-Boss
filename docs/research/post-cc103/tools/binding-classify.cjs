/**
 * OFF-REPO WORKING TOOL (post-CC103 closeout, T2/T3).
 *
 * CC-102's corrected method, mechanised: classify a cross-capability edge by EVERY binding the specifier
 * provides, and call it a RUNTIME coupling if ANY of them is used as a value (called, constructed, passed,
 * computed with, or read as a table). Only an edge whose every binding appears exclusively in type positions is
 * an IMPORT-POSITION coupling, and only those are candidates for discharge by declaring the shape locally.
 *
 * It deliberately does NOT depend on the `import type` keyword alone, because CC-102 measured a mixed statement
 * `import { layoutProviderPanes, type WorkspaceViewState }` defeating exactly that test.
 *
 * usage: node binding-classify.cjs [--json] [--only=<substring>]
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const REPO = process.env.BOSS_REPO ?? "D:/Codex-Boss";

const IMPORT_RE = /import\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
const BARE_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const REQUIRE_RE = /(?:^|\n)\s*(?:const|let|var)\s+([\s\S]*?)=\s*require\(\s*["']([^"']+)["']\s*\)/g;

function parseBindings(statement) {
  // statement is everything between `import` and `from`
  const bindings = [];
  const specifierIsType = /^\s*type\s+/.test(statement);
  let body = statement.replace(/^\s*type\s+/, "");
  const braceAt = body.indexOf("{");
  if (braceAt >= 0) {
    const defaultPart = body.slice(0, braceAt).replace(/,\s*$/, "").trim();
    if (defaultPart) bindings.push({ name: defaultPart.replace(/\s+as\s+.*/, "").trim(), kind: specifierIsType ? "type" : "default", as: defaultPart.includes(" as ") ? defaultPart.split(/\s+as\s+/)[1].trim() : defaultPart });
    const inner = body.slice(braceAt + 1, body.lastIndexOf("}"));
    for (const raw of inner.split(",")) {
      const piece = raw.trim();
      if (!piece) continue;
      const isType = /^type\s+/.test(piece);
      const withoutType = piece.replace(/^type\s+/, "");
      const [orig, alias] = withoutType.split(/\s+as\s+/).map((x) => x.trim());
      bindings.push({ name: orig, kind: isType || specifierIsType ? "type" : "value", as: alias ?? orig });
    }
  } else {
    const ns = body.match(/\*\s+as\s+(\w+)/);
    if (ns) bindings.push({ name: "*", kind: "namespace", as: ns[1] });
    else if (body.trim()) {
      const [orig, alias] = body.trim().split(/\s+as\s+/).map((x) => x.trim());
      bindings.push({ name: orig, kind: "default", as: alias ?? orig });
    }
  }
  return bindings;
}

/**
 * Is `local` used as a value in `text`? Conservative: if the identifier appears anywhere other than
 *   - the import statement
 *   - an `import("...")` type position
 *   - a `type`/`interface` declaration line's type position
 * it counts as a value use, because CC-102's failure mode was under-counting.
 */
function valueUses(text, local, importIndex, importLength) {
  const body = text.slice(0, importIndex) + text.slice(importIndex + importLength);
  const re = new RegExp(`\\b${local.replace(/[$]/g, "\\$")}\\b`, "g");
  const uses = [];
  for (const m of body.matchAll(re)) {
    const before = body.slice(Math.max(0, m.index - 120), m.index);
    const line = body.slice(0, m.index).split("\n").length;
    const lineText = body.split("\n")[line - 1] ?? "";
    // `typeof X` in a type position is a TYPE use of the value's type; but `typeof X` also means X is a value.
    // `: X`, `<X>`, `as X`, `extends X`, `implements X` in a declaration are type positions.
    const typePosition =
      /:\s*$/.test(before) ||
      /,\s*$/.test(before) && /(?:<|\(|,)\s*$/.test(before) ||
      /(?:extends|implements|as|satisfies)\s+$/.test(before) ||
      /<\s*$/.test(before) ||
      /import\s*\(\s*["'][^"']*["']\s*\)\.$/.test(before);
    const declarationLine = /^\s*(?:export\s+)?(?:interface|type)\s/.test(lineText);
    uses.push({ line, snippet: lineText.trim().slice(0, 160), typePosition: typePosition || declarationLine });
  }
  return uses;
}

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

const rows = [];
for (const file of [...owner.keys()].sort()) {
  const from = owner.get(file);
  const fromKind = kinds.get(from) ?? (from === COMPOSITION_ROOT ? "composition-root" : null);
  if (fromKind !== "kernel") continue;
  const text = fs.readFileSync(path.join(REPO, file), "utf8");
  for (const m of text.matchAll(IMPORT_RE)) {
    const [full, typeKeyword, body, spec] = m;
    const target = inv.resolveSpecifier(spec, file);
    if (!target || !owner.has(target)) continue;
    const to = owner.get(target);
    const effectiveTo = to === ROAD ? roadOwner.get(target) : to;
    if (from === effectiveTo) continue;
    const toKind = kinds.get(to) ?? (to === ROAD ? "road" : null);
    if (toKind !== "feature") continue;
    const bindings = parseBindings((typeKeyword ?? "") + body);
    const analysed = bindings.map((b) => {
      if (b.kind !== "value") return { ...b, valueUses: [], verdict: b.kind === "namespace" ? "VALUE-RISK" : "type-only" };
      const uses = valueUses(text, b.as, m.index, full.length).filter((u) => !u.typePosition);
      return { ...b, valueUses: uses, verdict: uses.length ? "VALUE" : "type-only" };
    });
    const runtime = analysed.some((b) => b.verdict === "VALUE" || b.verdict === "VALUE-RISK");
    const bare = full.replace(/^import\s*/, "").trim() === `"${spec}"`;
    rows.push({ from, to, fromFile: file, toFile: target, spec, line: text.slice(0, m.index).split("\n").length, runtime: runtime || bare, bare, bindings: analysed });
  }
}

const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);
const list = only ? rows.filter((r) => (r.fromFile + r.toFile).includes(only)) : rows;
if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
else {
  const rt = list.filter((r) => r.runtime);
  const ip = list.filter((r) => !r.runtime);
  process.stdout.write(`kernel->feature import statements: ${list.length}; RUNTIME ${rt.length}; IMPORT-POSITION ${ip.length}\n`);
  for (const r of list.sort((a, b) => (a.fromFile + a.toFile).localeCompare(b.fromFile + b.toFile))) {
    process.stdout.write(`\n[${r.runtime ? "RUNTIME" : "IMPORT-POSITION"}] ${r.fromFile}:${r.line} -> ${r.toFile}  (${r.from} -> ${r.to})\n`);
    for (const b of r.bindings) {
      process.stdout.write(`    ${b.verdict.padEnd(11)} ${b.kind.padEnd(9)} ${b.as}${b.valueUses.length ? `  @L${b.valueUses.map((u) => u.line).join(",L")}` : ""}${b.valueUses.length ? `   e.g. ${b.valueUses[0].snippet.slice(0, 80)}` : ""}\n`);
    }
  }
}
