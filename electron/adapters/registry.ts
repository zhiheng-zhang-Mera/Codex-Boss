import type { Provider, ProviderId } from "../../src/shared/contracts";

export interface AdapterDefinition {
  providerId: ProviderId;
  version: string;
  inputSelectors: string[];
  responseSelectors: string[];
  stopSelectors: string[];
  sendLabels: string[];
}

const commonInputs = ["textarea", "div[contenteditable='true'][role='textbox']", "div[contenteditable='true']"];
const commonResponses = ["[data-message-author-role='assistant']", "[data-testid*='assistant']", ".markdown"];

const definitions: Record<string, AdapterDefinition> = {
  chatgpt: { providerId: "chatgpt", version: "chatgpt-web/2026-09-v1", inputSelectors: ["#prompt-textarea", "div[data-virtualkeyboard='true']", ...commonInputs], responseSelectors: ["[data-message-author-role='assistant']", ...commonResponses], stopSelectors: ["button[data-testid='stop-button']", "button[aria-label*='Stop']"], sendLabels: ["send", "发送"] },
  gemini: { providerId: "gemini", version: "gemini-web/2026-09-v1", inputSelectors: ["div.ql-editor[contenteditable='true']", "div[aria-label*='prompt'][contenteditable='true']", ...commonInputs], responseSelectors: ["model-response", ".model-response-text", ...commonResponses], stopSelectors: ["button[aria-label*='Stop']", "button[aria-label*='停止']"], sendLabels: ["send", "发送"] },
  claude: { providerId: "claude", version: "claude-web/2026-09-v1", inputSelectors: ["div.ProseMirror[contenteditable='true']", "div[data-placeholder][contenteditable='true']", ...commonInputs], responseSelectors: ["[data-testid='assistant-message']", ".font-claude-response", ...commonResponses], stopSelectors: ["button[aria-label*='Stop']", "button[aria-label*='停止']"], sendLabels: ["send", "发送"] },
  deepseek: { providerId: "deepseek", version: "deepseek-web/2026-09-v1", inputSelectors: commonInputs, responseSelectors: [".ds-markdown", ...commonResponses], stopSelectors: ["button[aria-label*='停止']", "button[aria-label*='Stop']"], sendLabels: ["send", "发送"] },
  qwen: { providerId: "qwen", version: "qwen-web/2026-09-v1", inputSelectors: commonInputs, responseSelectors: [".qwen-markdown", ...commonResponses], stopSelectors: ["button[aria-label*='停止']", "button[aria-label*='Stop']"], sendLabels: ["send", "发送"] },
  kimi: { providerId: "kimi", version: "kimi-web/2026-09-v1", inputSelectors: commonInputs, responseSelectors: [".segment-content", ...commonResponses], stopSelectors: ["button[aria-label*='停止']", "button[aria-label*='Stop']"], sendLabels: ["send", "发送"] }
};

export function adapterFor(provider: Provider): AdapterDefinition | null {
  if (provider.isCustom) return null;
  return definitions[provider.id] ?? null;
}

export function supportedAdapterIds(): ProviderId[] {
  return Object.keys(definitions);
}
