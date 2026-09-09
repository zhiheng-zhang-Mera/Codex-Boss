/**
 * Attachment Store (plan 9-7 §5/§34). Durable local persistence for files the
 * user uploads / pastes into a conversation.
 *
 * Layout (conversation-scoped, restart-safe):
 *   <root>/<conversation-id>/<attachment-id>/original.<ext>
 *   <root>/<conversation-id>/<attachment-id>/metadata.json
 *
 * The store owns bytes + integrity metadata; the StateStore owns the
 * conversation input-object registry. No extraction/OCR/summary is created
 * here unless a workflow later asks for it.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { kindForFileName, validateInputObjectRef, type InputObject, type InputObjectRef } from "../../src/shared/input-object";

export interface AttachmentMetadata extends InputObjectRef {
  uploadedAt: string;
}

export interface ImportAttachmentInput {
  conversationId: string;
  originalName: string;
  mime?: string;
  /** Local file to import (dialog pick). */
  sourcePath?: string;
  /** Bytes to import (drag/drop + clipboard paste from the renderer). */
  bytes?: Uint8Array | Buffer;
}

export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;

function mimeForName(name: string): string | undefined {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".csv": "text/csv",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".zip": "application/zip",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".doc": "application/msword",
    ".xls": "application/vnd.ms-excel"
  };
  return map[ext];
}

function safeFileName(name: string): string {
  const cleaned = path.basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 120);
  return cleaned || "attachment";
}

function sha256Of(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export class AttachmentStore {
  constructor(private readonly root: string) {}

  private attachmentDir(conversationId: string, attachmentId: string): string {
    const dir = path.resolve(this.root, safeFileName(conversationId), safeFileName(attachmentId));
    const resolvedRoot = path.resolve(this.root);
    if (dir !== resolvedRoot && !dir.startsWith(resolvedRoot + path.sep)) throw new Error("Attachment path escapes store root");
    return dir;
  }

  private resolveAttachmentFile(conversationId: string, attachmentId: string): string | undefined {
    const dir = this.attachmentDir(conversationId, attachmentId);
    const metadata = this.readMetadata(conversationId, attachmentId);
    if (!metadata?.originalName) return undefined;
    const candidate = path.join(dir, `original${path.extname(metadata.originalName).toLowerCase()}`);
    return fs.existsSync(candidate) ? candidate : undefined;
  }

  private readMetadata(conversationId: string, attachmentId: string): AttachmentMetadata | undefined {
    try {
      const raw = fs.readFileSync(path.join(this.attachmentDir(conversationId, attachmentId), "metadata.json"), "utf8");
      return JSON.parse(raw) as AttachmentMetadata;
    } catch {
      return undefined;
    }
  }

  private writeAttachment(attachmentId: string, metadata: AttachmentMetadata, bytes: Uint8Array): void {
    const dir = this.attachmentDir(metadata.conversationId, attachmentId);
    fs.mkdirSync(dir, { recursive: true });
    const extension = path.extname(metadata.originalName ?? "").toLowerCase() || "";
    const file = path.join(dir, `original${extension}`);
    fs.writeFileSync(file, bytes, { flag: "wx" });
    try { fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8"); }
    catch (error) {
      // Never leave a metadata-less orphan directory: roll back the bytes.
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Imports one file or byte payload into the store and returns the durable
   * InputObject. Duplicate byte content gets a fresh id (upload ≠ dedupe);
   * the caller decides conversation registry semantics.
   */
  importAttachment(input: ImportAttachmentInput): InputObject {
    const { conversationId, originalName } = input;
    if (!conversationId?.trim()) throw new Error("Attachment requires a conversation");
    if (!originalName?.trim()) throw new Error("Attachment requires a file name");
    const name = safeFileName(originalName);
    let bytes: Uint8Array;
    if (input.sourcePath) {
      if (!fs.existsSync(input.sourcePath) || !fs.statSync(input.sourcePath).isFile()) throw new Error(`Attachment source does not exist: ${input.sourcePath}`);
      const stat = fs.statSync(input.sourcePath);
      if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error(`附件超过大小上限（${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB）`);
      bytes = fs.readFileSync(input.sourcePath);
    } else if (input.bytes) {
      if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`附件超过大小上限（${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB）`);
      bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
    } else {
      throw new Error("Attachment requires sourcePath or bytes");
    }
    const now = new Date().toISOString();
    const ref: InputObjectRef = {
      id: randomUUID(),
      source: "UPLOAD",
      kind: kindForFileName(name),
      conversationId,
      originalName: name,
      mime: input.mime?.trim() || mimeForName(name),
      size: bytes.byteLength,
      sha256: sha256Of(bytes)
    };
    validateInputObjectRef(ref);
    const metadata: AttachmentMetadata = { ...ref, uploadedAt: now };
    this.writeAttachment(ref.id, metadata, bytes);
    return { ...ref, createdAt: now };
  }

  /** Local path of the stored bytes for a conversation attachment, if present. */
  localPathFor(conversationId: string, attachmentId: string): string | undefined {
    return this.resolveAttachmentFile(conversationId, attachmentId);
  }

  /** Metadata for one attachment (used to rebuild refs after restart). */
  metadataFor(conversationId: string, attachmentId: string): AttachmentMetadata | undefined {
    return this.readMetadata(conversationId, attachmentId);
  }

  /** All attachments currently on disk for a conversation, newest last. */
  listForConversation(conversationId: string): AttachmentMetadata[] {
    const directory = path.resolve(this.root, safeFileName(conversationId));
    if (!fs.existsSync(directory)) return [];
    const result: AttachmentMetadata[] = [];
    for (const attachmentId of fs.readdirSync(directory)) {
      const metadata = this.readMetadata(conversationId, attachmentId);
      if (metadata) result.push(metadata);
    }
    return result.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  }

  /** Deletes one attachment (bytes + metadata). Returns true when removed. */
  removeAttachment(conversationId: string, attachmentId: string): boolean {
    const dir = this.attachmentDir(conversationId, attachmentId);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  /** Removes every attachment of a conversation (cascade delete). */
  removeConversation(conversationId: string): void {
    const directory = path.resolve(this.root, safeFileName(conversationId));
    if (!fs.existsSync(directory)) return;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
