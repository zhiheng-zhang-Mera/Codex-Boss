import type { BootModule, IpcRegistrar } from "./boot-module";
import type { CreateConversationInput } from "../../src/shared/contracts";

/**
 * Conversation / folder IPC (convergence book, Phase F/G).
 *
 * Eleven channels that used to be one-line closures over the composition root's
 * `store`, `attachmentStore` and `historyRepository` bindings. They now receive
 * one service surface, so the module owns the *policy* that is genuinely the IPC
 * layer's (the confirmation gate on destructive operations, the de-duplication of
 * a bulk delete) while the store keeps ownership of the data.
 *
 * Behaviour is unchanged, including the two rules that matter:
 *  - a delete requires an explicit confirmation on the MAIN process — a
 *    renderer-triggered cascade is never trusted on its own;
 *  - a bulk delete keeps going when one conversation fails, so a single bad record
 *    cannot block the rest.
 */

export interface ConversationService {
  createFolder(name: string): void;
  renameFolder(folderId: string, name: string): void;
  createConversation(input: CreateConversationInput): void;  renameConversation(conversationId: string, title: string): void;
  moveConversation(conversationId: string, folderId: string): void;
  selectConversation(conversationId: string): void;
  setConversationArchived(conversationId: string, archived: boolean): void;
  duplicateConversation(conversationId: string): void;
  /** Deletes the conversation record and its attachments. */
  deleteConversation(conversationId: string): void;
  /** Where conversation exports are written (the app data root's `exports/`). */
  exportRoot(): string;
  exportConversation(conversationId: string, root: string): string;
  /** Reveals a path in the OS file manager. */
  revealInFileManager(target: string): Promise<void> | void;
}

export interface ConversationIpcDeps {
  handle: IpcRegistrar["handle"];
  conversations: ConversationService;
  publish(): unknown;
}

export const CONVERSATION_IPC_CHANNELS = [
  "boss:create-folder",
  "boss:rename-folder",
  "boss:create-conversation",
  "boss:rename-conversation",
  "boss:move-conversation",
  "boss:select-conversation",
  "boss:archive-conversation",
  "boss:delete-conversation",
  "boss:delete-conversations",
  "boss:duplicate-conversation",
  "boss:export-conversation"
] as const;

/** Shared by the single and bulk delete channels: an explicit flag, or nothing. */
export function requireDeleteConfirmation(userConfirmed: unknown, bulk: boolean): void {
  if (userConfirmed === true) return;
  throw new Error(bulk ? "批量删除需要明确确认（该操作不可恢复）" : "删除需要明确确认（该操作不可恢复）");
}

export function createConversationIpcModule(deps: ConversationIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:create-folder", (_event, name: string) => { deps.conversations.createFolder(name); return deps.publish(); });
  on("boss:rename-folder", (_event, folderId: string, name: string) => { deps.conversations.renameFolder(folderId, name); return deps.publish(); });
  on("boss:create-conversation", (_event, input: CreateConversationInput) => { deps.conversations.createConversation(input); return deps.publish(); });
  on("boss:rename-conversation", (_event, conversationId: string, title: string) => { deps.conversations.renameConversation(conversationId, title); return deps.publish(); });
  on("boss:move-conversation", (_event, conversationId: string, folderId: string) => { deps.conversations.moveConversation(conversationId, folderId); return deps.publish(); });
  on("boss:select-conversation", (_event, conversationId: string) => { deps.conversations.selectConversation(conversationId); return deps.publish(); });
  on("boss:archive-conversation", (_event, conversationId: string, archived: boolean) => { deps.conversations.setConversationArchived(conversationId, Boolean(archived)); return deps.publish(); });

  on("boss:delete-conversation", (_event, conversationId: string, userConfirmed: boolean) => {
    requireDeleteConfirmation(userConfirmed, false);
    deps.conversations.deleteConversation(conversationId);
    return deps.publish();
  });

  on("boss:delete-conversations", (_event, conversationIds: string[], userConfirmed: boolean) => {
    requireDeleteConfirmation(userConfirmed, true);
    const failures: string[] = [];
    for (const conversationId of [...new Set((conversationIds ?? []).filter(Boolean))]) {
      // One bad record must not block the rest of the batch — but the batch may
      // not report a clean sweep it did not achieve either.
      try { deps.conversations.deleteConversation(conversationId); }
      catch (error) { failures.push(`${conversationId}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (failures.length) throw new Error(`${failures.length} conversation(s) could not be deleted: ${failures.slice(0, 5).join("; ")}`);
    return deps.publish();
  });

  on("boss:duplicate-conversation", (_event, conversationId: string) => { deps.conversations.duplicateConversation(conversationId); return deps.publish(); });

  on("boss:export-conversation", async (_event, conversationId: string) => {
    const destination = deps.conversations.exportConversation(conversationId, deps.conversations.exportRoot());
    await deps.conversations.revealInFileManager(destination);
    return destination;
  });

  return {
    service: { channels: CONVERSATION_IPC_CHANNELS },
    health: () => ({
      module: "conversation-ipc",
      status: registered.length === CONVERSATION_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${CONVERSATION_IPC_CHANNELS.length} channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
