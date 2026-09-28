"use strict";
const fs = require("node:fs");
const text = fs.readFileSync("docs/research/post-cc103/EXPERIMENT_INDEX.csv", "utf8");
const Q = String.fromCharCode(34);
function parseLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === Q) {
        if (line[i + 1] === Q) { cur += Q; i++; } else q = false;
      } else cur += ch;
    } else if (ch === Q) q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const lines = text.split(/\r?\n/).filter((l) => l.length);
const hdr = parseLine(lines[0]);
console.log("header fields:", hdr.length);
console.log("header:", hdr.join(" | "));
let bad = 0;
for (let i = 1; i < lines.length; i++) {
  const f = parseLine(lines[i]);
  if (f.length !== hdr.length) { bad++; console.log("row", i, "fields", f.length, "id", f[0]); }
}
console.log("data rows:", lines.length - 1, "malformed:", bad);
