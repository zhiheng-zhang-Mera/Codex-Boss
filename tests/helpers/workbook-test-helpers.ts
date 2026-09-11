/**
 * Shared test helper: ingests inline text through the real pipeline so
 * contract/role/registry tests exercise production ingestion rather than
 * hand-built fixtures.
 */
import { ingestDocument } from "../../electron/ingestion/ingest";
import type { CanonicalTaskDocument } from "../../src/shared/workbook";

export const FIXED_NOW = "2026-01-01T00:00:00.000Z";

export async function ingressFromText(fileName: string, text: string): Promise<CanonicalTaskDocument> {
  return ingestDocument({
    file_name: fileName,
    bytes: new Uint8Array(Buffer.from(text, "utf8")),
    source_type: "UPLOAD",
    created_at: FIXED_NOW
  });
}
