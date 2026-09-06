/**
 * Web-AI file upload planning (plan 9-7 §9). Maps a task's bound input
 * objects to concrete file payloads for a visible page, gated by what the
 * adapter is versioned to accept. Fail-closed: a file the page cannot
 * verifiably receive must never travel as if it were uploaded.
 */
import fs from "node:fs";
import type { AttachmentStore } from "./attachment-store";
import type { AdapterDefinition } from "../adapters/registry";
import type { StateStore } from "../store";
import type { InputObjectKind } from "../../src/shared/input-object";
import type { UploadFilePayload } from "../adapters/page-scripts";

/** Per-file budget for page-side injection (base64 lives in the executed script). */
export const MAX_PAGE_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface ResolvedUpload {
  inputObjectId: string;
  originalName: string;
  mime?: string;
  kind: InputObjectKind;
  localPath: string;
}

/** The input objects a task consumed that still exist on disk. */
export function resolveUploadsForTask(store: StateStore, attachmentStore: AttachmentStore, taskId: string): ResolvedUpload[] {
  const task = store.snapshot().tasks.find((item) => item.id === taskId);
  if (!task?.inputObjectIds?.length) return [];
  const conversation = store.snapshot().conversations.find((item) => item.id === task.conversationId);
  if (!conversation) return [];
  const objects = conversation.inputObjects ?? [];
  const result: ResolvedUpload[] = [];
  for (const inputObjectId of task.inputObjectIds) {
    const ref = objects.find((object) => object.id === inputObjectId);
    const localPath = ref ? attachmentStore.localPathFor(conversation.id, inputObjectId) : undefined;
    if (!ref || !localPath || !fs.existsSync(localPath)) continue;
    result.push({
      inputObjectId: ref.id,
      originalName: ref.originalName ?? ref.id,
      mime: ref.mime,
      kind: ref.kind,
      localPath
    });
  }
  return result;
}

export interface UploadPlan {
  /** Payloads the adapter's versioned surface can receive. */
  uploads: UploadFilePayload[];
  /** Inputs the adapter is not versioned to accept (fail-closed, never sent as if uploaded). */
  unsupported: ResolvedUpload[];
  /** Inputs that exist but exceed the page-injection budget. */
  oversized: ResolvedUpload[];
}

/** Plans uploads for one adapter; adapter must name file input + kinds. */
export function planAdapterUploads(definition: AdapterDefinition, resolved: ResolvedUpload[], maxBytes = MAX_PAGE_UPLOAD_BYTES): UploadPlan {
  const uploads: UploadFilePayload[] = [];
  const unsupported: ResolvedUpload[] = [];
  const oversized: ResolvedUpload[] = [];
  const acceptedKinds = new Set<string>(definition.uploadKinds ?? []);
  for (const file of resolved) {
    if (!definition.fileInputSelectors?.length || !acceptedKinds.has(file.kind)) {
      unsupported.push(file);
      continue;
    }
    const stat = fs.statSync(file.localPath);
    if (stat.size > maxBytes) {
      oversized.push(file);
      continue;
    }
    uploads.push({ name: file.originalName, mime: file.mime ?? "application/octet-stream", base64: fs.readFileSync(file.localPath).toString("base64") });
  }
  return { uploads, unsupported, oversized };
}

/** True only when a plan can proceed: every resolved file will verifiably upload. */
export function planIsRoutable(plan: UploadPlan): boolean {
  return plan.unsupported.length === 0 && plan.oversized.length === 0;
}
