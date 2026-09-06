/**
 * Semantic JSON extraction (live web-AI robustness). Web AIs routinely wrap
 * the requested JSON in prose or a code fence (e.g. "Here are the sources:
 * ```json\n[{...}]\n```\nLet me know if…"). Host validation must accept the
 * JSON the model actually emitted without hallucinating anything itself: we
 * only extract a JSON entity that literally appears in the response.
 *
 * Used by the live research semantic provider (validation + canonical return),
 * the research role dispatcher (host validation) and the research conductor
 * (stage parsing).
 */

export function parseJsonObject(text: string): unknown {
  const entity = extractJsonEntity(text);
  if (entity === null) throw new Error("No valid JSON entity found in the worker response");
  return JSON.parse(entity);
}

/**
 * Extracts the first valid JSON entity (object or array) from a worker text:
 * 1. whole trimmed text when it already is JSON;
 * 2. the first ```json/``` fenced block;
 * 3. the first balanced {…} or […] region anywhere in the text.
 * Returns the canonical JSON substring, or null when nothing parses.
 */
export function extractJsonEntity(text: string): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const candidate = tryParse(trimmed);
    if (candidate !== null) return candidate;
  }
  const fence = /```(?:json|jsonl)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) {
    const candidate = tryParse(fence[1].trim());
    if (candidate !== null) return candidate;
  }
  for (const open of ["{", "["] as const) {
    const region = firstBalanced(text, open);
    if (region === null) continue;
    const candidate = tryParse(region);
    if (candidate !== null) return candidate;
  }
  return null;
}

function tryParse(text: string): string | null {
  try { JSON.parse(text); return text; } catch { return null; }
}

/** Returns the first balanced JSON region starting at the given opener (bounded). */
function firstBalanced(text: string, open: "{" | "["): string | null {
  const close = open === "{" ? "}" : "]";
  const start = text.indexOf(open);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const max = Math.min(text.length, start + 400_000); // bounded scan
  for (let index = start; index < max; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}
