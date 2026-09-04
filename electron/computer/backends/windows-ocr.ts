import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
export interface OcrWord { text: string; x: number; y: number; width: number; height: number; }
export interface OcrImage { width: number; height: number; language: string; lines: { text: string; words: OcrWord[] }[]; }
export async function readWindowsOcr(imagePath: string, signal?: AbortSignal): Promise<OcrImage> {
 if (process.platform !== "win32") throw new Error("Windows OCR unavailable");
 const resolved = fs.realpathSync(imagePath);
 if (!/\.(png|jpe?g|bmp)$/i.test(resolved) || fs.statSync(resolved).size > 20000000) throw new Error("Unsupported OCR image");
 const script = path.resolve(__dirname, "../../../../scripts/windows-ocr.ps1");
 return new Promise((resolve, reject) => {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], signal });
  let output = "", errors = "";
  const timer = setTimeout(() => child.kill(), 15000);
  child.stdout.on("data", data => { output += String(data); if (output.length > 2000000) child.kill(); });
  child.stderr.on("data", data => { errors = (errors + String(data)).slice(-8000); });
  child.stdin.on("error", reject); child.once("error", reject);
  child.once("close", code => { clearTimeout(timer); if (code !== 0) return reject(new Error(errors || "OCR interrupted")); try { resolve(JSON.parse(output)); } catch (error) { reject(error); } });
  child.stdin.end(JSON.stringify({ path: resolved }));
 });
}
const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function locateOcrText(image: OcrImage, target: string): OcrWord {
 if (!target.trim()) throw new Error("Visual target text required");
 const matches: OcrWord[] = [];
 for (const line of image.lines) for (let start = 0; start < line.words.length; start++) {
  const words: OcrWord[] = [];
  for (let end = start; end < line.words.length; end++) {
   words.push(line.words[end]);
   const text = words.map(word => word.text).join(" ");
   if (normalize(text) !== normalize(target)) continue;
   const x = Math.min(...words.map(word => word.x)), y = Math.min(...words.map(word => word.y));
   const width = Math.max(...words.map(word => word.x + word.width)) - x, height = Math.max(...words.map(word => word.y + word.height)) - y;
   if (![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x+width > image.width || y+height > image.height) throw new Error("OCR bounds invalid");
   matches.push({ text, x, y, width, height });
  }
 }
 if (matches.length !== 1) throw new Error("Visual target requires exactly one text match");
 return matches[0];
}
