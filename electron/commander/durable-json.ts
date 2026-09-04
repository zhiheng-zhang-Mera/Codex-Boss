import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Flush the new generation before same-directory atomic replacement.
export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "wx");
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2), "utf8"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try {
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temporary, file); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || attempt >= 5) throw error;
        // Antivirus/indexer handles may briefly deny replacement. Never unlink canonical state.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
      }
    }
  }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export function readJson<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
export function validId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error("Invalid ledger identity");
  return id;
}
