import path from "node:path";
import type { BootModule, IpcRegistrar } from "./boot-module";
import { AttachmentStore } from "../input/attachment-store";

/**
 * Attachment IPC (convergence book, Phase F/G).
 *
 * The four channels that move a file into (or out of) a conversation. They used
 * to reach into the composition root's `store` and `attachmentStore` bindings
 * directly; they now receive one narrow service surface, so the handler body is
 * `validate → service → publish` and nothing else. Behaviour is unchanged: the
 * same store calls in the same order.
 *
 * THIS IS ALSO THE CAPABILITY'S BOOT PATH, and that is deliberate (ledger CC-065).
 *
 * The `attachments` durable namespace used to be declared by the `persistence`
 * capability and built inside `bootstrap/persistence.ts`, which imported
 * `AttachmentStore` from here -- so the kernel capability that OWNS the namespace
 * was not the capability that IMPLEMENTS it, and the two closed the
 * `persistence <-> attachments` mutual pair. Moving the construction to the
 * composition root (the abandoned experiment on `feat/persistence-wiring`) deleted
 * the edge but not the misalignment, and it moved the private-state reach rather
 * than removing it.
 *
 * The repair is one act: the namespace is declared by the capability that
 * implements the store, and the store is built on that capability's own boot path.
 * `dataRoot` is passed IN, so this module still derives nothing and holds no
 * opinion about where the durable root is; the path it composes is the same
 * `<dataRoot>/.boss/attachments` the persistence module used to compose.
 */

/**
 * The store's own object types, imported from the shared contract rather than
 * re-declared here: the attachment store is the owner of what an imported
 * attachment is, and a second shape in the IPC layer would be a second truth.
 */
type AttachmentObject = import("../../src/shared/input-object").InputObject;
type AttachmentRef = import("../../src/shared/input-object").InputObjectRef;

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

interface AttachmentIpcDeps {
  handle: IpcRegistrar["handle"];
  /**
   * The durable root the attachment store is rooted under, or `undefined` when the
   * caller supplies the store directly.
   *
   * Both forms exist on purpose. Production passes the root and lets this module
   * build the store -- that is what makes the capability, rather than the
   * composition root, the constructor of its own namespace. A test that only
   * exercises the four channels passes `attachments` alone and builds no store.
   */
  dataRoot?: string;
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

/**
 * What this module returns: the channels it registered and the store it built.
 *
 * Not exported — it is this module's own return type, and the repository's export-surface
 * guard is right to refuse an export that nothing reaches.
 */
interface AttachmentIpcService {
  channels: readonly string[];
  /**
   * The store this capability owns, or `undefined` when the caller injected one
   * (the test form) or no durable root was supplied.
   */
  store: AttachmentStore | undefined;
}

/** The one path this capability spells: `<dataRoot>/.boss/attachments`. */
function attachmentStoreRoot(dataRoot: string): string {
  return path.join(dataRoot, ".boss", "attachments");
}

export function createAttachmentIpcModule(deps: AttachmentIpcDeps): BootModule<AttachmentIpcService> {
  const registered: string[] = [];
  const root = deps.dataRoot === undefined ? undefined : attachmentStoreRoot(deps.dataRoot);
  const store = root === undefined ? undefined : new AttachmentStore(root);

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
    service: { channels: ATTACHMENT_IPC_CHANNELS, store },
    health: () => ({
      module: "attachment-ipc",
      status: registered.length === ATTACHMENT_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${ATTACHMENT_IPC_CHANNELS.length} channel(s): ${registered.join(", ")}${root === undefined ? "" : `; store rooted at ${root}`}`
    }),
    dispose: () => undefined
  };
}
