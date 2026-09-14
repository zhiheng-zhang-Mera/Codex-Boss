import { hydrateWorkBookAttachmentPaths } from "../commander/workbook-dispatch";
import type { CreateTaskInput, ProviderId } from "../../src/shared/contracts";
import type { InputObjectRef } from "../../src/shared/input-object";

/**
 * Task input normalisation (convergence book, Phase F).
 *
 * These four functions decide what a task is *made of* — which providers it drives,
 * which bound inputs travel with it, and what it is called. They were private helpers
 * inside `main.ts`, which meant the two entry points that create work (`create-task`
 * and `dispatch-task`) could only be exercised by booting the application, and the
 * rules below were visible only to a reader of the composition root.
 *
 * They live in a domain module rather than in either IPC module because **both**
 * callers need them: `create-task` moved to `bootstrap/task-creation-ipc.ts` and
 * `dispatch-task` has not moved yet. Putting them in one of the two would have made
 * the other import from an IPC module, which is the wrong direction.
 *
 * The store-touching parts take their lookups as an argument (`InputRefSources`)
 * instead of reaching for the composition root, so the rules are testable without one.
 */

/** What these helpers need from the store and the attachment store. */
export interface InputRefSources {
  /** The bound input objects of a conversation, as the store resolves them. */
  inputObjectsFor(conversationId: string): InputObjectRef[] | undefined;
  /**
   * The attachment store, when one is attached. Absent means the refs are returned
   * unhydrated rather than dropped — the same distinction the composition root made
   * with `if (!attachmentStore)`, which is why this is a property and not a function
   * that could quietly answer `undefined` for every ref.
   */
  attachments?: { localPathFor(conversationId: string, inputObjectId: string): string | undefined };
}

/** The transport each provider will be driven over, and the mode that implies. */
export function taskTransports(input: CreateTaskInput, providerIds: ProviderId[]): { appMode: "chat" | "work"; transports: Record<string, "web" | "api"> } {
  const appMode = (input.appMode ?? "chat") as "chat" | "work";
  const transports = Object.fromEntries(providerIds.map((providerId) => {
    const requested = input.transportByProvider?.[providerId] ?? "web";
    // A transport is a decision, not free text: anything but web/api is refused here
    // rather than silently becoming "web" downstream.
    if (requested !== "web" && requested !== "api") throw new Error(`无效执行通道：${providerId}`);
    return [providerId, appMode === "chat" ? "web" : requested];
  })) as Record<string, "web" | "api">;
  return { appMode, transports };
}

/** Deterministic task title: explicit, else WorkBook title/file name, else prompt. */
export function titleForTask(input: CreateTaskInput, attachments: InputObjectRef[]): string {
  const explicit = input.title?.trim();
  if (explicit) return explicit;
  const named = attachments.find((ref) => ref.originalName?.trim());
  if (named?.originalName) return named.originalName.replace(/\.[A-Za-z0-9]{1,8}$/, "") || named.originalName;
  return (input.prompt ?? "").trim().split(/\r?\n/)[0].slice(0, 80) || "Untitled task";
}

/** The conversation's input objects that this task actually binds. */
export function conversationScopedInputRefs(sources: InputRefSources, conversationId: string, inputObjectIds?: string[]): InputObjectRef[] {
  const bound = new Set(inputObjectIds ?? []);
  return (sources.inputObjectsFor(conversationId) ?? []).filter((ref) => bound.has(ref.id));
}

/**
 * The bound inputs, plus any extra ids the caller resolved (a materialized GitHub
 * repository, for instance), hydrated with their local paths when the attachment
 * store knows them.
 */
export function workbookAttachments(sources: InputRefSources, input: CreateTaskInput, conversationId: string, extraIds: string[] = []): InputObjectRef[] {
  const ids = [...new Set([...(input.inputObjectIds ?? []), ...extraIds])];
  const refs = conversationScopedInputRefs(sources, conversationId, ids);
  const attachments = sources.attachments;
  if (!attachments) return refs;
  return hydrateWorkBookAttachmentPaths(refs, (scopedConversationId, inputObjectId) =>
    attachments.localPathFor(scopedConversationId, inputObjectId)
  );
}
