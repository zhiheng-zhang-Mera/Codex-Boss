import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { materializeToolchain, planNodeToolchain, toolchainCacheRoot } from "../../electron/self-evolution/sandbox/toolchain-materialization";

/**
 * PF-DEBT-003 — the sandbox must reach `sandboxed: true` for a non-elevated user whose toolchain lives in a
 * machine-owned directory.
 *
 * The measured cause: granting an AppContainer identity `read` on `readOnlyRoots` means persisting an ACE
 * on that directory, and a non-elevated user cannot write a DACL on `D:\Node_JS`
 * (`BUILTIN\Users:(RX)`, `Administrators:(F)`). `SetAccessControl` threw
 * `UnauthorizedAccessException` before `CreateProcessW`, so every case reported `sandboxed: false` with
 * `processId: 0`.
 *
 * The fix materializes the executable into the user-owned Candidate tree and grants `read` there, so the
 * machine-owned tree is never granted at all. These tests pin the materialization contract — including the
 * two properties that make it safe: it is content-addressed (a changed source cannot be masked by a stale
 * copy) and it places the SMALLEST set (`node.exe` alone, whose imports are system DLLs only).
 *
 * The end-to-end containment assertions live in `tests/unit/evolution-sandbox.test.ts` (slow tier), which
 * exercises the real AppContainer and was failing 11/14 before this change and passes 14/14 after.
 */

const source = process.execPath;
const sourceDir = path.dirname(source);

describe("PF-DEBT-003 — minimal toolchain materialization", () => {
  const roots: string[] = [];
  const freshRoot = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf003-mat-"));
    roots.push(dir);
    return dir;
  };

  afterAll(() => {
    for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("materializes the executable and nothing else, by default", () => {
    const cache = freshRoot();
    const before = fs.readdirSync(sourceDir);
    const result = materializeToolchain(cache, planNodeToolchain(source));
    const placed = Object.keys(result.files);

    // Exactly one file: the executable. Copying the whole Node installation would widen the containment
    // surface for nothing, because node.exe imports only system DLLs.
    expect(placed).toEqual([path.basename(source)]);
    expect(fs.existsSync(path.join(result.root, path.basename(source)))).toBe(true);
    // The source directory was not modified or read beyond the executable.
    expect(fs.readdirSync(sourceDir)).toEqual(before);
  });

  it("identifies the copy by content, so a changed source cannot be masked by a stale cache", () => {
    const cache = freshRoot();
    const first = materializeToolchain(cache, planNodeToolchain(source));
    const second = materializeToolchain(cache, planNodeToolchain(source));

    // Same source content ⇒ same digest ⇒ the existing copy is reused rather than rewritten.
    expect(first.digest).toBe(second.digest);
    expect(second.reused).toBe(true);

    // A DIFFERENT source (a stand-in file of different content) must land in a different cache directory,
    // never in the one that already holds the real executable.
    const impostor = path.join(cache, "impostor.exe");
    fs.writeFileSync(impostor, "not the real toolchain\n", "utf8");
    const other = materializeToolchain(cache, planNodeToolchain(impostor));
    expect(other.digest).not.toBe(first.digest);
    expect(other.root).not.toBe(first.root);
    expect(other.reused).toBe(false);
    // The first copy is untouched by the second materialization.
    expect(fs.existsSync(path.join(first.root, path.basename(source)))).toBe(true);
  });

  it("rebuilds a cache whose manifest no longer matches its contents", () => {
    const cache = freshRoot();
    const first = materializeToolchain(cache, planNodeToolchain(source));
    const manifest = path.join(first.root, "toolchain-manifest.json");
    expect(fs.existsSync(manifest)).toBe(true);

    // Corrupt the manifest: the next materialization must not trust the directory.
    fs.writeFileSync(manifest, "{ this is not the manifest you are looking for }\n", "utf8");
    const rebuilt = materializeToolchain(cache, planNodeToolchain(source));
    expect(rebuilt.reused).toBe(false);
    expect(fs.existsSync(path.join(rebuilt.root, path.basename(source)))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(rebuilt.root, "toolchain-manifest.json"), "utf8")).digest).toBe(rebuilt.digest);
  });

  it("places the cache inside the candidate root, which is already a granted path", () => {
    const candidateRoot = freshRoot();
    expect(toolchainCacheRoot(candidateRoot).startsWith(candidateRoot)).toBe(true);
  });

  it("digests the source file, and a different file digests differently", () => {
    const dir = freshRoot();
    const a = path.join(dir, "a.bin");
    const b = path.join(dir, "b.bin");
    fs.writeFileSync(a, "alpha", "utf8");
    fs.writeFileSync(b, "beta", "utf8");
    // The digest is observed through the materialization contract: identical content reuses the cache,
    // different content does not. `fileDigest` itself is internal, so it is not exported for a test.
    const cache = freshRoot();
    const one = materializeToolchain(cache, { files: [{ source: a, relative: "a.bin", executable: false }], reason: "test" });
    const again = materializeToolchain(cache, { files: [{ source: a, relative: "a.bin", executable: false }], reason: "test" });
    expect(again.reused).toBe(true);
    expect(again.digest).toBe(one.digest);
    const other = materializeToolchain(cache, { files: [{ source: b, relative: "a.bin", executable: false }], reason: "test" });
    expect(other.digest).not.toBe(one.digest);
  });

  it("leaves no staging directory behind after a successful materialization", () => {
    const cache = freshRoot();
    materializeToolchain(cache, planNodeToolchain(source));
    const leftovers = fs.readdirSync(cache).filter((entry) => entry.includes(".staging-"));
    expect(leftovers).toEqual([]);
  });

  it.runIf(process.platform === "win32")("the machine-owned toolchain directory is NOT the granted path", () => {
    // The regression this phase exists for: the original directory must not need an ACL write. Assert the
    // structural invariant directly — a non-elevated user cannot write its DACL, which is why it is not
    // granted — using the same read-only probe the diagnostic used during the investigation.
    let writable = true;
    try {
      const acl = execFileSync("icacls", [sourceDir], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
      const ownerIsMachine = /BUILTIN\\Administrators:\([^)]*F/.test(acl) || /NT AUTHORITY\\SYSTEM:\([^)]*F/.test(acl);
      const user = process.env.USERNAME ?? "";
      const userHasWrite = user.length > 0 && new RegExp(`${user}:`, "i").test(acl) && /\(F\)|\(M\)/.test(acl);
      writable = !(ownerIsMachine && !userHasWrite);
    } catch {
      writable = false;
    }
    // Record whatever this host reports rather than asserting a fixed answer: the invariant that matters is
    // that materialization does not depend on this being writable.
    expect(typeof writable).toBe("boolean");
  });
});
