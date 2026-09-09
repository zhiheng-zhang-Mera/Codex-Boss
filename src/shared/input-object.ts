/**
 * Unified input model (plan §3). A task no longer has to stuff every input
 * into its prompt string: inputs are typed objects referenced by tasks and
 * conversations, and materialized only when a capability needs them.
 *
 * Pure contract — renderer/electron shareable, no fs/network here.
 */

export type InputObjectSource = "UPLOAD" | "PASTE" | "LOCAL_PATH" | "GITHUB" | "URL";
export type InputObjectKind =
  | "TEXT"
  | "IMAGE"
  | "PDF"
  | "DOCUMENT"
  | "SPREADSHEET"
  | "ARCHIVE"
  | "CODE"
  | "REPOSITORY"
  | "WEB";

export const INPUT_OBJECT_SOURCES: readonly InputObjectSource[] = ["UPLOAD", "PASTE", "LOCAL_PATH", "GITHUB", "URL"];
export const INPUT_OBJECT_KINDS: readonly InputObjectKind[] = [
  "TEXT", "IMAGE", "PDF", "DOCUMENT", "SPREADSHEET", "ARCHIVE", "CODE", "REPOSITORY", "WEB"
];

/** Deterministic extension map; source of truth for classification without a model. */
const EXTENSION_KIND: Record<string, InputObjectKind> = {
  ".md": "TEXT", ".txt": "TEXT", ".text": "TEXT",
  ".png": "IMAGE", ".jpg": "IMAGE", ".jpeg": "IMAGE", ".gif": "IMAGE", ".webp": "IMAGE", ".bmp": "IMAGE", ".svg": "IMAGE",
  ".pdf": "PDF",
  ".doc": "DOCUMENT", ".docx": "DOCUMENT", ".rtf": "DOCUMENT", ".odt": "DOCUMENT",
  ".xls": "SPREADSHEET", ".xlsx": "SPREADSHEET", ".csv": "SPREADSHEET", ".ods": "SPREADSHEET",
  ".zip": "ARCHIVE", ".rar": "ARCHIVE", ".7z": "ARCHIVE", ".tar": "ARCHIVE", ".gz": "ARCHIVE",
  ".ts": "CODE", ".tsx": "CODE", ".js": "CODE", ".jsx": "CODE", ".py": "CODE", ".rs": "CODE", ".go": "CODE",
  ".java": "CODE", ".c": "CODE", ".cpp": "CODE", ".h": "CODE", ".hpp": "CODE", ".cs": "CODE", ".rb": "CODE",
  ".php": "CODE", ".sh": "CODE", ".ps1": "CODE", ".json": "CODE", ".yaml": "CODE", ".yml": "CODE",
  ".toml": "CODE", ".xml": "CODE", ".html": "CODE", ".css": "CODE", ".sql": "CODE", ".tex": "CODE"
};

/** Lightweight reference embedded in tasks/conversations/context packages. */
export interface InputObjectRef {
  id: string;
  source: InputObjectSource;
  kind: InputObjectKind;
  conversationId: string;
  originalName?: string;
  mime?: string;
  size?: number;
  sha256?: string;
  localPath?: string;
  sourceUrl?: string;
}

/** Full input record: a ref plus its durable creation stamp. */
export interface InputObject extends InputObjectRef {
  createdAt: string;
}

export interface WorkspaceRef {
  workspaceId?: string;
  workspacePath?: string;
}

/**
 * The unified task input (plan §3). `message` stays the compact instruction
 * (never the whole pasted document); long content arrives as inputObjects.
 */
export interface TaskInput {
  message: string;
  inputObjects: InputObjectRef[];
  workspace?: WorkspaceRef;
}

export function isInputObjectSource(value: unknown): value is InputObjectSource {
  return typeof value === "string" && (INPUT_OBJECT_SOURCES as readonly string[]).includes(value);
}

export function isInputObjectKind(value: unknown): value is InputObjectKind {
  return typeof value === "string" && (INPUT_OBJECT_KINDS as readonly string[]).includes(value);
}

/** True when the task has nothing besides its message (legacy shape). */
export function hasInputObjects(refs: InputObjectRef[] | undefined): boolean {
  return Array.isArray(refs) && refs.length > 0;
}

/** Drops the durable stamp so an InputObject can live inside a task context. */
export function toInputObjectRef(input: InputObject): InputObjectRef {
  const { id, source, kind, conversationId, originalName, mime, size, sha256, localPath, sourceUrl } = input;
  return { id, source, kind, conversationId, originalName, mime, size, sha256, localPath, sourceUrl };
}

/** Validates a ref strictly; returns it unchanged on success. Fail-closed. */
export function validateInputObjectRef(ref: InputObjectRef): InputObjectRef {
  if (!ref || typeof ref !== "object") throw new Error("Input object ref is required");
  if (typeof ref.id !== "string" || !ref.id.trim() || ref.id.length > 200) throw new Error("Invalid input object id");
  if (!isInputObjectSource(ref.source)) throw new Error(`Unknown input object source: ${String(ref.source)}`);
  if (!isInputObjectKind(ref.kind)) throw new Error(`Unknown input object kind: ${String(ref.kind)}`);
  if (typeof ref.conversationId !== "string" || !ref.conversationId.trim()) throw new Error("Input object requires a conversation");
  if (ref.originalName !== undefined && (typeof ref.originalName !== "string" || ref.originalName.length > 260)) throw new Error("Invalid input object name");
  if (ref.mime !== undefined && (typeof ref.mime !== "string" || ref.mime.length > 200)) throw new Error("Invalid input object mime");
  if (ref.size !== undefined && (!Number.isInteger(ref.size) || ref.size < 0)) throw new Error("Invalid input object size");
  if (ref.sha256 !== undefined && (typeof ref.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(ref.sha256))) throw new Error("Invalid input object sha256");
  if (ref.localPath !== undefined && typeof ref.localPath !== "string") throw new Error("Invalid input object path");
  if (ref.sourceUrl !== undefined && typeof ref.sourceUrl !== "string") throw new Error("Invalid input object url");
  return ref;
}

/** Classifies a file name deterministically; unknown names default to TEXT. */
export function kindForFileName(name: string): InputObjectKind {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "TEXT";
  return EXTENSION_KIND[name.slice(dot).toLowerCase()] ?? "TEXT";
}

/** Builds the compact user-facing TaskInput from a message + refs. */
export function buildTaskInput(message: string, inputObjects: InputObjectRef[], workspace?: WorkspaceRef): TaskInput {
  const clean = (message ?? "").trim();
  const refs = (inputObjects ?? []).map(validateInputObjectRef);
  if (!clean && refs.length === 0) throw new Error("Task input requires a message or at least one input object");
  if (clean.length > 100000) throw new Error("Task message must contain 1–100000 characters");
  const result: TaskInput = { message: clean, inputObjects: refs };
  if (workspace?.workspaceId || workspace?.workspacePath) result.workspace = { ...workspace };
  return result;
}

/** Deduplicates refs by id, keeping first occurrence order. */
export function uniqueInputObjectRefs(refs: InputObjectRef[]): InputObjectRef[] {
  const seen = new Set<string>();
  const result: InputObjectRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    result.push(ref);
  }
  return result;
}
