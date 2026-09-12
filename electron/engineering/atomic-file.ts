/**
 * Update-Plan/self-evlo.md §96/§97 — atomic durable writes.
 *
 * A certificate that is half-written is worse than no certificate: a reader can
 * parse the prefix and believe it. Every authoritative file this trust layer writes
 * goes through `writeFileAtomicSync` (temp file in the same directory, flush to
 * disk, then rename) and every audit re-reads it through `hashOnceStable`.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

/** SHA-256 of a file's exact bytes, or "" when it cannot be read. */
export function sha256FileSync(file: string): string {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
}

/**
 * §96: write a file so a reader sees either the old bytes or the new bytes.
 * The temp file is created in the destination directory (so the rename stays on one
 * volume), flushed with fsync, then renamed over the target.
 */
export function writeFileAtomicSync(file: string, content: string | Uint8Array): string {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  const handle = fs.openSync(temp, "w");
  try {
    fs.writeFileSync(handle, content);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  // Windows can refuse a rename while another handle is open; retry briefly rather
  // than leaving a stray temp file behind.
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(temp, file);
      return file;
    } catch (error) {
      lastError = error;
      const until = Date.now() + 20 * (attempt + 1);
      while (Date.now() < until) { /* bounded busy wait: the competing handle closes */ }
    }
  }
  try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
  throw lastError instanceof Error ? lastError : new Error(`atomic write of ${file} failed`);
}

/**
 * §60: hash a file twice, with a short real barrier between the reads. Equal hashes
 * do not prove the file will never change again — they prove no writer was in the
 * middle of a write at the moment the certificate was sealed.
 */
export function hashOnceStable(file: string, barrierMs = 120): { sha256: string; stable: boolean; first: string; second: string } {
  const first = sha256FileSync(file);
  const until = Date.now() + barrierMs;
  while (Date.now() < until) { /* deliberate barrier */ }
  const second = sha256FileSync(file);
  return { sha256: second, stable: first !== "" && first === second, first, second };
}

/** §97: true when the file's bytes still hash to the recorded digest. */
export function fileMatchesHash(file: string, sha256: string): boolean {
  return sha256 !== "" && sha256FileSync(file) === sha256;
}
