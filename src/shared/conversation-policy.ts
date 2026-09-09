/**
 * R43 Phase B (R-204): conversation policy (pure + shareable).
 *
 * A task chooses how its provider conversation is handled:
 *   PERSISTENT — the visible/primary conversation is reused & its history kept
 *                (chat default: the user keeps a manageable conversation);
 *   REUSABLE   — an existing conversation/session is resumed (repair/continue);
 *   TEMPORARY  — a fresh per-task conversation, not grown into the user's main
 *                history (automation default: no unbounded chat-history creep
 *                from unattended work on one account);
 *   AUTO_DELETE — a fresh conversation that is marked for Boss-side cleanup
 *                once the task final response exists (bulk/sensitive ops).
 *
 * Deterministic default mapping keeps the current product behavior unchanged
 * unless an explicit policy is supplied.
 */

export type ConversationPolicy = "PERSISTENT" | "REUSABLE" | "TEMPORARY" | "AUTO_DELETE";

export const CONVERSATION_POLICIES: readonly ConversationPolicy[] = ["PERSISTENT", "REUSABLE", "TEMPORARY", "AUTO_DELETE"];

export function isConversationPolicy(value: unknown): value is ConversationPolicy {
  return typeof value === "string" && (CONVERSATION_POLICIES as readonly string[]).includes(value);
}

export interface ConversationPolicyInput {
  appMode?: "chat" | "work";
  /** Existing conversation being resumed (continue/repair) when present. */
  resumeConversation?: boolean;
  /** The task opens a fresh provider conversation (WORK automation default). */
  freshWebConversation?: boolean;
}

/** Fresh conversation ⇒ nothing of the user's long-lived history is polluted. */
export function conversationPolicyFor(input: ConversationPolicyInput): ConversationPolicy {
  if (input.resumeConversation) return "REUSABLE";
  if (input.freshWebConversation) return "TEMPORARY";
  return "PERSISTENT";
}
