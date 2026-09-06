import React, { useEffect, useRef } from "react";

/** Right-click / "···" conversation menu (Phase 1). Same actions both ways. */
export interface ConversationMenuState {
  conversationId: string;
  x: number;
  y: number;
}

export interface ConversationMenuActions {
  rename: (conversationId: string) => void;
  move: (conversationId: string) => void;
  duplicate: (conversationId: string) => void;
  export: (conversationId: string) => void;
  archive: (conversationId: string) => void;
  delete: (conversationId: string) => void;
}

export function ConversationContextMenu({ state, actions, onClose }: { state: ConversationMenuState; actions: ConversationMenuActions; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", key); };
  }, [onClose]);
  const run = (action: (conversationId: string) => void) => () => { onClose(); action(state.conversationId); };
  const item = (label: string, action: (conversationId: string) => void, dangerous = false) => <button type="button" className={dangerous ? "menu-danger" : ""} onClick={run(action)}>{label}</button>;
  return <div ref={menu} className="conversation-context-menu" style={{ left: Math.min(state.x, window.innerWidth - 180), top: Math.min(state.y, window.innerHeight - 220) }} role="menu" aria-label="对话操作">
    {item("重命名", actions.rename)}
    {item("移动到文件夹", actions.move)}
    {item("创建副本", actions.duplicate)}
    {item("导出", actions.export)}
    {item("归档 / 取消归档", actions.archive)}
    <div className="menu-separator" />
    {item("删除", actions.delete, true)}
  </div>;
}
