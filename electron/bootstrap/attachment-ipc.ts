import path from "node:path";
import type { BootModule, IpcRegistrar } from "./boot-module";

/**
 * Attachment IPC (convergence book, Phase F/G).
 *
 * The four channels that move a file into (or out of) a conversation. They used
 * to reach into the composition root's `store` and `attachmentStore` bindings
 * directly; they now receive one narrow service surface, so the handler body is
 * `validate → service → publish` and nothing else. Behaviour is unchanged: the
 * same store calls in the same order.
 */

/**
 * The store's own object types, imported from the shared contract rather than
 * re-declared here: the attachment store is the owner of what an imported
 * attachment is, and a second shape in the IPC layer would be a second truth.
 */
export type AttachmentObject = import("../../src/shared/input-object").InputObject;
export type AttachmentRef = import("../../src/shared/input-object").InputObjectRef;

export interface AttachmentService {
  /** True when the conversation exists (the handler's only validation). */
  conversationExists(conversationId: string): boolean;
  importFromPath(input: { conversationId: string; originalName: string; sourcePath: string }): AttachmentObject;
  importFromBytes(input: { conversationId: string; originalName: string; mime?: string; bytes: Uint8Array }): AttachmentObject;
  registerInputObjects(conversationId: string, objects: AttachmentRef[]): void;
  removeAttachment(conversationId: string, inputObjectId: string): void;
  removeInputObject(conversationId: string, inputObjectId: string): void;
  /** Durable local path of a stored attachment; `undefined` when it is not there. */
  localPathFor(conversationId: string, inputObjectId: string): string | undefined;
}

export interface AttachmentIpcDeps {
  handle: IpcRegistrar["handle"];
  attachments: AttachmentService;
  publish(): unknown;
  showOpenDialog(options: { title: string; properties: string[] }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export const ATTACHMENT_IPC_CHANNELS = [
  "boss:pick-attachments",
  "boss:add-attachment-bytes",
  "boss:remove-attachment",
  "boss:attachment-path"
] as const;

export function createAttachmentIpcModule(deps: AttachmentIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];

  deps.handle("boss:pick-attachments", async (_event, conversationId: string) => {
    if (!deps.attachments.conversationExists(conversationId)) throw new Error(`Unknown conversation: ${conversationId}`);
    const selection = await deps.showOpenDialog({ title: "选择要上传的文件", properties: ["openFile", "multiSelections"] });
    if (selection.canceled || selection.filePaths.length === 0) return deps.publish();
    const imported = selection.filePaths.map((filePath) => deps.attachments.importFromPath({ conversationId, originalName: path.basename(filePath), sourcePath: filePath }));
    deps.attachments.registerInputObjects(conversationId, imported);
    return deps.publish();
  });
  registered.push("boss:pick-attachments");

  deps.handle("boss:add-attachment-bytes", (_event, input: { conversationId: string; originalName: string; mime?: string; bytes: Uint8Array }) => {
    const object = deps.attachments.importFromBytes(input);
    deps.attachments.registerInputObjects(input.conversationId, [object]);
    return deps.publish();
  });
  registered.push("boss:add-attachment-bytes");

  deps.handle("boss:remove-attachment", (_event, conversationId: string, inputObjectId: string) => {
    deps.attachments.removeAttachment(conversationId, inputObjectId);
    deps.attachments.removeInputObject(conversationId, inputObjectId);
    return deps.publish();
  });
  registered.push("boss:remove-attachment");

  deps.handle("boss:attachment-path", (_event, conversationId: string, inputObjectId: string) => deps.attachments.localPathFor(conversationId, inputObjectId));
  registered.push("boss:attachment-path");

  return {
    service: { channels: ATTACHMENT_IPC_CHANNELS },
    health: () => ({
      module: "attachment-ipc",
      status: registered.length === ATTACHMENT_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${ATTACHMENT_IPC_CHANNELS.length} channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
