import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { VisionBackend, type VisionSurface } from "../electron/computer/backends/vision";
import { SemanticRuntime } from "../electron/computer/semantic-runtime";
const action = { name: "click_control" as const, target: 'vision:{"surfaceId":"provider:chatgpt","text":"APPLY"}', expected: "VERIFIED" };
const observed = { width: 200, height: 100, language: "en", lines: [{ text: "APPLY", words: [{ text: "APPLY", x: 10, y: 10, width: 80, height: 20 }] }] };
it("does not click when authorization fails or the image changes", async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-vision-"));
 try {
  const first = path.join(dir, "first.png"), second = path.join(dir, "second.png"); fs.writeFileSync(first, "first"); fs.writeFileSync(second, "changed");
  let captures = 0, clicks = 0;
  const surface: VisionSurface = { async capture() { return { imagePath: captures++ ? second : first, surfaceRevision: "same" }; }, async click() { clicks++; } };
  expect((await new VisionBackend(surface, async () => false, async () => observed).execute(action, new AbortController().signal)).status).toBe("FAILED");
  captures = 0;
  expect((await new VisionBackend(surface, async () => true, async () => observed).execute(action, new AbortController().signal)).message).toContain("frame changed");
  expect(clicks).toBe(0);
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
it("persists an unverified visual effect and prevents another click after reconstruction", async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-vision-"));
 try {
  const image = path.join(dir, "frame.png"); fs.writeFileSync(image, "frame"); let clicks = 0;
  const surface: VisionSurface = { async capture() { return { imagePath: image, surfaceRevision: "same" }; }, async click() { clicks++; } };
  const backend = new VisionBackend(surface, async () => true, async () => observed);
  const journal = path.join(dir, "pending.json");
  expect((await new SemanticRuntime([backend], journal).execute(action)).status).toBe("UNCERTAIN");
  expect((await new SemanticRuntime([backend], journal).execute({ ...action, target: 'vision:{"text":"APPLY","surfaceId":"provider:chatgpt"}' })).status).toBe("UNCERTAIN");
  expect(clicks).toBe(1);
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
