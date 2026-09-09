import fs from "node:fs";
import path from "node:path";

/**
 * Recursively deletes a tree on Windows/Electron. Electron's bundled Node
 * (and some Node builds) cannot delete files that carry the read-only
 * attribute — git writes its object database read-only, so any deletion of a
 * materialized repository (clone staging, rollback of untracked trees,
 * workspace copy cleanup, fixture reset) would otherwise throw EPERM. This
 * clears attributes first and retries transient locks, then propagates the
 * final rmSync error (no silent failure).
 */
export function removeTree(target: string): void {
  if (!target) return;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      if (fs.existsSync(target)) {
        if (fs.statSync(target).isDirectory()) {
          const stack = [target];
          while (stack.length) {
            const current = stack.pop()!;
            try { fs.chmodSync(current, 0o666); } catch { /* keep walking */ }
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
              const child = path.join(current, entry.name);
              try { fs.chmodSync(child, 0o666); } catch { /* ignore */ }
              if (entry.isDirectory()) stack.push(child);
            }
          }
        } else {
          try { fs.chmodSync(target, 0o666); } catch { /* ignore */ }
        }
      }
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 7) throw error;
      // transient lock / antivirus; retry
    }
  }
}
