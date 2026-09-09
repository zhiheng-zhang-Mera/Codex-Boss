import type { RepoSnapshot } from "./repo-inspector";

/**
 * Symbol index (plan AP04 / §13.3). Module-level dependency edges already exist
 * (semantic-slice, code-graph); this adds the deterministic symbol vocabulary
 * per file: exported functions/classes/constants/interfaces/types plus the file
 * that defines them, so a step needing "call X" can be routed to its definition
 * and own-tests without reading the whole repo. Bounded read, regex-based,
 * deterministic; not a parser (never runs repo code).
 */

export interface FileSymbols {
  file: string;
  exports: string[];
  functions: string[];
  classes: string[];
  types: string[];
}

export interface SymbolIndex {
  schemaVersion: 1;
  builtForSignature: string;
  files: FileSymbols[];
}

const CODE_EXTENSION = /\.(?:[cm]?[jt]sx?|svelte|vue)$/;
const MAX_SYMBOLS_PER_FILE = 500;

const EXPORT_RE = /\bexport\s+(?:default\s+)?(?:function\s+|class\s+|const\s+|let\s+|interface\s+|type\s+|enum\s+)([A-Za-z_$][A-Za-z0-9_$]*)/g;
const FUNCTION_RE = /(?:^|[^A-Za-z0-9_$])(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
const CLASS_RE = /(?:^|[^A-Za-z0-9_$])class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
const TYPE_RE = /\b(?:interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

function unique(values: string[]): string[] { return [...new Set(values)].sort((a, b) => a.localeCompare(b)).slice(0, MAX_SYMBOLS_PER_FILE); }

export function indexFile(file: string, content: string): FileSymbols {
  const exports = unique([...content.matchAll(EXPORT_RE)].map((match) => match[1]));
  const functions = unique([...content.matchAll(FUNCTION_RE)].map((match) => match[1]));
  const classes = unique([...content.matchAll(CLASS_RE)].map((match) => match[1]));
  const types = unique([...content.matchAll(TYPE_RE)].map((match) => match[1]));
  return { file, exports, functions, classes, types };
}

/** Builds the symbol index for a repo snapshot (files already resolved + sorted). */
export function buildSymbolIndex(snapshot: RepoSnapshot, readFile: (file: string) => string): SymbolIndex {
  const files: FileSymbols[] = [];
  for (const file of snapshot.files) {
    if (!CODE_EXTENSION.test(file)) continue;
    try {
      const content = readFile(file);
      if (content.length > 1000000) continue;
      files.push(indexFile(file, content));
    } catch { /* unreadable files are skipped; index stays deterministic over readable set */ }
  }
  return { schemaVersion: 1, builtForSignature: signatureFor(snapshot), files };
}

/** Deterministic signature reuse (repo fingerprint is cheap and sufficient). */
export function signatureFor(snapshot: RepoSnapshot): string {
  return snapshot.fingerprint;
}

/** Locates the defining file(s) for a symbol across the index. */
export function locateSymbol(index: SymbolIndex, name: string): string[] {
  const matches = index.files.filter((file) => file.exports.includes(name) || file.functions.includes(name) || file.classes.includes(name) || file.types.includes(name)).map((file) => file.file);
  return matches.sort((a, b) => a.localeCompare(b));
}

export function symbolsForFile(index: SymbolIndex, file: string): FileSymbols | undefined {
  return index.files.find((item) => item.file === file);
}
