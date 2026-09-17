import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseManifest, applyManifest } from "../../electron/engineering/change-manifest";
import { digest } from "../../electron/engineering/verification";
import { resetMutationGuard } from "../../electron/self-evolution/mutation-guard";

/**
 * The proposal boundary — what a manifest may be, and what it may DO.
 *
 * A dogfooding run ended on a manifest the parser rejected because the coder emitted a malformed
 * `expectedSha256` for a file being CREATED. The parser's format check was duplicative and stricter
 * than the thing it protects: `applyScopedChanges` is the real authority on hash binding — it recomputes
 * the target's current digest and refuses with "Source changed since proposal" when they disagree — and
 * `null` there already means "no prior hash".
 *
 * So the format check is gone and the safety property is not. These tests hold BOTH halves: a model's
 * formatting slip is survivable, and a WRONG hash is still refused by the code that can actually tell.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-manifest-"));
  resetMutationGuard();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  resetMutationGuard();
});

const manifest = (changes: unknown[], checks: unknown[] = [{ kind: "test", files: ["tests/a.test.ts"] }]): string => JSON.stringify({ changes, checks });

describe("Phase 06 — a formatting slip in expectedSha256 is normalised, not fatal", () => {
  it("turns a malformed digest into null", () => {
    // The exact failure a real run hit: a digest that is not 64 lowercase hex characters. A STRING in a
    // string field is a formatting slip and is normalised, because the applier will compare against the
    // file's real digest anyway.
    for (const bad of ["abc", "not-a-hash", "ABC123", "a".repeat(63), "a".repeat(65), ""]) {
      const parsed = parseManifest(manifest([{ path: "tests/new.test.ts", expectedSha256: bad, content: "x" }]));
      expect(parsed.changes[0]!.expectedSha256, `${JSON.stringify(bad)} should normalise to null`).toBeNull();
    }
  });

  it("still rejects a value of the WRONG TYPE, because that is a schema error rather than a slip", () => {
    // A number or an object in a string field is not a formatting mistake the applier could recover
    // from — it means the proposal does not have the shape it claims, so it is refused with the field
    // named. Normalising these too would be accepting a proposal nobody can reason about.
    for (const wrong of [12345, {}, [], true]) {
      expect(() => parseManifest(manifest([{ path: "tests/new.test.ts", expectedSha256: wrong, content: "x" }])), `${JSON.stringify(wrong)} should be refused`)
        .toThrow(/changes\[0\]\.expectedSha256 must be a string or null/);
    }
  });

  it("keeps a well-formed digest exactly", () => {
    const good = "a".repeat(64);
    expect(parseManifest(manifest([{ path: "tests/a.test.ts", expectedSha256: good, content: "x" }])).changes[0]!.expectedSha256).toBe(good);
  });

  it("accepts a missing or null digest, which is how a new file is proposed", () => {
    expect(parseManifest(manifest([{ path: "tests/new.test.ts", content: "x" }])).changes[0]!.expectedSha256).toBeNull();
    expect(parseManifest(manifest([{ path: "tests/new.test.ts", expectedSha256: null, content: "x" }])).changes[0]!.expectedSha256).toBeNull();
  });

  it("names the field it is complaining about, so an automatic retry has something to act on", () => {
    // The old message was the single string "Invalid hash-bound change" for every one of these.
    expect(() => parseManifest(manifest([{ expectedSha256: null, content: "x" }]))).toThrow(/changes\[0\]\.path/);
    expect(() => parseManifest(manifest([{ path: "a.ts" }]))).toThrow(/changes\[0\]\.content/);
    expect(() => parseManifest(manifest([{ path: "a.ts", content: "x", expectedSha256: 5 }]))).toThrow(/changes\[0\]\.expectedSha256/);
    expect(() => parseManifest(manifest([], []))).toThrow(/proposal\.changes/);
    expect(() => parseManifest(manifest([{ path: "a.ts", content: "x" }], [{ kind: "nonsense" }]))).toThrow(/allowlisted/);
    expect(() => parseManifest("not json at all")).toThrow(/not valid JSON/);
  });
});

describe("Phase 06 — the safety property is unchanged: a WRONG hash is still refused", () => {
  it("refuses a change whose claimed hash does not match the file", () => {
    // The half that must not regress. Normalising the FORMAT must not normalise away the CHECK.
    const file = path.join(dir, "a.ts");
    fs.writeFileSync(file, "export const a = 1;\n", "utf8");
    const wrong = digest("something else entirely");

    const parsed = parseManifest(manifest([{ path: "a.ts", expectedSha256: wrong, content: "export const a = 2;\n" }]));
    // A well-formed hash is preserved, so the applier gets to compare it.
    expect(parsed.changes[0]!.expectedSha256).toBe(wrong);
    expect(() => applyManifest(dir, parsed, ["a.ts"])).toThrow(/Source changed since proposal/);
    // And the file was not touched.
    expect(fs.readFileSync(file, "utf8")).toBe("export const a = 1;\n");
  });

  it("refuses a change that claims null for a file that already exists", () => {
    // `null` means "there is no prior hash". Claiming it for an existing file is a hash mismatch, and the
    // applier is what decides that — not the parser, which cannot see the filesystem.
    const file = path.join(dir, "a.ts");
    fs.writeFileSync(file, "export const a = 1;\n", "utf8");
    const parsed = parseManifest(manifest([{ path: "a.ts", expectedSha256: null, content: "export const a = 2;\n" }]));
    expect(parsed.changes[0]!.expectedSha256).toBeNull();
    expect(() => applyManifest(dir, parsed, ["a.ts"])).toThrow(/Source changed since proposal/);
  });

  it("applies a change whose hash matches, and one that creates a new file", () => {
    fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n", "utf8");
    const parsed = parseManifest(manifest([
      { path: "a.ts", expectedSha256: digest("export const a = 1;\n"), content: "export const a = 2;\n" },
      { path: "b.ts", expectedSha256: null, content: "export const b = 1;\n" }
    ], [{ kind: "test", files: ["a.ts"] }]));
    const applied = applyManifest(dir, parsed, ["a.ts", "b.ts"]);
    expect(applied.map((change) => change.path).sort()).toEqual(["a.ts", "b.ts"]);
    expect(fs.readFileSync(path.join(dir, "a.ts"), "utf8")).toBe("export const a = 2;\n");
    expect(fs.readFileSync(path.join(dir, "b.ts"), "utf8")).toBe("export const b = 1;\n");
  });

  it("still refuses a file outside the authorised scope, and a protected metadata path", () => {
    fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n", "utf8");
    const outOfScope = parseManifest(manifest([{ path: "b.ts", expectedSha256: null, content: "x" }]));
    expect(() => applyManifest(dir, outOfScope, ["a.ts"])).toThrow(/outside authorized scope/);

    const metadata = parseManifest(manifest([{ path: ".git/config", expectedSha256: null, content: "x" }]));
    expect(() => applyManifest(dir, metadata, [".git/config"])).toThrow(/Protected workspace metadata/);
  });
});
