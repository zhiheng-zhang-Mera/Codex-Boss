/**
 * Time ONE real code-generation-shaped call, to establish whether the production 120 s ceiling in
 * `ProviderApiClient.complete` is a real constraint on the autonomous engineering path.
 *
 * Prints only durations and lengths — never the reply text, never the credential.
 *
 * Usage: node scripts/probe-codegen-latency.cjs --env <VAR> [--model <id>]
 */

const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const envName = arg("env", "DeepSeek_API");
const model = arg("model", "deepseek-flash");
const baseUrl = arg("base-url", "https://api.deepseek.com/v1").replace(/\/+$/, "");
const timeoutMs = Number(arg("timeout", "600000"));
const key = process.env[envName];

if (!key || !key.trim()) {
  console.log(JSON.stringify({ credential: "not found" }));
  process.exit(1);
}

const { openAiCompatibleUsage } = require("../dist-electron/electron/provider-api.js");

// The shape the coder is actually asked for: a bounded patch plus a full test file, as JSON.
const prompt = [
  "Return STRICT JSON only, no prose and no markdown fences.",
  'Shape: {"changes":[{"path":"tests/unit/example-properties.test.ts","content":"<the whole file>"}]}',
  "The file must be a complete vitest suite (about 80 lines) that imports { parseInterventionFile, interventionFileDocument } from \"../../src/shared/intervention-file\"",
  "and tests: (1) round-tripping a document, (2) that a malformed entry is reported unreadable rather than partially accepted, (3) that an unknown schemaVersion is unreadable.",
  "Use only public behaviour of those two functions. Include at least 6 test cases."
].join("\n");

(async () => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] })
    });
    const elapsedMs = Date.now() - startedAt;
    const text = await response.text();
    if (!response.ok) {
      console.log(JSON.stringify({ credential: "found", authenticated: false, status: response.status, elapsedMs }));
      process.exit(1);
    }
    const body = JSON.parse(text);
    const content = body.choices?.[0]?.message?.content ?? "";
    console.log(JSON.stringify({
      credential: "found",
      authenticated: true,
      model,
      elapsedMs,
      exceedsProductionCeiling: elapsedMs > 120000,
      contentChars: content.length,
      finishReason: body.choices?.[0]?.finish_reason ?? null,
      usage: openAiCompatibleUsage(body) ?? null
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ error: error.name, elapsedMs: Date.now() - startedAt }));
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
})();
