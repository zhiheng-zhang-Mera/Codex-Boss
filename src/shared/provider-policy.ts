import type { CustomProviderInput, ProviderId } from "./contracts";

export const MAX_ACTIVE_PROVIDERS = 5;
export const DEFAULT_PROVIDER_IDS: ProviderId[] = ["chatgpt", "gemini", "claude"];

export function normalizeCustomProviderInput(input: CustomProviderInput): CustomProviderInput {
  const name = input.name.trim();
  if (!name || name.length > 50) throw new Error("自定义 AI 名称需为 1–50 个字符");
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new Error("请输入有效的网页地址");
  }
  if (url.protocol !== "https:") throw new Error("自定义网页 AI 仅支持 HTTPS 地址");
  return { name, url: url.toString() };
}
