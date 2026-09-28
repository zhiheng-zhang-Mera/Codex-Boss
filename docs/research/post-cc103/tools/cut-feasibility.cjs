"use strict";
/**
 * CC-124: a reproducible feasibility table for every remaining mutually dependent capability pair.
 *
 * Why a NEW tool rather than another round of manual checks: the pair table ranks by EDGE COUNT, and this round has
 * shown five times that edge count does not predict cuttability. What decides it is what the consumer IMPORTS. This
 * walks every pair that is still mutually dependent, takes the CHEAPER direction, opens each carrying file, and
 * classifies the import that creates the edge:
 *
 *   TYPE-UNION       `import type { X }` where X is a union of literals            -> cuttable by redeclaring it
 *   TYPE-CLASS       `import type { X }` where X is a class                        -> cuttable only if the consumer
 *                                                                                    drives a SUBSET (a port)
 *   TYPE-INTERFACE   `import type { X }` where X is an interface                   -> cuttable only if the interface
 *                                                                                    is small; a large one is not
 *   VALUE            a value import (call, construct, table)                       -> NOT cuttable by declaration
 *   SHARED-MODULE    several files of the same capability import one target module -> not cuttable by an import edit
 *
 * It is a READER: it changes nothing and prints a table. The classification of the imported symbol is derived from
 * the repository's own source, not from a list maintained by hand.
 */
const fs = require("node:fs");
const path = require("node:path");
const ROOT = process.cwd();
const pair = require(path.join(ROOT, "scripts", "phase2-pair-edges.cjs"));
const cycles = require(path.join(ROOT, "scripts", "phase2-cycles.cjs")).report;
const inv = require(path.join(ROOT, "scripts", "phase2-edge-inventory.cjs"));

const scan = pair.scan();
const counts = new Map();
for (const e of scan.edges) counts.set(`${e.from} -> ${e.to}`, (counts.get(`${e.from} -> ${e.to}`) ?? 0) + 1);

/** What kind of thing does `specifier` provide? Read from the target file's own source. */
function symbolKind(targetFile, names) {
  let text;
  try { text = fs.readFileSync(path.join(ROOT, targetFile), "utf8"); } catch { return "UNREADABLE"; }
  const kinds = new Set();
  for (const name of names) {
    if (!name || name === "*") { kinds.add("NAMESPACE"); continue; }
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`export\\s+(?:declare\\s+)?class\\s+${esc}\\b`).test(text)) kinds.add("CLASS");
    else if (new RegExp(`export\\s+interface\\s+${esc}\\b`).test(text)) kinds.add("INTERFACE");
    else if (new RegExp(`export\\s+(?:const\\s+)?enum\\s+${esc}\\b`).test(text)) kinds.add("ENUM");
    else if (new RegExp(`export\\s+type\\s+${esc}\\s*=`).test(text)) {
      // A union of literals is a small closed vocabulary; anything else is a type alias of unknown size.
      const alias = text.match(new RegExp(`export\\s+type\\s+${esc}\\s*=\\s*([\\s\\S]{0,400}?);`));
      kinds.add(alias && /^[\s\S]*?["'`]/.test(alias[1]) && /["'`]\s*(\||$)/.test(alias[1]) ? "TYPE-UNION" : "TYPE-ALIAS");
    } else if (new RegExp(`export\\s+(?:const|function|async\\s+function)\\s+${esc}\\b`).test(text)) kinds.add("VALUE");
    else kinds.add("UNKNOWN");
  }
  return [...kinds].sort().join("+") || "NONE";
}

/** The names a file takes from a given specifier, and whether the import is type-only. */
function importedNames(fromFile, toFile) {
  const text = fs.readFileSync(path.join(ROOT, fromFile), "utf8");
  const out = [];
  for (const m of text.matchAll(/import\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g)) {
    const target = inv.resolveSpecifier(m[3], fromFile);
    if (target !== toFile) continue;
    const body = (m[2] ?? "").trim();
    const typeOnly = Boolean(m[1]);
    const braced = body.match(/\{([\s\S]*)\}/);
    if (braced) {
      for (const piece of braced[1].split(",")) {
        const raw = piece.trim();
        if (!raw) continue;
        const isType = typeOnly || /^type\s+/.test(raw);
        const name = raw.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        out.push({ name, typeOnly: isType });
      }
    } else if (body) {
      out.push({ name: body.split(/\s+as\s+/)[0].trim(), typeOnly });
    }
  }
  return out;
}

const seen = new Set();
const rows = [];
for (const p of cycles.mutualPairs) {
  const [a, b] = p.split(" -> ");
  const key = [a, b].sort().join("|");
  if (seen.has(key)) continue;
  seen.add(key);
  const ab = counts.get(`${a} -> ${b}`) ?? 0;
  const ba = counts.get(`${b} -> ${a}`) ?? 0;
  const small = ab <= ba ? { from: a, to: b, n: ab } : { from: b, to: a, n: ba };
  const edges = scan.edges.filter((e) => e.from === small.from && e.to === small.to);
  const classified = edges.map((e) => {
    const names = importedNames(e.fromFile, e.toFile);
    return { file: e.fromFile, target: e.toFile, names, kind: symbolKind(e.toFile, names.map((n) => n.name)) };
  });
  rows.push({ pair: key, cut: `${small.from} -> ${small.to}`, cost: small.n, edges: classified });
}
rows.sort((x, y) => x.cost - y.cost || x.pair.localeCompare(y.pair));

let cuttable = 0;
let unknown = 0;
for (const r of rows) {
  const verdicts = r.edges.map((e) => {
    const allType = e.names.length > 0 && e.names.every((n) => n.typeOnly);
    if (e.kind.includes("TYPE-UNION") && allType) return "CUTTABLE-UNION";
    if (e.kind.includes("CLASS") && allType) return "MAYBE-PORT";
    if (e.kind.includes("INTERFACE") && allType) return "MAYBE-IF-SMALL";
    if (!allType) return "VALUE";
    return "UNKNOWN";
  });
  if (verdicts.some((v) => v.startsWith("CUTTABLE"))) cuttable++;
  else if (verdicts.every((v) => v === "UNKNOWN")) unknown++;
  console.log(`${String(r.cost).padStart(2)}  ${r.pair.padEnd(22)} cut ${r.cut.padEnd(24)} ${verdicts.join(",")}`);
  for (const e of r.edges) console.log(`        ${e.file} -> ${e.target}  [${e.kind}]  ${e.names.map((n) => (n.typeOnly ? "type " : "") + n.name).join(", ")}`);
}
console.log(`\npairs: ${rows.length}; cheaper-direction edges: ${rows.reduce((s, r) => s + r.cost, 0)}; pairs with a CUTTABLE-UNION edge: ${cuttable}; pairs entirely UNKNOWN: ${unknown}`);
