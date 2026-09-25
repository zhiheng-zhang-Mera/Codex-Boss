import fs from "node:fs";
import path from "node:path";
import type { ApiProtocol, ApiProviderSetting, ProviderId, UpdateApiSettingInput } from "../src/shared/provider-contracts";
import { PROVIDER_MODEL_DEFAULTS } from "../src/shared/provider-models";

type StoredApiSetting = Omit<ApiProviderSetting, "hasApiKey"> & { encryptedApiKey?: string };
type Protect = (plainText: string) => string;
type Unprotect = (cipherText: string) => string;

/**
 * The defaults a stored setting falls back to.
 *
 * Taken from `src/shared/provider-models.ts` rather than spelled out here, so there is ONE declaration
 * of which model Boss asks for. That is what makes the declared-vs-observed contract meaningful: the
 * test checks the values the application actually uses, not a copy that can drift from them. It is how
 * `deepseek-v4-flash` — a model the DeepSeek endpoint does not serve — stayed in this file unnoticed.
 */
const defaults: Record<string, { protocol: ApiProtocol; baseUrl: string; model: string }> = Object.fromEntries(
  Object.entries(PROVIDER_MODEL_DEFAULTS).map(([provider, entry]) => [provider, { protocol: entry.protocol as ApiProtocol, baseUrl: entry.baseUrl, model: entry.model }])
);

export class ApiSettingsStore {
  private settings: StoredApiSetting[];

  constructor(private readonly filePath: string, private readonly protect: Protect, private readonly unprotect: Unprotect) {
    this.settings = this.read();
  }

  snapshot(providerIds: ProviderId[]): ApiProviderSetting[] {
    return providerIds.map((providerId) => {
      const stored = this.findOrDefault(providerId);
      // U5/security: expose only a masked tail for display (sk-••••42A9), never
      // the full key to the renderer.
      let keyTail: string | undefined;
      if (stored.encryptedApiKey) {
        try {
          const plain = this.unprotect(stored.encryptedApiKey).trim();
          keyTail = plain.slice(-4);
        } catch {
          keyTail = undefined;
        }
      }
      return { providerId, enabled: stored.enabled, protocol: stored.protocol, baseUrl: stored.baseUrl, model: stored.model, hasApiKey: Boolean(stored.encryptedApiKey), keyTail, updatedAt: stored.updatedAt };
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
