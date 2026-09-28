"use strict";
// Normalise the post-CC103 experiment index: in four records the sha256 was written into the
// raw_evidence_ref cell as `<path>;<sha>`, which shifted every later column right by one. This splits
// the cell back out, so each of the 23 columns holds what its header says it holds.
const fs = require("node:fs");
const Q = String.fromCharCode(34);
const p = "docs/research/post-cc103/EXPERIMENT_INDEX.csv";
const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.length);
function parseLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === Q) { if (line[i + 1] === Q) { cur += Q; i++; } else q = false; } else cur += ch; }
    else if (ch === Q) q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function quote(v) {
  const s = String(v === undefined || v === null ? "" : v);
  return s.includes(Q) || s.includes(",") || s.includes("\n") ? Q + s.split(Q).join(Q + Q) + Q : s;
}
const hdr = parseLine(lines[0]);
const out = [hdr.map(quote).join(",")];
let fixed = 0;
for (let i = 1; i < lines.length; i++) {
  const f = parseLine(lines[i]);
  if (f[16].includes(";")) {
    const semi = f[16].lastIndexOf(";");
    const sha = f[16].slice(semi + 1);
    const ref = f[16].slice(0, semi);
    // everything from column 17 onward is one to the right
    const shifted = [f[17], ...f.slice(18)];
    const rebuilt = [...f.slice(0, 16), ref, sha, ...shifted];
    out.push(rebuilt.slice(0, hdr.length).map(quote).join(","));
    fixed++;
    console.log("normalised", f[0], "-> sha256", sha.slice(0, 12) + "...");
  } else {
    out.push(f.slice(0, hdr.length).map(quote).join(","));
  }
}
fs.writeFileSync(p, out.join("\r\n") + "\r\n");
console.log("records normalised:", fixed);
