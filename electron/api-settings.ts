import fs from "node:fs";
import path from "node:path";
import type { ApiProtocol, ApiProviderSetting, ProviderId, UpdateApiSettingInput } from "../src/shared/contracts";

type StoredApiSetting = Omit<ApiProviderSetting, "hasApiKey"> & { encryptedApiKey?: string };
type Protect = (plainText: string) => string;
type Unprotect = (cipherText: string) => string;

const defaults: Record<string, { protocol: ApiProtocol; baseUrl: string; model: string }> = {
  chatgpt: { protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-5" },
  gemini: { protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" },
  claude: { protocol: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
  deepseek: { protocol: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  qwen: { protocol: "openai-compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  kimi: { protocol: "openai-compatible", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2-0905-preview" }
};

export class ApiSettingsStore {
  private settings: StoredApiSetting[];

  constructor(private readonly filePath: string, private readonly protect: Protect, private readonly unprotect: Unprotect) {
    this.settings = this.read();
  }

  snapshot(providerIds: ProviderId[]): ApiProviderSetting[] {
    return providerIds.map((providerId) => {
      const stored = this.findOrDefault(providerId);
      return { providerId, enabled: stored.enabled, protocol: stored.protocol, baseUrl: stored.baseUrl, model: stored.model, hasApiKey: Boolean(stored.encryptedApiKey), updatedAt: stored.updatedAt };
    });
  }

  update(input: UpdateApiSettingInput): void {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const model = input.model.trim();
    if (!model) throw new Error("API 模型名称不能为空");
    const current = this.findOrDefault(input.providerId);
    const next: StoredApiSetting = { ...current, enabled: input.enabled, protocol: input.protocol, baseUrl, model, updatedAt: new Date().toISOString() };
    if (input.clearApiKey) delete next.encryptedApiKey;
    if (input.apiKey?.trim()) next.encryptedApiKey = this.protect(input.apiKey.trim());
    const index = this.settings.findIndex((item) => item.providerId === input.providerId);
    if (index >= 0) this.settings[index] = next;
    else this.settings.push(next);
    this.persist();
  }

  assertReady(providerId: ProviderId): void {
    const setting = this.findOrDefault(providerId);
    if (!setting.enabled) throw new Error(`${providerId} API 尚未启用`);
    if (!setting.encryptedApiKey) throw new Error(`${providerId} API Key 尚未配置`);
  }

  connection(providerId: ProviderId): { protocol: ApiProtocol; baseUrl: string; model: string; apiKey: string } {
    this.assertReady(providerId);
    const setting = this.findOrDefault(providerId);
    return { protocol: setting.protocol, baseUrl: setting.baseUrl, model: setting.model, apiKey: this.unprotect(setting.encryptedApiKey!) };
  }

  private findOrDefault(providerId: ProviderId): StoredApiSetting {
    const existing = this.settings.find((item) => item.providerId === providerId);
    if (existing) return existing;
    const fallback = defaults[providerId] ?? { protocol: "openai-compatible" as const, baseUrl: "https://", model: "" };
    return { providerId, enabled: false, ...fallback, updatedAt: new Date(0).toISOString() };
  }

  private read(): StoredApiSetting[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as { settings?: StoredApiSetting[] };
      return Array.isArray(parsed.settings) ? parsed.settings : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, settings: this.settings }, null, 2), "utf8");
    try { fs.renameSync(temporary, this.filePath); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EXDEV", "EEXIST", "EPERM"].includes(code ?? "")) throw error;
      fs.copyFileSync(temporary, this.filePath);
      fs.unlinkSync(temporary);
    }
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error("API 地址必须使用 HTTPS");
  return url.toString().replace(/\/$/, "");
}
