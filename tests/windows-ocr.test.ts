import { expect, it } from "vitest";
import { locateOcrText, type OcrImage } from "../electron/computer/backends/windows-ocr";
const image: OcrImage = { width: 400, height: 100, language: "en-US", lines: [{ text: "BOSS VISION", words: [{ text: "BOSS", x: 10, y: 10, width: 50, height: 20 }, { text: "VISION", x: 70, y: 10, width: 80, height: 20 }] }] };
it("locates the union of a unique text phrase", () => {
 expect(locateOcrText(image, "boss vision")).toEqual({ text: "BOSS VISION", x: 10, y: 10, width: 140, height: 20 });
});
it("rejects ambiguous, missing and out-of-image visual targets", () => {
 expect(() => locateOcrText({ ...image, lines: [...image.lines, ...image.lines] }, "BOSS")).toThrow("exactly one");
 expect(() => locateOcrText(image, "SEND")).toThrow("exactly one");
 expect(() => locateOcrText({ ...image, width: 20 }, "BOSS")).toThrow("bounds");
});
