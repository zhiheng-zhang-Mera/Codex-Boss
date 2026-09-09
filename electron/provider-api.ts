import type { ProviderId } from "../src/shared/contracts";
import { ApiSettingsStore } from "./api-settings";

export class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAt?: number) { super(message); }
}

export interface ApiCompletion {
  content: string;
  sourceUrl: string;
  adapterVersion: string;
}

export class ProviderApiClient {
  constructor(private readonly settings: ApiSettingsStore, private readonly request: typeof fetch = fetch) {}

  validate(providerId: ProviderId): void {
    this.settings.assertReady(providerId);
  }

  async complete(providerId: ProviderId, prompt: string): Promise<ApiCompletion> {
    const connection = this.settings.connection(providerId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      if (connection.protocol === "anthropic") return await this.anthropic(connection, prompt, controller.signal);
      if (connection.protocol === "gemini") return await this.gemini(connection, prompt, controller.signal);
      return await this.openAiCompatible(connection, prompt, controller.signal);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async openAiCompatible(connection: ReturnType<ApiSettingsStore["connection"]>, prompt: string, signal: AbortSignal): Promise<ApiCompletion> {
    const sourceUrl = `${connection.baseUrl}/chat/completions`;
    const body = await jsonRequest(this.request, sourceUrl, { method: "POST", signal, headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: connection.model, messages: [{ role: "user", content: prompt }] }) });
    const content = (body as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
    if (!content?.trim()) throw new Error("API 返回中没有可用回答");
    return { content, sourceUrl, adapterVersion: "api-openai-compatible/v1" };
  }

  private async anthropic(connection: ReturnType<ApiSettingsStore["connection"]>, prompt: string, signal: AbortSignal): Promise<ApiCompletion> {
    const sourceUrl = `${connection.baseUrl}/v1/messages`;
    const body = await jsonRequest(this.request, sourceUrl, { method: "POST", signal, headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: connection.model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }) });
    const content = (body as { content?: Array<{ type?: string; text?: string }> }).content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n");
    if (!content?.trim()) throw new Error("Anthropic API 返回中没有可用回答");
    return { content, sourceUrl, adapterVersion: "api-anthropic/v1" };
  }

  private async gemini(connection: ReturnType<ApiSettingsStore["connection"]>, prompt: string, signal: AbortSignal): Promise<ApiCompletion> {
    const sourceUrl = `${connection.baseUrl}/models/${encodeURIComponent(connection.model)}:generateContent`;
    const requestUrl = `${sourceUrl}?key=${encodeURIComponent(connection.apiKey)}`;
    const body = await jsonRequest(this.request, requestUrl, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }) });
    const content = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n");
    if (!content?.trim()) throw new Error("Gemini API 返回中没有可用回答");
    return { content, sourceUrl, adapterVersion: "api-gemini/v1" };
  }
}

async function jsonRequest(request: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const response = await request(url, init);
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  if (!response.ok) {
    const detail = typeof body === "object" && body !== null ? JSON.stringify(body).slice(0, 500) : String(body).slice(0, 500);
    const retry = response.headers.get("retry-after");
    const seconds = retry ? Number(retry) : NaN;
    const deadline = retry ? Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000 : Date.parse(retry) : NaN;
    throw new ProviderHttpError(`HTTP ${response.status}: ${detail}`, response.status, Number.isFinite(deadline) ? deadline : undefined);
  }
  return body;
}
