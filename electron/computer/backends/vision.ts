import fs from "node:fs";
import { createHash } from "node:crypto";
import type { SemanticAction, SemanticBackend, SemanticResult } from "../semantic-runtime";
import { readWindowsOcr, locateOcrText, type OcrWord, type OcrImage } from "./windows-ocr";
export interface VisionFrame { imagePath: string; surfaceRevision: string; }
export interface VisionProposal { action: SemanticAction; surfaceId: string; frame: VisionFrame; imageHash: string; imageWidth: number; imageHeight: number; target: OcrWord; }
export interface VisionSurface { capture(surfaceId: string, signal: AbortSignal): Promise<VisionFrame>; click(proposal: VisionProposal, signal: AbortSignal): Promise<void>; }
export interface VisionTarget { surfaceId: string; text: string; }
export function parseVisionTarget(target: string): VisionTarget {
 const provider = /^browser:([a-zA-Z0-9_-]+)$/.exec(target)?.[1];
 if (provider) return { surfaceId: "provider:" + provider, text: "page" };
 if (!target.startsWith("vision:")) throw new Error("Invalid vision target");
 const value = JSON.parse(target.slice(7));
 if (!value || Object.keys(value).some(key => !["surfaceId","text"].includes(key)) || typeof value.surfaceId !== "string" || !value.surfaceId || value.surfaceId.length > 150 || typeof value.text !== "string" || !value.text.trim() || value.text.length > 500) throw new Error("Invalid vision selector");
 return value;
}
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export class VisionBackend implements SemanticBackend {
 readonly kind = "vision" as const;
 constructor(private readonly surface: VisionSurface, private readonly authorize: (proposal: VisionProposal) => Promise<boolean>, private readonly ocr: (file: string, signal?: AbortSignal) => Promise<OcrImage> = readWindowsOcr) {}
 supports(action: SemanticAction): boolean { return (action.target.startsWith("vision:") && ["read_page","find_control","click_control","verify_state"].includes(action.name)) || (action.name === "read_page" && /^browser:[a-zA-Z0-9_-]+$/.test(action.target)); }
 async execute(action: SemanticAction, signal: AbortSignal): Promise<SemanticResult> {
  if (!this.supports(action)) return { status: "UNSUPPORTED" };
  let effected = false;
  try {
   const target = parseVisionTarget(action.target);
   const frame = await this.surface.capture(target.surfaceId, signal); const imageHash = hash(frame.imagePath);
   const image = await this.ocr(frame.imagePath, signal);
   if (action.name === "read_page") return { status: "SUCCESS", evidence: { source: "local_ocr", frame, image } };
   const rectangle = locateOcrText(image, action.name === "verify_state" ? action.expected ?? action.value ?? "" : target.text);
   const proposal: VisionProposal = { action, surfaceId: target.surfaceId, frame, imageHash, imageWidth: image.width, imageHeight: image.height, target: rectangle };
   if (action.name !== "click_control") return { status: "SUCCESS", evidence: proposal };
   if (!action.expected?.trim()) return { status: "FAILED", message: "Visual click requires an expected resulting text" };
   if (image.lines.some(line => line.text.toLocaleLowerCase().includes(action.expected!.trim().toLocaleLowerCase()))) return { status: "FAILED", message: "Expected effect already visible before action" };
   if (!await this.authorize(proposal)) return { status: "FAILED", message: "Visual action is not authorized", evidence: proposal };
   const latest = await this.surface.capture(target.surfaceId, signal);
   if (signal.aborted || latest.surfaceRevision !== frame.surfaceRevision || hash(latest.imagePath) !== imageHash) return { status: "FAILED", message: "Visual frame changed before action; locate again" };
   effected = true; await this.surface.click(proposal, signal);
   for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
    const after = await this.surface.capture(target.surfaceId, signal);
    const observed = await this.ocr(after.imagePath, signal);
    try { const verified = locateOcrText(observed, action.expected); return { status: "SUCCESS", evidence: { proposal, verified, after } }; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
   }
   return { status: "UNCERTAIN", message: "Visual click performed but expected effect was not verified", evidence: proposal };
  } catch (error) { return { status: effected ? "UNCERTAIN" : "FAILED", message: String(error) }; }
 }
}
