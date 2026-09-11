import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256Bytes, sha256Hex, utf8Bytes } from "../../src/shared/hash";

describe("pure SHA-256 (workbook identity primitive)", () => {
  it("matches known vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches node:crypto for ascii, CJK and emoji input", () => {
    const samples = ["spec.md", "验收标准 1：必须通过测试", "🎯 emoji + 中文 + ascii", "x".repeat(200000)];
    for (const sample of samples) {
      expect(sha256Hex(sample)).toBe(createHash("sha256").update(sample, "utf8").digest("hex"));
    }
  });

  it("matches node:crypto for raw bytes (binary documents)", () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 1000, 12345]) {
      const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 31 + size) % 256);
      expect(sha256Bytes(bytes)).toBe(createHash("sha256").update(Buffer.from(bytes)).digest("hex"));
    }
  });

  it("encodes surrogate pairs identically to Buffer utf8", () => {
    const text = "𝄞 clef and 中文";
    expect(utf8Bytes(text)).toEqual(new Uint8Array(Buffer.from(text, "utf8")));
  });
});
