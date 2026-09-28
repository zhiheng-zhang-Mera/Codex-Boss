"use strict";
// Verify that every raw_evidence_ref in the post-CC103 index exists and that its recorded sha256 matches the file.
const fs = require("node:fs");
const crypto = require("node:crypto");
const Q = String.fromCharCode(34);
const text = fs.readFileSync("docs/research/post-cc103/EXPERIMENT_INDEX.csv", "utf8");
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
const lines = text.split(/\r?\n/).filter((l) => l.length);
let problems = 0;
for (let i = 1; i < lines.length; i++) {
  const f = parseLine(lines[i]);
  const [id, , , , , , , , , , , , , , , , ref, sha] = f;
  if (!fs.existsSync(ref)) { console.log("MISSING", id, ref); problems++; continue; }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(ref)).digest("hex");
  if (actual !== sha) { console.log("MISMATCH", id, "\n  recorded", sha, "\n  actual  ", actual); problems++; }
  else console.log("ok", id, sha.slice(0, 12) + "...");
}
console.log(problems === 0 ? "ALL EVIDENCE HASHES VERIFIED" : `${problems} problem(s)`);
process.exitCode = problems === 0 ? 0 : 1;
