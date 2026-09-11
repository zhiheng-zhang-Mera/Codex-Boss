/**
 * Synthetic fixture builders for WorkBook ingestion tests.
 *
 * ZIP containers and PDFs are generated in-process, so the suite has no binary
 * fixtures to rot and tests exactly the bytes the adapters claim to support.
 * DOCX text conversion is delegated to mammoth in production, so the DOCX test
 * injects a converter through the adapter's documented seam rather than
 * asserting on a library-generated .docx.
 */
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}

export interface ZipFileInput {
  name: string;
  data: string | Uint8Array;
  /** Store instead of deflate. */
  stored?: boolean;
  /** Set bit 0 of the general purpose flags (encrypted marker). */
  encrypted?: boolean;
}

/** Minimal ZIP writer: local headers + central directory (classic, no ZIP64). */
export function buildZip(files: ZipFileInput[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = utf8(file.name);
    const raw = typeof file.data === "string" ? utf8(file.data) : file.data;
    const method = file.stored ? 0 : 8;
    const payload = method === 8 ? new Uint8Array(deflateRawSync(Buffer.from(raw))) : raw;
    const crc = crc32(raw);
    const flags = file.encrypted ? 0x0001 : 0;

    const local = new Uint8Array(30 + nameBytes.length + payload.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x21, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(payload, 30 + nameBytes.length);
    chunks.push(local);

    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralEntry.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, payload.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralEntry.set(nameBytes, 46);
    central.push(centralEntry);

    offset += local.length;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of [...chunks, ...central, eocd]) { out.set(chunk, cursor); cursor += chunk.length; }
  return out;
}

const DOCX_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * Minimal DOCX container carrying `document.xml` with the given paragraphs.
 * Used with the adapter's injected converter so the paragraph-mapping code is
 * tested deterministically; real conversion is mammoth's job.
 */
export function buildDocx(paragraphs: { text: string }[]): Uint8Array {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = paragraphs.map((paragraph) => `<w:p><w:r><w:t xml:space="preserve">${escape(paragraph.text)}</w:t></w:r></w:p>`).join("");
  return buildZip([
    {
      name: "[Content_Types].xml",
      data: `${DOCX_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    },
    {
      name: "word/document.xml",
      data: `${DOCX_HEADER}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`
    }
  ]);
}

export interface XlsxSheetInput {
  name: string;
  /** Row-major cell values; strings become shared strings, numbers stay numeric. */
  rows: (string | number)[][];
}

/** Builds a minimal but structurally valid XLSX with shared strings. */
export function buildXlsx(sheets: XlsxSheetInput[]): Uint8Array {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sharedStrings: string[] = [];
  const sharedIndex = new Map<string, number>();
  const indexFor = (value: string) => {
    const existing = sharedIndex.get(value);
    if (existing !== undefined) return existing;
    const index = sharedStrings.length;
    sharedStrings.push(value);
    sharedIndex.set(value, index);
    return index;
  };

  const columnName = (index: number) => {
    let value = index + 1;
    let name = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  };

  const sheetParts: ZipFileInput[] = sheets.map((sheet, sheetIndex) => {
    const rows = sheet.rows.map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => {
        const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
        if (typeof value === "number") return `<c r="${reference}"><v>${value}</v></c>`;
        return `<c r="${reference}" t="s"><v>${indexFor(value)}</v></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    return {
      name: `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      data: `${DOCX_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
    };
  });

  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${escape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbookRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");

  return buildZip([
    {
      name: "[Content_Types].xml",
      data: `${DOCX_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`
    },
    {
      name: "xl/workbook.xml",
      data: `${DOCX_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `${DOCX_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rIdShared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`
    },
    {
      name: "xl/sharedStrings.xml",
      data: `${DOCX_HEADER}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings.map((value) => `<si><t xml:space="preserve">${escape(value)}</t></si>`).join("")}</sst>`
    },
    ...sheetParts
  ]);
}

export interface PdfPageInput {
  /** One line of text per entry, drawn with Tj. */
  lines: string[];
}

/** Escapes text for a PDF literal string. */
function pdfString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export interface PdfBuildOptions {
  title?: string;
  /** Declare an /Encrypt dictionary (the adapter must refuse it). */
  encrypted?: boolean;
  /** Compress content streams with FlateDecode. */
  compressed?: boolean;
}

/**
 * Builds a minimal PDF with a real page tree, an accurate xref table and
 * optional compression/encryption markers. Objects are allocated in one pass
 * and emitted in a second, so references are always correct.
 */
export function buildPdf(pages: PdfPageInput[], options: PdfBuildOptions = {}): Uint8Array {
  let next = 1;
  const catalogNumber = next++;
  const pagesNumber = next++;
  type PagePlan = { objectNumber: number; contentObject: number; fontObject: number; lines: string[] };
  const plans: PagePlan[] = pages.map((page) => {
    const contentObject = next++;
    const fontObject = next++;
    return { objectNumber: next++, contentObject, fontObject, lines: page.lines };
  });
  const encryptNumber = options.encrypted ? next++ : undefined;
  const infoNumber = options.title ? next++ : undefined;
  const size = next;

  const objects = new Map<number, Buffer>();
  objects.set(catalogNumber, Buffer.from(`<< /Type /Catalog /Pages ${pagesNumber} 0 R >>`, "latin1"));
  objects.set(pagesNumber, Buffer.from(`<< /Type /Pages /Kids [${plans.map((plan) => `${plan.objectNumber} 0 R`).join(" ")}] /Count ${plans.length} >>`, "latin1"));

  for (const plan of plans) {
    // One text object per source line, each positioned with Td (the shape
    // pdfjs reports most predictably). No positional re-flow is assumed here.
    const body = plan.lines.map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 18} Td (${pdfString(line)}) Tj ET`).join("\n");
    const raw = Buffer.from(body, "latin1");
    if (options.compressed) {
      const compressed = new Uint8Array(deflateRawSync(raw));
      // The payload is binary: it must be assembled as bytes, never through a
      // JS string, or 8-bit values would be re-encoded as UTF-8.
      objects.set(plan.contentObject, Buffer.concat([
        Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
        Buffer.from(compressed),
        Buffer.from("\nendstream", "latin1")
      ]));
    } else {
      objects.set(plan.contentObject, Buffer.from(`<< /Length ${raw.length} >>\nstream\n${body}\nendstream`, "latin1"));
    }
    objects.set(plan.fontObject, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1"));
    objects.set(plan.objectNumber, Buffer.from(`<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${plan.fontObject} 0 R >> >> /Contents ${plan.contentObject} 0 R >>`, "latin1"));
  }
  if (encryptNumber !== undefined) objects.set(encryptNumber, Buffer.from("<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -1 >>", "latin1"));
  if (infoNumber !== undefined) objects.set(infoNumber, Buffer.from(`<< /Title (${pdfString(options.title ?? "")}) /Producer (Codex-Boss test fixture) >>`, "latin1"));

  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n", "latin1")];
  const offsets = new Map<number, number>();
  let position = chunks[0].length;
  for (let number = 1; number < size; number++) {
    const body = objects.get(number);
    if (body === undefined) continue;
    offsets.set(number, position);
    const chunk = Buffer.concat([Buffer.from(`${number} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    chunks.push(chunk);
    position += chunk.length;
  }
  const xrefOffset = position;
  const trailerParts = [`/Size ${size}`, `/Root ${catalogNumber} 0 R`];
  if (encryptNumber !== undefined) trailerParts.push(`/Encrypt ${encryptNumber} 0 R`);
  if (infoNumber !== undefined) trailerParts.push(`/Info ${infoNumber} 0 R`);
  let trailer = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let number = 1; number < size; number++) {
    const offset = offsets.get(number);
    trailer += offset === undefined ? "0000000000 65535 f \n" : `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  trailer += `trailer\n<< ${trailerParts.join(" ")} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(trailer, "latin1"));
  return new Uint8Array(Buffer.concat(chunks));
}
