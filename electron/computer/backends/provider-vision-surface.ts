import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProviderViews } from "../../provider-views";
import type { VisionSurface, VisionProposal } from "./vision";
export function providerVisionSurface(views: () => ProviderViews, directory: string): VisionSurface {
 const get = (surfaceId: string) => {
  const id = /^provider:([a-zA-Z0-9_-]+)$/.exec(surfaceId)?.[1];
  const view = id ? views().get(id) : undefined;
  if (!view || view.webContents.isCrashed()) throw new Error("Visual provider surface unavailable");
  const bounds = view.getBounds();
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error("Visual provider surface is not visible");
  const revision = JSON.stringify({ id: view.webContents.id, url: view.webContents.getURL(), bounds });
  return { view, bounds, revision };
 };
 return {
  async capture(surfaceId, signal) {
   if (signal.aborted) throw new Error("Visual capture cancelled");
   const before = get(surfaceId); const image = await before.view.webContents.capturePage();
   if (get(surfaceId).revision !== before.revision) throw new Error("Visual surface changed during capture");
   fs.mkdirSync(directory, { recursive: true }); const imagePath = path.join(directory, randomUUID() + ".png");
   fs.writeFileSync(imagePath, image.toPNG());
   return { imagePath, surfaceRevision: before.revision };
  },
  async click(proposal: VisionProposal, signal) {
   const current = get(proposal.surfaceId);
   if (signal.aborted || current.revision !== proposal.frame.surfaceRevision) throw new Error("Visual surface changed before click");
   const x = Math.round((proposal.target.x + proposal.target.width / 2) * current.bounds.width / proposal.imageWidth);
   const y = Math.round((proposal.target.y + proposal.target.height / 2) * current.bounds.height / proposal.imageHeight);
   if (x < 0 || y < 0 || x >= current.bounds.width || y >= current.bounds.height) throw new Error("Visual click outside surface");
   current.view.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
   current.view.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  }
 };
}
