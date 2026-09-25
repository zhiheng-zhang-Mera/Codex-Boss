import type { ProviderId } from "../src/shared/provider-contracts";
import type { ProviderUsage } from "./runtimes/runtime";
import { ApiSettingsStore } from "./api-settings";

export class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAt?: number) { super(message); }
}

export interface ApiCompletion {
  content: string;
  sourceUrl: string;
  adapterVersion: string;
  /**
   * Token usage the provider actually reported, or ABSENT when it reported none.
   *
   * Absent rather than defaulted. A provider that returns no usage block yields no `usage` here, and
   * the ledger records nothing for it — which is what keeps `inputTokens` unmeasured instead of
   * quietly becoming zero.
   */
  usage?: ProviderUsage;
}

/**
 * Read a number only when the provider really supplied one.
 *
 * Every accessor funnels through here so a missing field, a `null`, a string and a NaN all read as
 * `undefined` — "not reported". A `0` the provider actually returned IS reported as 0, which is a
 * measurement of nothing rather than a missing measurement.
 */
function reportedNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return undefined;
}

/** Drop a usage object carrying no figure at all, so "no usage" and "empty usage" read alike. */
function usageOrUndefined(candidate: ProviderUsage): ProviderUsage | undefined {
  return Object.values(candidate).some((value) => value !== undefined) ? candidate : undefined;
}

/**
 * `usage.prompt_tokens` / `completion_tokens` / `total_tokens`.
 *
 * The OpenAI-compatible schema, which most providers here speak: `electron/api-settings.ts` gives
 * chatgpt, deepseek, qwen and kimi that protocol.
 */
export function openAiCompatibleUsage(body: unknown): ProviderUsage | undefined {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  return usageOrUndefined({
    inputTokens: reportedNumber(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: reportedNumber(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: reportedNumber(usage.total_tokens)
  });
}

/** Anthropic's `usage.input_tokens` / `usage.output_tokens`. */
export function anthropicUsage(body: unknown): ProviderUsage | undefined {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  return usageOrUndefined({
    inputTokens: reportedNumber(usage.input_tokens),
    outputTokens: reportedNumber(usage.output_tokens)
  });
}

/** Gemini's `usageMetadata.promptTokenCount` / `candidatesTokenCount` / `totalTokenCount`. */
export function geminiUsage(body: unknown): ProviderUsage | undefined {
  const metadata = (body as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return usageOrUndefined({
    inputTokens: reportedNumber(metadata.promptTokenCount),
    outputTokens: reportedNumber(metadata.candidatesTokenCount),
    totalTokens: reportedNumber(metadata.totalTokenCount)
  });
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
    const usage = openAiCompatibleUsage(body);
    return { content, sourceUrl, adapterVersion: "api-openai-compatible/v1", ...(usage ? { usage } : {}) };
  }

  private async anthropic(connection: ReturnType<ApiSettingsStore["connection"]>, prompt: string, signal: AbortSignal): Promise<ApiCompletion> {
    const sourceUrl = `${connection.baseUrl}/v1/messages`;
    const body = await jsonRequest(this.request, sourceUrl, { method: "POST", signal, headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: connection.model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }) });
    const content = (body as { content?: Array<{ type?: string; text?: string }> }).content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n");
    if (!content?.trim()) throw new Error("Anthropic API 返回中没有可用回答");
    const usage = anthropicUsage(body);
    return { content, sourceUrl, adapterVersion: "api-anthropic/v1", ...(usage ? { usage } : {}) };
  }

  private async gemini(connection: ReturnType<ApiSettingsStore["connection"]>, prompt: string, signal: AbortSignal): Promise<ApiCompletion> {
    const sourceUrl = `${connection.baseUrl}/models/${encodeURIComponent(connection.model)}:generateContent`;
    const requestUrl = `${sourceUrl}?key=${encodeURIComponent(connection.apiKey)}`;
    const body = await jsonRequest(this.request, requestUrl, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }) });
    const content = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n");
    if (!content?.trim()) throw new Error("Gemini API 返回中没有可用回答");
    const usage = geminiUsage(body);
    return { content, sourceUrl, adapterVersion: "api-gemini/v1", ...(usage ? { usage } : {}) };
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
