import React, { useEffect, useRef, useState } from "react";
export interface HistoryDialogState {
  mode: "create-conversation" | "rename-conversation" | "create-folder" | "rename-folder";
  targetId?: string; folderId?: string; value: string;
}
export function HistoryNameDialog({ state, onSubmit, onClose }: { state: HistoryDialogState; onSubmit: (value: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(state.value);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); input.current?.select(); }, []);
  const title = { "create-conversation": "新对话", "rename-conversation": "重命名对话", "create-folder": "新文件夹", "rename-folder": "重命名文件夹" }[state.mode];
  return <dialog ref={dialog} className="history-name-dialog" aria-labelledby="history-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (busy || !value.trim()) return; setBusy(true); setError(""); void onSubmit(value.trim()).then(onClose).catch((reason) => setError(String(reason))).finally(() => setBusy(false)); }}>
      <h2 id="history-dialog-title">{title}</h2>
      <label>名称<input ref={input} autoFocus value={value} maxLength={80} required disabled={busy} onChange={(event) => setValue(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy || !value.trim()}>{busy ? "保存中…" : "确认"}</button></div>
    </form>
  </dialog>;
}
