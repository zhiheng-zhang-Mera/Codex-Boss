import React, { useState } from "react";
import type { WorkspacePathValidation } from "../../shared/workspace-path";
import { WORKSPACE_PATH_CODE_LABELS } from "../../shared/workspace-path";

/**
 * The one workspace path entry surface (Update-Plan/cleaning.md §1/§4/§11).
 *
 *   [ editable path text field ] [ Browse… ]
 *
 * Both entries reach the same model: Browse asks the main process for a native
 * folder selection and gets back the canonical path; typing leaves the user's
 * text exactly as typed and asks the main process what it means. The renderer
 * implements no path semantics of its own — it renders the code and reason the
 * main process returns.
 *
 * The field never rewrites what the user typed (scripts and tests inject raw
 * strings, and the desktop acceptance harness asserts the value it set is still
 * there). Cancelling the picker leaves the current value untouched.
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
  /** Reported when the picker or the validator cannot answer at all. */
  onError?(message: string): void;
}

export function WorkspacePathField({ label, ariaLabel, value, onChange, placeholder, disabled, onError }: WorkspacePathFieldProps) {
  const [status, setStatus] = useState<WorkspacePathValidation | null>(null);
  const [picking, setPicking] = useState(false);

  async function browse() {
    if (disabled || picking) return;
    setPicking(true);
    try {
      const picked = await window.boss.selectWorkspaceDirectory();
      // null === the user cancelled: the workspace they already had stays.
      if (picked === null || picked === undefined) { setStatus(null); return; }
      onChange(picked);
      setStatus({ ok: true, code: "OK", normalizedPath: picked, reason: `"${picked}" 是可用目录` });
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
      setStatus(await window.boss.validateWorkspacePath(typed));
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
    {status && !status.ok && <small className="workspace-path-problem">{WORKSPACE_PATH_CODE_LABELS[status.code] ?? status.code}：{status.reason}</small>}
    {status?.ok && <small className="workspace-path-ok">{status.normalizedPath}</small>}
  </div>;
}
