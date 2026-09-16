/**
 * Declared provider model ids, and the contract that keeps them honest.
 *
 * ## The drift this exists to prevent
 *
 * `electron/api-settings.ts` and `src/shared/model-policy.ts` both declared `deepseek-v4-flash`. The
 * provider's live `GET /v1/models` offers `deepseek-flash` and `deepseek-v4-pro`, and nothing called
 * `deepseek-v4-flash`. A default that names a model the provider does not serve is not a cosmetic
 * problem: the first real call through the settings UI would have failed with a model-not-found error,
 * and until a live request was made nothing in the repository could have noticed.
 *
 * ## Why the catalogue is static, and what the refresh is for
 *
 * The declaration is pinned here rather than fetched at startup. Making Boot depend on a live provider
 * call would mean a provider outage, a rate limit or an offline machine changed what Boss believes it
 * can ask for — a network round trip on the critical path of a desktop application's boot, to answer a
 * question whose answer changes a few times a year.
 *
 * So the static list is authoritative for what Boss WILL ask for, and an optional refresh exists to
 * tell a reader whether that list still matches what the provider OFFERS. `modelDrift` compares the
 * two and reports the difference in both directions; nothing acts on it automatically, because acting
 * on it would be the startup dependency this design avoids. A contract test holds the declaration to
 * the provider's published list, which is where a drift should surface — at review time, not at boot.
 */

/** The provider default a stored API setting falls back to, keyed by provider. */
interface ProviderModelDefault {
  protocol: string;
  baseUrl: string;
  /** The model id Boss asks for unless the Owner has chosen another. */
  model: string;
  /**
   * Every model id Boss knows this provider serves.
   *
   * Wider than `model` because Boss selects models per stage — the policy layer picks a cheaper model
   * to classify and a stronger one to adjudicate — so "what is the default" and "what may be selected"
   * are different questions, and a catalogue that answered only the first would report a legitimate
   * per-stage choice as an undeclared model.
   */
  models: string[];
}

/**
 * What a live capability refresh observed.
 *
 * Absent unless a refresh actually ran, so "nobody checked" is never confused with "checked and clean".
 */
interface ProviderModelObservation {
  /** The ids the provider's own `/models` returned. */
  observed: string[];
  /** When the observation was made, so a stale refresh is visible as stale. */
  observedAt: string;
}

/**
 * The declared defaults for every provider Boss ships settings for.
 *
 * Exactly the shape `electron/api-settings.ts` stores, so this is the declaration rather than a second
 * copy of it: the settings store derives its defaults from here, which is what makes the contract test
 * meaningful — it checks the values the application actually uses.
 */
export const PROVIDER_MODEL_DEFAULTS: Record<string, ProviderModelDefault> = {
  chatgpt: { protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-5", models: ["gpt-5"] },
  gemini: { protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash", models: ["gemini-2.5-flash"] },
  claude: { protocol: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5", models: ["claude-sonnet-4-5"] },
  // Observed on a live GET /v1/models: exactly these two. `deepseek-v4-flash` is NOT among them, and
  // was declared by both this default and the policy layer until the drift was found.
  deepseek: { protocol: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", models: ["deepseek-flash", "deepseek-v4-pro"] },
  qwen: { protocol: "openai-compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", models: ["qwen-plus"] },
  kimi: { protocol: "openai-compatible", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2-0905-preview", models: ["kimi-k2-0905-preview"] }
};

/**
 * Model ids that were declared once and are known NOT to be served.
 *
 * Kept as an explicit deny-list so a regression is caught by name: reintroducing `deepseek-v4-flash`
 * fails a test that says why, rather than passing silently because it happens to look plausible.
 */
export const RETIRED_MODEL_IDS: Record<string, string> = {
  "deepseek-v4-flash": "the DeepSeek endpoint serves deepseek-flash and deepseek-v4-pro; this id returned no model on a live /v1/models check"
};

/** Every model id Boss declares, per product, so a policy choice can be checked against it. */
function declaredModelVocabulary(): Array<{ product: string; models: string[] }> {
  return Object.entries(PROVIDER_MODEL_DEFAULTS).map(([product, entry]) => ({ product, models: [...entry.models] }));
}

/** Every declared model id, flattened and de-duplicated. */
export function declaredModelIds(): string[] {
  return [...new Set(declaredModelVocabulary().flatMap((entry) => entry.models))].sort();
}

/**
 * Compare what Boss DECLARES against what a provider OBSERVED.
 *
 * Reports the difference in both directions, because the two failures are different:
 *
 *  - `missing` — Boss offers a model the provider does not serve. This is the `deepseek-v4-flash` bug:
 *    the setting exists, it looks configured, and the first real call fails;
 *  - `undeclared` — the provider serves a model Boss does not offer. Not a failure, but worth seeing,
 *    because it is how a rename becomes visible before it becomes an outage.
 */
export function modelDrift(declared: readonly string[], observation?: ProviderModelObservation): {
  observed: string[];
  missing: string[];
  undeclared: string[];
  matches: boolean;
  /** Absent means no refresh has run, which is not the same as agreement. */
  checked: boolean;
} {
  if (!observation) return { observed: [], missing: [], undeclared: [], matches: true, checked: false };
  const observed = new Set(observation.observed);
  const declaredSet = new Set(declared);
  const missing = declared.filter((model) => !observed.has(model)).sort();
  const undeclared = observation.observed.filter((model) => !declaredSet.has(model)).sort();
  return { observed: [...observation.observed].sort(), missing, undeclared, matches: missing.length === 0, checked: true };
}

/**
 * Read the model ids out of an OpenAI-compatible `/models` response.
 *
 * The optional capability refresh, and nothing more: it parses what the provider said. An
 * unrecognised shape yields an empty list rather than a guess, so a refresh that could not be
 * understood is reported as an absence instead of as agreement.
 */
export function observedModelsFrom(body: unknown): string[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => (entry as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
}
