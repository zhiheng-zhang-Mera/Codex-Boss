import React, { useEffect, useRef, useState } from "react";
import type { WorkspacePathValidation } from "../../shared/workspace-path";
import { WORKSPACE_PATH_CODE_LABELS } from "../../shared/workspace-path";
import { restoreWorkspaceField } from "../../shared/workspace-selection";

/**
 * The one workspace path entry surface (Update-Plan/cleaning.md §1/§4/§6/§11).
 *
 *   [ editable path text field ] [ Browse… ]
 *
 * Both entries reach the same model: Browse asks the main process for a native
 * folder selection and gets back the canonical path; typing leaves the user's
 * text exactly as typed and asks the main process what it means. The renderer
 * implements no path semantics of its own — it renders the code and reason the
 * main process returns, and restores whatever the main process says may be
 * restored.
 *
 * The field never rewrites what the user typed (scripts and tests inject raw
 * strings, and the desktop acceptance harness asserts the value it set is still
 * there). Cancelling the picker leaves the current value untouched, and a
 * remembered workspace that has since disappeared is shown but marked unusable —
 * restoring it never starts anything (plan §6).
 */
export interface WorkspacePathFieldProps {
  /** Label text rendered beside the field. */
  label: string;
  /** aria-label of the text input — the stable handle automation binds to. */
  ariaLabel: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  disabled?: boolean;
  /** Restore the remembered workspace on mount (off for a field with its own source). */
  restoreRemembered?: boolean;
  /** Reported when the picker or the validator cannot answer at all. */
  onError?(message: string): void;
}

export function WorkspacePathField({ label, ariaLabel, value, onChange, placeholder, disabled, restoreRemembered = true, onError }: WorkspacePathFieldProps) {
  const [status, setStatus] = useState<WorkspacePathValidation | null>(null);
  const [notice, setNotice] = useState("");
  const [picking, setPicking] = useState(false);
  // The restore runs once per mount and never overwrites text the user already
  // typed while it was in flight.
  const restored = useRef(false);

  useEffect(() => {
    if (!restoreRemembered || restored.current) return;
    restored.current = true;
    let live = true;
    void window.boss.workspaceSelection().then((selection) => {
      if (!live) return;
      const restore = restoreWorkspaceField(selection);
      if (restore.value && !value.trim()) onChange(restore.value);
      setNotice(restore.notice ?? "");
    }).catch(() => { /* a stale or unreadable record is never a startup failure */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A validated path is remembered; an invalid one is never stored (plan §6). */
  async function remember(path: string) {
    try {
      await window.boss.rememberWorkspacePath(path);
    } catch (reason) {
      onError?.(String(reason));
    }
  }

  async function browse() {
    if (disabled || picking) return;
    setPicking(true);
    try {
      const picked = await window.boss.selectWorkspaceDirectory();
      // null === the user cancelled: the workspace they already had stays.
      if (picked === null || picked === undefined) { setStatus(null); return; }
      onChange(picked);
      setNotice("");
      setStatus({ ok: true, code: "OK", normalizedPath: picked, reason: `"${picked}" 是可用目录` });
      await remember(picked);
    } catch (reason) {
      setStatus(null);
      onError?.(String(reason));
    } finally {
      setPicking(false);
    }
  }

  async function validateTyped() {
    const typed = value.trim();
    if (!typed) { setStatus(null); return; }
    try {
      const result = await window.boss.validateWorkspacePath(typed);
      setStatus(result);
      if (result.ok) { setNotice(""); await remember(typed); }
    } catch (reason) {
      setStatus(null);
      onError?.(String(reason));
    }
  }

  return <div className="workspace-path-field">
    <label>{label}
      <span className="workspace-path-row">
        <input
          aria-label={ariaLabel}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => { setStatus(null); onChange(event.target.value); }}
          onBlur={() => void validateTyped()}
        />
        <button type="button" className="workspace-browse" disabled={disabled || picking} onClick={() => void browse()} title="使用 Windows 原生目录选择器">{picking ? "选择中…" : "浏览…"}</button>
      </span>
    </label>
    {notice && <small className="workspace-path-problem">{notice}</small>}
    {status && !status.ok && <small className="workspace-path-problem">{WORKSPACE_PATH_CODE_LABELS[status.code] ?? status.code}：{status.reason}</small>}
    {status?.ok && <small className="workspace-path-ok">{status.normalizedPath}</small>}
  </div>;
}
