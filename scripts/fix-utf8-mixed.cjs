#!/usr/bin/env node
/**
 * One-shot repair for files that are clean UTF-8 except for GBK-encoded
 * islands written by earlier PowerShell appends (Windows ANSI codepage 936).
 * Walks the byte stream: advances a valid UTF-8 char when possible, otherwise
 * decodes a 2-byte GBK pair via TextDecoder('gbk').
 * Usage: node scripts/fix-utf8-mixed.cjs <file> [--dry-run]
 */
const fs = require("node:fs");

const file = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!file) { console.error("usage: fix-utf8-mixed.cjs <file>"); process.exit(2); }

const buf = fs.readFileSync(file);
const gbk = new TextDecoder("gbk");
const utf8 = new TextDecoder("utf-8", { fatal: true });

function utf8Len(lead) {
  if (lead >= 0xC2 && lead <= 0xDF) return 2;
  if (lead >= 0xE0 && lead <= 0xEF) return 3;
  if (lead >= 0xF0 && lead <= 0xF4) return 4;
  return 0;
}

const out = [];
let i = 0;
let utf8Chars = 0, gbkChars = 0;
while (i < buf.length) {
  const b = buf[i];
  if (b <= 0x7F) { out.push(String.fromCharCode(b)); i += 1; utf8Chars++; continue; }
  const len = utf8Len(b);
  if (len > 0 && i + len <= buf.length) {
    const slice = buf.subarray(i, i + len);
    try { out.push(utf8.decode(slice)); i += len; utf8Chars++; continue; } catch { /* fall through */ }
  }
  // GBK pair fallback (lead 0x81-0xFE, trail 0x40-0xFE)
  if (i + 1 < buf.length && buf[i] >= 0x81 && buf[i] <= 0xFE && buf[i + 1] >= 0x40 && buf[i + 1] <= 0xFE) {
    out.push(gbk.decode(buf.subarray(i, i + 2)));
    i += 2; gbkChars++; continue;
  }
  // Truly undecodable byte: keep as U+FFFD marker so nothing is silently dropped.
  out.push("\uFFFD");
  i += 1; gbkChars++;
}

const text = out.join("");
if (dry) {
  console.log(`dry-run: utf8Chars=${utf8Chars} gbkPairs=${gbkChars} total=${text.length}`);
  process.exit(0);
}
fs.writeFileSync(file, text, "utf8");
// verify strict round-trip
new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
console.log(`repaired ${file}: ${utf8Chars} utf8 chars, ${gbkChars} gbk-decoded bytes, strict UTF-8 OK`);
