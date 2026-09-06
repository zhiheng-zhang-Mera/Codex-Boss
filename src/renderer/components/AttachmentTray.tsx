import { useState } from "react";
import type { InputObjectRef } from "../../shared/input-object";

interface AttachmentTrayProps {
  /** Input objects registered on the conversation that no task has consumed yet. */
  pending: InputObjectRef[];
  busy: boolean;
  /** Uploads raw file objects from drag-drop / clipboard paste. */
  onFiles: (files: File[]) => Promise<void>;
  /** Opens the native multi-file dialog (main process imports paths directly). */
  onPick: () => Promise<void>;
  onRemove: (inputObjectId: string) => Promise<void>;
}

function shortBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload attachment tray (plan 9-7 §4): button picker, drag & drop, paste
 * images and removal. Renders the conversation's pending input objects as
 * chips that travel with the next message.
 */
export function AttachmentTray({ pending, busy, onFiles, onPick, onRemove }: AttachmentTrayProps) {
  const [dropActive, setDropActive] = useState(false);
  const [pasting, setPasting] = useState(false);

  const filesFromDataTransfer = (dataTransfer: DataTransfer): File[] =>
    Array.from(dataTransfer.files ?? []);

  async function submitFiles(files: File[]) {
    if (!files.length || busy) return;
    setPasting(true);
    try { await onFiles(files); }
    finally { setPasting(false); }
  }

  return <div
    className={`attachment-tray ${dropActive ? "drop-active" : ""} ${pending.length ? "has-attachments" : ""}`}
    onDragOver={(event) => { event.preventDefault(); setDropActive(true); }}
    onDragLeave={() => setDropActive(false)}
    onDrop={(event) => { event.preventDefault(); setDropActive(false); void submitFiles(filesFromDataTransfer(event.dataTransfer)); }}
    onPaste={(event) => { const files = filesFromDataTransfer(event.clipboardData); if (files.length) { event.preventDefault(); void submitFiles(files); } }}
  >
    {pending.length > 0 && <div className="attachment-chips">{pending.map((ref) => <span className="attachment-chip" key={ref.id} title={ref.originalName ?? ref.id}>
      <i className={`attachment-kind attachment-${ref.kind.toLowerCase()}`} />
      <span className="attachment-name">{ref.originalName ?? "附件"}</span>
      {ref.size !== undefined && <small>{shortBytes(ref.size)}</small>}
      <button type="button" aria-label={`移除 ${ref.originalName ?? "附件"}`} disabled={busy} onClick={() => void onRemove(ref.id)}>×</button>
    </span>)}</div>}
    <div className="attachment-actions">
      <button type="button" className="attachment-add" disabled={busy || pasting} title="上传文件 / 拖拽到此处 / Ctrl+V 粘贴图片" aria-label="上传文件" onClick={() => void onPick()}>＋</button>
      {pending.length === 0 && <span className="attachment-hint">上传文件、拖拽或 Ctrl+V 粘贴，随下一条消息一起发送</span>}
      {pending.length > 0 && <span className="attachment-count">{pending.length} 个附件将随消息发送</span>}
    </div>
  </div>;
}

