import type { Provider, ProviderId } from "../../src/shared/contracts";

export interface AdapterDefinition {
  providerId: ProviderId;
  version: string;
  inputSelectors: string[];
  responseSelectors: string[];
  stopSelectors: string[];
  sendLabels: string[];
  /**
   * Visible send affordance: "click" (default, a labelled/configured button)
   * or "enter" for providers whose composer has NO send button and submits
   * from the visible text input with Enter (verified live for DeepSeek).
   */
  sendMode?: "click" | "enter";
  /** File input element candidates, newest first (input[type=file]). Phase D. */
  fileInputSelectors?: string[];
  /** Selectors for rendered attachment chips used to confirm an upload. */
  attachmentSelectors?: string[];
  /** File kinds this adapter is known to accept (verified upload surface). */
  uploadKinds?: Array<"IMAGE" | "PDF" | "DOCUMENT" | "SPREADSHEET" | "ARCHIVE">;
  /** URL that starts a brand-new conversation for this provider (U6 §12.1). */
  newConversationUrl?: string;
}

const commonInputs = ["textarea", "div[contenteditable='true'][role='textbox']", "div[contenteditable='true']"];
const commonResponses = ["[data-message-author-role='assistant']", "[data-testid*='assistant']", ".markdown"];

const chatgptFileInputs = ["input[type='file']"];
const chatgptAttachments = ["[data-testid*='file']", "[data-testid='composer-attachments']", "[data-testid*='attachment']"];

const definitions: Record<string, AdapterDefinition> = {
  chatgpt: { providerId: "chatgpt", version: "chatgpt-web/2026-09-v1", inputSelectors: ["#prompt-textarea", "div[data-virtualkeyboard='true']", ...commonInputs], responseSelectors: ["[data-message-author-role='assistant']", ...commonResponses], stopSelectors: ["button[data-testid='stop-button']", "button[aria-label*='Stop']"], sendLabels: ["send", "发送"], fileInputSelectors: chatgptFileInputs, attachmentSelectors: chatgptAttachments, uploadKinds: ["IMAGE", "PDF", "DOCUMENT", "SPREADSHEET", "ARCHIVE"], newConversationUrl: "https://chatgpt.com/" },
  gemini: { providerId: "gemini", version: "gemini-web/2026-09-v1", inputSelectors: ["div.ql-editor[contenteditable='true']", "div[aria-label*='prompt'][contenteditable='true']", ...commonInputs], responseSelectors: ["model-response", ".model-response-text", ...commonResponses], stopSelectors: ["button[aria-label*='Stop']", "button[aria-label*='停止']"], sendLabels: ["send", "发送"], fileInputSelectors: ["input[type='file']"], attachmentSelectors: [".file-preview", "[data-test-id*='file']", "mat-chip"], uploadKinds: ["IMAGE", "PDF"], newConversationUrl: "https://gemini.google.com/app" },
  claude: { providerId: "claude", version: "claude-web/2026-09-v1", inputSelectors: ["div.ProseMirror[contenteditable='true']", "div[data-placeholder][contenteditable='true']", ...commonInputs], responseSelectors: ["[data-testid='assistant-message']", ".font-claude-response", ...commonResponses], stopSelectors: ["button[aria-label*='Stop']", "button[aria-label*='停止']"], sendLabels: ["send", "发送"], fileInputSelectors: ["input[type='file']"], attachmentSelectors: ["[data-testid*='attachment']", "[class*='attachment']"], uploadKinds: ["IMAGE", "PDF", "DOCUMENT"], newConversationUrl: "https://claude.ai/new" },
  deepseek: { providerId: "deepseek", version: "deepseek-web/2026-09-v2", inputSelectors: commonInputs, responseSelectors: [".ds-markdown", ...commonResponses], stopSelectors: ["button[aria-label*='停止']", "button[aria-label*='Stop']"], sendLabels: ["send", "发送"], sendMode: "enter", fileInputSelectors: ["input[type='file']"], attachmentSelectors: ["[data-testid*='file']", "[class*='file']"], uploadKinds: ["IMAGE", "PDF", "DOCUMENT"], newConversationUrl: "https://chat.deepseek.com/" },
  qwen: { providerId: "qwen", version: "qwen-web/2026-09-v1", inputSelectors: commonInputs, responseSelectors: [".qwen-markdown", ...commonResponses], stopSelectors: ["button[aria-label*='停止']", "button[aria-label*='Stop']"], sendLabels: ["send", "发送"], newConversationUrl: "https://chat.qwen.ai/" },
  kimi: { providerId: "kimi", version: "kimi-web/2026-09-v1", inputSelectors: commonInputs, responseSelectors: [".segment-content", ...commonResponses], stopSelectors: ["button[aria-label*='停止']", "button[aria-label*='Stop']"], sendLabels: ["send", "发送"], newConversationUrl: "https://www.kimi.com/" },
  grok: { providerId: "grok", version: "grok-web/2026-09-v2", inputSelectors: ["div.ProseMirror[contenteditable='true']", "div[contenteditable='true'][role='textbox']", "div[contenteditable='true'][data-placeholder]", "textarea[placeholder*='Ask']", "textarea[aria-label*='Ask']", ...commonInputs], responseSelectors: ["[data-testid*='assistant']", "[data-testid*='message'] .markdown", ".markdown", ...commonResponses], stopSelectors: ["button[aria-label*='Stop']", "button[aria-label*='停止']"], sendLabels: ["send", "submit", "发送", "提交"], fileInputSelectors: ["input[type='file']"], attachmentSelectors: ["[data-testid*='attachment']", "[class*='attachment']"], uploadKinds: ["IMAGE", "PDF"], newConversationUrl: "https://grok.com/" }
};

export function adapterFor(provider: Provider): AdapterDefinition | null {
  if (provider.isCustom) return null;
  return definitions[provider.id] ?? null;
}

export function supportedAdapterIds(): ProviderId[] {
  return Object.keys(definitions);
}
