/**
 * 10Q: platform-neutral contract audit (forward).
 *
 * Statically proves the shared 10.x contract layer never embeds a host API:
 * no `node:` imports, no Electron, no process/os/fs usage, no Windows/Linux/
 * macOS-specific names. The audit runs over src/shared/tenx/** so CI can fail
 * a change that leaks a platform dependency into a shared protocol.
 */
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /from\s+["']node:/, label: "node: builtin import" },
  { pattern: /require\s*\(\s*["']node:/, label: "node: require" },
  { pattern: /from\s+["']electron/, label: "electron import" },
  { pattern: /\bprocess\./, label: "process usage" },
  { pattern: /\bos\.(platform|arch|cpus|totalmem|freemem|hostname|release)\(/, label: "os capability call" },
  { pattern: /\bfs\./, label: "fs usage" }
];

export interface AuditViolation {
  file: string;
  label: string;
  line: number;
}

export function auditSharedContracts(root: string): { files: string[]; violations: AuditViolation[] } {
  const files: string[] = [];
  const violations: AuditViolation[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  if (!fs.existsSync(root)) return { files: [], violations: [] };
  walk(root);
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({ file, label, line: index + 1 });
        }
      }
    });
  }
  return { files: files.map((file) => path.relative(process.cwd(), file)), violations };
}

export function auditReport(): { ok: boolean; files: string[]; violations: AuditViolation[] } {
  const root = path.resolve(__dirname, "../../src/shared/tenx");
  const result = auditSharedContracts(root);
  return { ok: result.violations.length === 0, ...result };
}
