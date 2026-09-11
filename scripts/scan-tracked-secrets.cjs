const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

// Include staged/tracked files and new untracked delivery files, while obeying
// .gitignore so local vaults, packages and evidence are never opened.
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const patterns = [
  { label: "PEM private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{32,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: "authorization bearer", regex: /authorization\s*[:=]\s*["']?Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i }
];
const findings = [];
for (const file of files) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  for (const pattern of patterns) if (pattern.regex.test(text)) findings.push(`${file}: ${pattern.label}`);
}
if (findings.length) {
  console.error(`TRACKED_SECRET_SCAN=FAIL count=${findings.length}`);
  for (const finding of findings) console.error(finding);
  process.exit(1);
}
console.log(`TRACKED_SECRET_SCAN=PASS files=${files.length}`);
