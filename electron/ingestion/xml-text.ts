/**
 * Shared XML text helpers for OOXML readers (Work Unit 1). Kept in its own
 * module so the DOCX and XLSX readers stay independent of each other.
 */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", shy: "\u00ad"
};

/** Decodes XML character and named entities exactly once. */
export function unescapeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    return ENTITIES[body] ?? whole;
  });
}

export function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}

/** All `<tag ...>...</tag>` blocks, bounded by a caller-supplied cap. */
export function matchBlocks(xml: string, tag: string, limit = 100000): string[] {
  const pattern = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>|<${tag}\\b[^>]*/>`, "g");
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null && blocks.length < limit) blocks.push(match[0]);
  return blocks;
}

/** Concatenated `<t>` runs of one OOXML block (shared-string / inline text). */
export function extractTextRuns(block: string): string {
  const runs = block.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) ?? [];
  return runs.map((run) => unescapeXml(/<t\b[^>]*>([\s\S]*?)<\/t>/.exec(run)?.[1] ?? "")).join("");
}
