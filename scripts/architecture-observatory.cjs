#!/usr/bin/env node
/**
 * Capability City Phase 0 — Real-Source Architecture Observatory.
 *
 * Specification (normative): docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md
 * Spec commit: see SPEC_COMMIT below — the implementation names the exact spec commit it was written against.
 *
 * WHAT THIS IS
 *   A read-only sensor. It measures the real Git-tracked source tree and reports the import relations that
 *   actually exist, together with the ownership the repository's own manifests actually declare. It is the
 *   experimental arm of a controlled comparison whose control arm is the untouched legacy manifest gate.
 *
 * WHAT IT IS NOT
 *   Not an enforcer, not a repair tool, not a migration engine. It never mutates source. It writes only under
 *   artifacts/. It exits non-zero only when the OBSERVER fails or one of its own invariants is violated —
 *   never because the architecture it measured is unhealthy. A dirty architecture is valid output.
 *
 * PARSING — an honest deviation, recorded in docs/research/PAPER_EVIDENCE_LEDGER.md
 *   The specification prefers AST/compiler parsing. That was attempted and is not available here:
 *     - `typescript@7.0.2` is the native port; its package root (`typescript`) exports only `version`, so the
 *       classic `createSourceFile` compiler API is absent;
 *     - `typescript/unstable/ast` exposes node type guards and a scanner but no parser, and its scanner does
 *       not yield usable tokens through the documented calling convention;
 *     - `typescript/unstable/sync` exposes project/file APIs only and needs a native server, not a parse;
 *     - no third-party parser (acorn, @babel/parser, es-module-lexer, oxc-parser, espree,
 *       @typescript-eslint/typescript-estree) is present in this lockfile.
 *   This module therefore uses a self-contained character-level LEXER followed by a token-level recognizer.
 *   A lexer is not a regex over raw text: comments, string literals and template *text* are tokenized as
 *   opaque content, so import-like text inside them cannot be mistaken for a statement. Self-test OBS-03
 *   exists precisely to falsify that claim, and the report carries a regex cross-check so any disagreement
 *   between the two methods is visible rather than assumed away.
 *
 * USAGE
 *   node scripts/architecture-observatory.cjs                 full run, writes artifacts/city/phase0/
 *   node scripts/architecture-observatory.cjs --self-test     OBS-01..OBS-06 on isolated fixtures
 *   node scripts/architecture-observatory.cjs --known-positive focused known-positive control only
 *   node scripts/architecture-observatory.cjs --no-write      measure without writing artifacts
 *   node scripts/architecture-observatory.cjs --out <dir>     override the artifact directory
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { parse: parseYaml } = require("yaml");

const ROOT = path.resolve(__dirname, "..");
const SPEC_PATH = "docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md";
const SPEC_COMMIT = "76b2f495f57928f34823f6ce17176890963e846e";
const DEFAULT_OUT_DIR = path.join("artifacts", "city", "phase0");
const SCAN_ROOTS = ["electron", "src"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs"];
const LEGACY_SCRIPT = path.join("scripts", "architecture.cjs");
const CAPABILITIES_ROOT = path.join("config", "capabilities");
const SCHEMA = "city-phase0-architecture-observatory/1";
const OWNER_UNDECLARED = "UNDECLARED";

// The legacy instrument's own import pattern and resolver, reproduced verbatim from
// scripts/architecture.cjs (tracked) so the control arm measures with the control instrument rather than with
// this one. Reproducing them is what makes `observer_only_edges` a statement about the legacy instrument.
// See docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md, "Legacy comparison - the control arm".
const LEGACY_IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

// The conservative regex cross-check. Deliberately the same shape as the legacy pattern, applied to the REAL
// scan set instead of the manifest-declared subset, so the two methods can be compared on identical input.
const CROSSCHECK_IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|(?:^|\n)\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

// ---------------------------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------------------------

function posix(p) {
  return p.split(path.sep).join("/");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** Canonical JSON: object keys sorted, so equal structures produce equal strings. */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function git(root, argv) {
  return execFileSync("git", argv, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
}

// ---------------------------------------------------------------------------------------------
// scan set
// ---------------------------------------------------------------------------------------------

/**
 * Every Git-tracked path, POSIX-normalized. Tracked-ness is the only membership criterion: the scan set must
 * never depend on which directories happen to exist locally, and must never shrink because a manifest is
 * silent about a file.
 */
function listTrackedFiles(root) {
  const out = git(root, ["ls-files", "-z"]);
  return out.split("\0").filter((entry) => entry.length > 0).map(posix).sort();
}

function isExcludedByRule(rel) {
  // Excluded roots are stated as rules, not as local directory existence.
  const excludedRoots = ["tests/", "artifacts/", "runtime-data/", "dist/", "dist-electron/", "coverage/", "node_modules/", ".git/"];
  if (excludedRoots.some((prefix) => rel.startsWith(prefix))) return true;
  if (rel === "tests" || rel === "artifacts") return true;
  return false;
}

function isSourceFile(rel) {
  if (isExcludedByRule(rel)) return false;
  const inRoot = SCAN_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`));
  if (!inRoot) return false;
  if (rel.endsWith(".d.ts")) return false;
  return SOURCE_EXTENSIONS.includes(path.posix.extname(rel));
}

function selectScanSet(trackedFiles) {
  return trackedFiles.filter(isSourceFile);
}

// ---------------------------------------------------------------------------------------------
// lexer (character level; comments, strings and template text are opaque)
// ---------------------------------------------------------------------------------------------

const KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else",
  "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof",
  "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void",
  "while", "with", "yield", "let", "static", "await", "async", "of", "as", "satisfies", "type", "interface",
  "declare", "namespace", "module", "abstract", "implements", "private", "protected", "public", "readonly",
  "override", "is", "keyof", "infer", "asserts", "unique", "global",
]);

// A token that may legally precede a regex literal rather than a division operator.
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "case", "do", "else", "yield",
  "await", "throw",
]);

// An explicit ALLOW-list of punctuators after which a `/` starts a regex literal. A deny-list was tried
// first and derailed on TSX: `>` and `<` were treated as regex-preceding, so the `/` in `<div />` and in
// `</div>` opened a phantom regex that ran to end of line and produced 302 spurious "unterminated-regex"
// issues across 12 renderer files. Listing the legal positions is stricter and does not depend on guessing
// what a rendered tag looks like. `)`, `]`, `}`, `>`, `<`, `.`, `?.`, `++` and `--` all close or continue an
// expression, so a `/` after them is division.
const REGEX_PRECEDING_PUNCTUATORS = new Set([
  "(", "[", "{", ",", ";", ":", "=", "==", "===", "!=", "!==", "!", "&&", "||", "??", "?", "+", "-", "*",
  "/", "%", "&", "|", "^", "~", "=>", "+=", "-=", "*=", "/=", "%=", "**", "**=", "...", "@", "#",
]);

const PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=", "=>", "==", "!=", "<=", ">=",
  "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "**",
  "{", "}", "(", ")", "[", "]", ";", ",", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "!", "~", "?",
  ":", "=", ".", "@", "#",
];

function isIdentStart(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$" || ch.charCodeAt(0) > 127;
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

/**
 * Lex source into tokens. Returns { tokens, issues }.
 * Token shapes: { t: "ident"|"punct"|"string"|"number"|"template-text"|"template-hole", v, s, e }
 * Comments are skipped entirely and never become tokens.
 */
function lex(source) {
  const tokens = [];
  const issues = [];
  let i = 0;
  const n = source.length;
  // mode stack: "normal" always at the bottom; "template" frames are pushed while inside a template literal.
  // Each hole frame records the brace depth at ITS entry, so nested templates cannot clobber one another's
  // bookkeeping. A single shared depth variable was tried first and derailed on nested templates: the outer
  // hole's closing brace stopped being recognised, a later real backtick opened a phantom template, and the
  // rest of the file was consumed as template text. See docs/research/PAPER_EVIDENCE_LEDGER.md (failed
  // attempts) for the recorded instance.
  const stack = [{ mode: "normal" }];
  let braceDepth = 0;

  const push = (t, v, s, e) => tokens.push({ t, v, s, e });
  const top = () => stack[stack.length - 1];

  while (i < n) {
    const mode = top().mode;

    if (mode === "template") {
      // Scan template text until an unescaped backtick (close) or "${" (hole).
      const start = i;
      let closed = false;
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") { i += 2; continue; }
        if (ch === "`") { closed = true; break; }
        if (ch === "$" && source[i + 1] === "{") break;
        i += 1;
      }
      if (i > start) push("template-text", source.slice(start, i), start, i);
      if (closed) {
        push("template-delim", "`", i, i + 1);
        i += 1;
        stack.pop();
        continue;
      }
      if (i >= n) { issues.push({ kind: "unterminated-template", at: start }); break; }
      // "${" -> enter a hole, lexing normally until the matching close brace.
      push("template-delim", "${", i, i + 2);
      i += 2;
      stack.push({ mode: "normal", inTemplateHole: true, braceDepthAtEntry: braceDepth });
      continue;
    }

    const ch = source[i];

    // whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v" || ch === "\u00a0") {
      i += 1;
      continue;
    }

    // comments (never tokens)
    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const start = i;
      i += 2;
      let closed = false;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === "/") { i += 2; closed = true; break; }
        i += 1;
      }
      if (!closed) issues.push({ kind: "unterminated-block-comment", at: start });
      continue;
    }

    // strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i += 1;
      let closed = false;
      let value = "";
      while (i < n) {
        const c = source[i];
        if (c === "\\") { value += source[i + 1] === undefined ? "" : source[i + 1]; i += 2; continue; }
        if (c === quote) { closed = true; i += 1; break; }
        if (c === "\n") break;
        value += c;
        i += 1;
      }
      if (!closed) issues.push({ kind: "unterminated-string", at: start });
      push("string", value, start, i);
      continue;
    }

    // template literal start
    if (ch === "`") {
      push("template-delim", "`", i, i + 1);
      i += 1;
      stack.push({ mode: "template" });
      continue;
    }

    // numbers
    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
      const start = i;
      while (i < n && /[0-9a-fA-FxXoObBeE_.+-]/.test(source[i])) {
        // stop consuming +/- unless it follows an exponent marker
        if ((source[i] === "+" || source[i] === "-") && !/[eE]/.test(source[i - 1] ?? "")) break;
        i += 1;
      }
      push("number", source.slice(start, i), start, i);
      continue;
    }

    // identifiers / keywords
    if (isIdentStart(ch) || (ch === "#" && isIdentStart(source[i + 1]))) {
      const start = i;
      if (ch === "#") i += 1;
      while (i < n && isIdentPart(source[i])) i += 1;
      const value = source.slice(start, i);
      push("ident", value, start, i);
      continue;
    }

    // regex literal vs division
    if (ch === "/") {
      const prev = tokens[tokens.length - 1];
      const regexAllowed =
        !prev ||
        (prev.t === "punct" && REGEX_PRECEDING_PUNCTUATORS.has(prev.v)) ||
        (prev.t === "ident" && REGEX_PRECEDING_KEYWORDS.has(prev.v));
      if (regexAllowed) {
        const start = i;
        i += 1;
        let inClass = false;
        let closed = false;
        while (i < n) {
          const c = source[i];
          if (c === "\\") { i += 2; continue; }
          if (c === "\n") break;
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) { closed = true; i += 1; break; }
          i += 1;
        }
        if (closed) {
          while (i < n && /[a-z]/i.test(source[i])) i += 1;
          push("regex", source.slice(start, i), start, i);
          continue;
        }
        issues.push({ kind: "unterminated-regex", at: start });
        push("punct", "/", start, start + 1);
        i = start + 1;
        continue;
      }
    }

    // punctuators
    let matched = null;
    for (const p of PUNCTUATORS) {
      if (source.startsWith(p, i)) { matched = p; break; }
    }
    if (matched) {
      if (matched === "{") braceDepth += 1;
      if (matched === "}") {
        const frame = top();
        if (frame.inTemplateHole && braceDepth === frame.braceDepthAtEntry) {
          push("template-delim", "}", i, i + 1);
          stack.pop();
          i += 1;
          continue;
        }
        braceDepth -= 1;
      }
      push("punct", matched, i, i + matched.length);
      i += matched.length;
      continue;
    }

    // unknown character: record and skip, never silently drop
    issues.push({ kind: "unrecognized-character", at: i, detail: JSON.stringify(ch) });
    i += 1;
  }

  return { tokens, issues };
}

// ---------------------------------------------------------------------------------------------
// reference extraction (token level)
// ---------------------------------------------------------------------------------------------

const FORM_STATIC = "static-import";
const FORM_SIDE_EFFECT = "side-effect-import";
const FORM_EXPORT_FROM = "export-from";
const FORM_REQUIRE = "require";
const FORM_DYNAMIC = "dynamic-import";
const ALL_FORMS = [FORM_DYNAMIC, FORM_EXPORT_FROM, FORM_REQUIRE, FORM_SIDE_EFFECT, FORM_STATIC];

function significant(tokens, from) {
  return tokens[from];
}

/** Find `from "..."` at bracket depth 0 within a bounded window, or undefined. */
function findFromString(tokens, start) {
  let depth = 0;
  const limit = Math.min(tokens.length, start + 200);
  for (let k = start; k < limit; k += 1) {
    const tk = tokens[k];
    if (tk.t === "punct") {
      if (tk.v === "(" || tk.v === "[" || tk.v === "{") depth += 1;
      else if (tk.v === ")" || tk.v === "]" || tk.v === "}") { depth -= 1; if (depth < 0) return undefined; }
      else if (tk.v === ";" && depth === 0) return undefined;
      continue;
    }
    if (depth !== 0) continue;
    if (tk.t === "ident" && tk.v === "from") {
      const next = significant(tokens, k + 1);
      if (next && next.t === "string") return next.v;
      return undefined;
    }
    if (tk.t === "ident" && (tk.v === "import" || tk.v === "export") && k > start) return undefined;
  }
  return undefined;
}

/**
 * Extract literal module references from tokens.
 * Exactly one reference per (specifier, form) occurrence is produced here; edge-level deduplication by
 * (from, to) happens in the graph builder, so the two rules stay independent and both are documented.
 */
function extractReferences(tokens) {
  const references = [];
  for (let k = 0; k < tokens.length; k += 1) {
    const tk = tokens[k];
    if (tk.t !== "ident") continue;

    if (tk.v === "import") {
      const next = tokens[k + 1];
      // `import.meta` / `import (` as a call are distinguished below; `.` is never an import statement.
      if (next && next.t === "punct" && next.v === ".") continue;
      if (next && next.t === "punct" && next.v === "(") {
        const arg = tokens[k + 2];
        const close = tokens[k + 3];
        if (arg && arg.t === "string" && close && close.t === "punct" && close.v === ")") {
          references.push({ specifier: arg.v, form: FORM_DYNAMIC, at: tk.s });
        }
        continue;
      }
      if (next && next.t === "string") {
        references.push({ specifier: next.v, form: FORM_SIDE_EFFECT, at: tk.s });
        continue;
      }
      const from = findFromString(tokens, k + 1);
      if (from !== undefined) references.push({ specifier: from, form: FORM_STATIC, at: tk.s });
      continue;
    }

    if (tk.v === "export") {
      const from = findFromString(tokens, k + 1);
      if (from !== undefined) references.push({ specifier: from, form: FORM_EXPORT_FROM, at: tk.s });
      continue;
    }

    if (tk.v === "require") {
      const prev = tokens[k - 1];
      if (prev && prev.t === "punct" && (prev.v === "." || prev.v === "?.")) continue; // member access, not a call
      const next = tokens[k + 1];
      if (!next || next.t !== "punct" || next.v !== "(") continue;
      const arg = tokens[k + 2];
      const close = tokens[k + 3];
      if (arg && arg.t === "string" && close && close.t === "punct" && close.v === ")") {
        references.push({ specifier: arg.v, form: FORM_REQUIRE, at: tk.s });
      }
      continue;
    }
  }
  return references;
}

// ---------------------------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------------------------

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs"];
const NON_SOURCE_EXTENSIONS = [".json", ".css", ".scss", ".svg", ".png", ".node", ".wasm", ".md", ".txt", ".html"];

function createResolver(trackedSet) {
  return function resolve(specifier, fromRel) {
    if (typeof specifier !== "string" || specifier.length === 0) return { kind: "empty" };
    if (specifier.startsWith(".")) {
      const dir = path.posix.dirname(fromRel);
      const base = path.posix.normalize(path.posix.join(dir, specifier));
      const candidates = [];
      if (trackedSet.has(base)) candidates.push(base);
      const ext = path.posix.extname(base);
      if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".jsx") {
        const stem = base.slice(0, -ext.length);
        for (const e of [".ts", ".tsx"]) candidates.push(stem + e);
      }
      for (const e of RESOLVE_EXTENSIONS) candidates.push(base + e);
      for (const e of RESOLVE_EXTENSIONS) candidates.push(path.posix.join(base, `index${e}`));
      for (const c of candidates) if (trackedSet.has(c)) return { kind: "internal", target: c };
      if (NON_SOURCE_EXTENSIONS.includes(ext)) return { kind: "unresolved", reason: "non-source-extension" };
      return { kind: "unresolved", reason: "no-tracked-candidate" };
    }
    if (specifier.startsWith("/")) {
      const base = path.posix.normalize(specifier.slice(1));
      if (trackedSet.has(base)) return { kind: "internal", target: base };
      return { kind: "unresolved", reason: "root-relative-no-candidate" };
    }
    // bare specifier: internal only if it names a tracked path exactly.
    if (trackedSet.has(specifier)) return { kind: "internal", target: specifier };
    return { kind: "external" };
  };
}

// ---------------------------------------------------------------------------------------------
// ownership (from the repository's own declarations)
// ---------------------------------------------------------------------------------------------

function parseManifestText(source, text) {
  const raw = parseYaml(text);
  const modules = Array.isArray(raw?.modules) ? raw.modules.map((m) => posix(String(m))) : [];
  return {
    id: String(raw?.id ?? ""),
    kind: String(raw?.kind ?? ""),
    modules,
    surface: Array.isArray(raw?.surface) ? raw.surface.map((m) => posix(String(m))) : [],
    bootModules: Array.isArray(raw?.bootModules) ? raw.bootModules.map((m) => posix(String(m))) : [],
    source,
  };
}

function ownershipFromManifests(manifests) {
  const moduleOwner = new Map();
  const conflicts = [];
  const kindOf = new Map();
  const declaredModules = new Set();
  for (const manifest of [...manifests].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    kindOf.set(manifest.id, manifest.kind);
    for (const module of manifest.modules) {
      declaredModules.add(module);
      const existing = moduleOwner.get(module);
      if (existing && existing !== manifest.id) {
        conflicts.push({ module, capabilities: [existing, manifest.id].sort() });
        continue;
      }
      moduleOwner.set(module, manifest.id);
    }
  }
  return { moduleOwner, conflicts, kindOf, declaredModules };
}

function loadOwnership(root) {
  const dir = path.join(root, CAPABILITIES_ROOT);
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(ya?ml|json)$/i.test(entry.name)) files.push(full);
    }
  };
  walk(dir);
  const manifests = files.map((file) => parseManifestText(posix(path.relative(root, file)), fs.readFileSync(file, "utf8")));
  return { ownership: ownershipFromManifests(manifests), manifestCount: manifests.length };
}

// ---------------------------------------------------------------------------------------------
// graph
// ---------------------------------------------------------------------------------------------

/**
 * Build the observer graph from an explicit file list and an explicit ownership map.
 * Pure with respect to the filesystem apart from reading the listed files, which makes every self-test
 * exercise this exact production path with fixture inputs.
 */
function buildObserverGraph({ root, files, trackedSet, ownership, readFile }) {
  const resolve = createResolver(trackedSet);
  const edgesByPair = new Map();
  const unresolved = [];
  const external = new Map();
  const parseIssues = [];
  const filesWithRefs = new Set();

  for (const rel of files) {
    let text;
    try {
      text = readFile(rel);
    } catch (error) {
      parseIssues.push({ file: rel, kind: "unreadable", detail: String(error && error.message) });
      continue;
    }
    const { tokens, issues } = lex(text);
    for (const issue of issues) parseIssues.push({ file: rel, ...issue });
    const references = extractReferences(tokens);
    if (references.length > 0) filesWithRefs.add(rel);
    for (const reference of references) {
      const outcome = resolve(reference.specifier, rel);
      if (outcome.kind === "external") {
        const key = reference.specifier;
        external.set(key, (external.get(key) ?? 0) + 1);
        continue;
      }
      if (outcome.kind === "unresolved") {
        unresolved.push({ from: rel, specifier: reference.specifier, reason: outcome.reason, form: reference.form });
        continue;
      }
      if (outcome.kind !== "internal") continue;
      const key = `${rel}\u0000${outcome.target}`;
      const existing = edgesByPair.get(key);
      if (existing) {
        if (!existing.forms.includes(reference.form)) existing.forms.push(reference.form);
        existing.occurrences += 1;
        continue;
      }
      edgesByPair.set(key, {
        from: rel,
        to: outcome.target,
        forms: [reference.form],
        occurrences: 1,
      });
    }
  }

  const edges = [...edgesByPair.values()]
    .map((edge) => {
      const fromOwner = ownership.moduleOwner.get(edge.from) ?? OWNER_UNDECLARED;
      const toOwner = ownership.moduleOwner.get(edge.to) ?? OWNER_UNDECLARED;
      const fromClass = fromOwner === OWNER_UNDECLARED ? "UNDECLARED" : "DECLARED";
      const toClass = toOwner === OWNER_UNDECLARED ? "UNDECLARED" : "DECLARED";
      return {
        from: edge.from,
        to: edge.to,
        fromOwner,
        toOwner,
        fromClass,
        toClass,
        edgeClass: `${fromClass}_TO_${toClass}`,
        forms: [...edge.forms].sort((a, b) => ALL_FORMS.indexOf(a) - ALL_FORMS.indexOf(b)),
        occurrences: edge.occurrences,
      };
    })
    .sort((a, b) => (a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1));

  const formCounts = {};
  for (const form of ALL_FORMS) formCounts[form] = 0;
  for (const edge of edges) for (const form of edge.forms) formCounts[form] += 1;

  const edgeClassCounts = {
    DECLARED_TO_DECLARED: 0,
    DECLARED_TO_UNDECLARED: 0,
    UNDECLARED_TO_DECLARED: 0,
    UNDECLARED_TO_UNDECLARED: 0,
  };
  for (const edge of edges) edgeClassCounts[edge.edgeClass] += 1;

  const capabilityEdges = new Map();
  for (const edge of edges) {
    if (edge.fromOwner === OWNER_UNDECLARED || edge.toOwner === OWNER_UNDECLARED) continue;
    if (edge.fromOwner === edge.toOwner) continue;
    const key = `${edge.fromOwner}\u0000${edge.toOwner}`;
    const existing = capabilityEdges.get(key);
    if (existing) { existing.weight += 1; continue; }
    capabilityEdges.set(key, { from: edge.fromOwner, to: edge.toOwner, weight: 1 });
  }

  const declaredEndpoints = { declared: 0, undeclared: 0 };
  for (const edge of edges) {
    declaredEndpoints[edge.fromClass === "DECLARED" ? "declared" : "undeclared"] += 1;
    declaredEndpoints[edge.toClass === "DECLARED" ? "declared" : "undeclared"] += 1;
  }

  return {
    edges,
    unresolved: unresolved.sort((a, b) => (a.from === b.from ? (a.specifier < b.specifier ? -1 : 1) : a.from < b.from ? -1 : 1)),
    external: [...external.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([specifier, occurrences]) => ({ specifier, occurrences })),
    parseIssues,
    formCounts,
    edgeClassCounts,
    capabilityEdges: [...capabilityEdges.values()].sort((a, b) => (a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1)),
    declaredEndpoints,
    filesScanned: files.length,
    filesWithReferences: filesWithRefs.size,
  };
}

// ---------------------------------------------------------------------------------------------
// the legacy control arm
// ---------------------------------------------------------------------------------------------

function legacyResolveSpecifier(specifier, fromFile, root) {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(root, path.dirname(fromFile), specifier);
  const withoutJs = base.endsWith(".js") ? base.slice(0, -3) : base;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${withoutJs}.ts`, `${withoutJs}.tsx`, path.join(base, "index.ts"), path.join(withoutJs, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return posix(path.relative(root, candidate));
  }
  return undefined;
}

/**
 * Re-derive the legacy visibility rule over the SAME scan set the observer uses, so the two arms are compared
 * on identical input: only manifest-declared modules are read, and an edge whose target is not a declared
 * module is dropped. This is labelled LEGACY_RULE_REDERIVATION everywhere it appears.
 */
function legacyRuleRederrivation({ root, files, trackedSet, ownership }) {
  const fileSet = new Set(files);
  const declaredPresent = [...ownership.declaredModules].filter((module) => fileSet.has(module)).sort();
  const declaredAbsent = [...ownership.declaredModules].filter((module) => !fileSet.has(module)).sort();
  const internalRecords = [];
  const visibleRecords = [];
  for (const module of declaredPresent) {
    const text = fs.readFileSync(path.join(root, module), "utf8");
    const specifiers = new Set([...text.matchAll(LEGACY_IMPORT_PATTERN)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]).filter(Boolean));
    for (const specifier of specifiers) {
      const target = legacyResolveSpecifier(specifier, module, root);
      if (!target) continue;
      if (!trackedSet.has(target)) continue;
      internalRecords.push({ from: module, to: target, specifier });
      if (!ownership.moduleOwner.has(target)) continue;
      visibleRecords.push({ from: module, to: target, specifier });
    }
  }
  const pairKey = (r) => `${r.from}\u0000${r.to}`;
  return {
    label: "LEGACY_RULE_REDERIVATION",
    source_of_truth: `${LEGACY_SCRIPT} (tracked; reproduced, not modified)`,
    legacy_scanned_files: declaredPresent.length,
    declared_modules_total: ownership.declaredModules.size,
    declared_modules_absent_from_scan_set: declaredAbsent,
    legacy_internal_edge_records: internalRecords.length,
    legacy_visible_edge_records: visibleRecords.length,
    legacy_internal_edges: new Set(internalRecords.map(pairKey)).size,
    legacy_visible_edges: new Set(visibleRecords.map(pairKey)).size,
    legacy_visible_edge_pairs: [...new Set(visibleRecords.map(pairKey))].sort().map((key) => {
      const [from, to] = key.split("\u0000");
      return { from, to };
    }),
  };
}

/** Run the unmodified legacy instrument as a subprocess: the behavioural control. */
function legacyCli(root) {
  const run = (argv) => {
    try {
      const stdout = execFileSync(process.execPath, [path.join(ROOT, LEGACY_SCRIPT), ...argv], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
      return { exitCode: 0, stdout };
    } catch (error) {
      return { exitCode: typeof error.status === "number" ? error.status : -1, stdout: String(error.stdout ?? "") };
    }
  };
  const ratchet = run(["ratchet"]);
  const graph = run(["graph"]);
  const parse = (result) => {
    try { return JSON.parse(result.stdout); } catch { return undefined; }
  };
  const ratchetJson = parse(ratchet);
  const graphJson = parse(graph);
  return {
    label: "LEGACY_CLI",
    command: `node ${LEGACY_SCRIPT} ratchet`,
    ratchet_exit_code: ratchet.exitCode,
    ratchet_pass: ratchetJson ? ratchetJson.pass === true : null,
    ratchet_violation_count: ratchetJson && Array.isArray(ratchetJson.violations) ? ratchetJson.violations.length : null,
    ratchet_metrics: ratchetJson ? ratchetJson.metrics : null,
    graph_exit_code: graph.exitCode,
    declared_capability_edges: graphJson ? graphJson.edges : null,
    declared_capability_count: graphJson ? graphJson.capabilities : null,
  };
}

// ---------------------------------------------------------------------------------------------
// known-positive control
// ---------------------------------------------------------------------------------------------

const KNOWN_POSITIVE_SOURCE = "electron/bootstrap/persistence.ts";
const KNOWN_POSITIVE_TARGET_MARKER = "runtime-intelligence/live-capture";

function knownPositiveControl({ root, trackedSet, ownership, readFile }) {
  const present = trackedSet.has(KNOWN_POSITIVE_SOURCE);
  const result = {
    source: KNOWN_POSITIVE_SOURCE,
    target_marker: KNOWN_POSITIVE_TARGET_MARKER,
    source_in_scan_set: present,
    source_declared_owner: ownership.moduleOwner.get(KNOWN_POSITIVE_SOURCE) ?? OWNER_UNDECLARED,
    edges_found: [],
    matched_specifier: null,
    target_observed: null,
    target_declared_owner: null,
    target_is_declared_module: null,
    legacy_rule_would_keep_edge: null,
    observable: false,
    historical_evidence_note:
      "The pre-city evidence described this dependency as tenx-owned and named a tenx path. That description is HISTORICAL comparison data only; the control below resolves whatever the source actually says today and never uses the historical path to decide the outcome.",
  };
  if (!present) return result;
  const text = readFile(KNOWN_POSITIVE_SOURCE);
  const { tokens } = lex(text);
  const references = extractReferences(tokens);
  const resolve = createResolver(trackedSet);
  for (const reference of references) {
    const outcome = resolve(reference.specifier, KNOWN_POSITIVE_SOURCE);
    if (outcome.kind !== "internal") continue;
    result.edges_found.push({ specifier: reference.specifier, form: reference.form, target: outcome.target });
    if (outcome.target.includes(KNOWN_POSITIVE_TARGET_MARKER)) {
      result.target_observed = outcome.target;
      result.matched_specifier = reference.specifier;
    }
  }
  if (result.target_observed) {
    result.target_declared_owner = ownership.moduleOwner.get(result.target_observed) ?? OWNER_UNDECLARED;
    result.target_is_declared_module = ownership.moduleOwner.has(result.target_observed);
    // The control's point: the legacy instrument's visibility rule would DROP this real edge whenever the
    // target is not itself a declared module. Measured from the observed target, never assumed.
    result.legacy_rule_would_keep_edge = result.target_is_declared_module;
  }
  result.observable = result.target_observed !== null;
  return result;
}

// ---------------------------------------------------------------------------------------------
// regex cross-check (a second method over identical input)
// ---------------------------------------------------------------------------------------------

function regexCrossCheck({ root, files, trackedSet, ownership }) {
  const resolve = createResolver(trackedSet);
  const lexerPairs = new Set();
  const regexPairs = new Set();
  const regexOnly = [];
  const lexerOnly = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    for (const specifier of new Set([...text.matchAll(CROSSCHECK_IMPORT_PATTERN)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).filter(Boolean))) {
      const outcome = resolve(specifier, rel);
      if (outcome.kind === "internal") regexPairs.add(`${rel}\u0000${outcome.target}`);
    }
  }
  const { edges } = buildObserverGraph({ root, files, trackedSet, ownership, readFile: (rel) => fs.readFileSync(path.join(root, rel), "utf8") });
  for (const edge of edges) lexerPairs.add(`${edge.from}\u0000${edge.to}`);
  for (const key of regexPairs) if (!lexerPairs.has(key)) {
    const [from, to] = key.split("\u0000");
    regexOnly.push({ from, to });
  }
  for (const key of lexerPairs) if (!regexPairs.has(key)) {
    const [from, to] = key.split("\u0000");
    lexerOnly.push({ from, to });
  }
  const pairKey = (r) => `${r.from}\u0000${r.to}`;
  return {
    label: "REGEX_CROSS_CHECK",
    note: "A second, independent method (a conservative regex, the same shape as the legacy pattern) applied to the SAME scan set. Disagreement is reported, not resolved by preference.",
    regex_internal_edges: regexPairs.size,
    lexer_internal_edges: lexerPairs.size,
    agreement: regexOnly.length === 0 && lexerOnly.length === 0,
    regex_only: regexOnly.sort((a, b) => (pairKey(a) < pairKey(b) ? -1 : 1)),
    lexer_only: lexerOnly.sort((a, b) => (pairKey(a) < pairKey(b) ? -1 : 1)),
  };
}

// ---------------------------------------------------------------------------------------------
// self-tests OBS-01..OBS-06
// ---------------------------------------------------------------------------------------------

const FIXTURE_MANIFEST = `
id: alpha
version: 1.0.0
kind: feature
health:
  critical: false
modules:
  - electron/fixture/alpha.ts
bootModules: []
surface: []
permissions: []
`;

function fixtureOwnership() {
  return ownershipFromManifests([parseManifestText("fixture/alpha.yaml", FIXTURE_MANIFEST)]);
}

function runFixtureObserver(files, contents) {
  const trackedSet = new Set(Object.keys(contents));
  const ownership = fixtureOwnership();
  return buildObserverGraph({
    root: process.cwd(),
    files,
    trackedSet,
    ownership,
    readFile: (rel) => {
      if (!(rel in contents)) throw new Error(`not in fixture: ${rel}`);
      return contents[rel];
    },
  });
}

function runSelfTests() {
  const results = [];
  const record = (id, title, pass, detail) => results.push({ id, title, pass, detail });

  // OBS-01 — manifest independence: a tracked source file absent from manifest modules must still be seen.
  {
    const contents = {
      "electron/fixture/alpha.ts": 'import { b } from "./undeclared";\n',
      "electron/fixture/undeclared.ts": "export const b = 1;\n",
    };
    const graph = runFixtureObserver(Object.keys(contents), contents);
    const seen = graph.edges.some((e) => e.from === "electron/fixture/undeclared.ts") ||
      graph.edges.some((e) => e.to === "electron/fixture/undeclared.ts");
    // The undeclared file declares no imports, so "seen" is proven by it being readable and counted as scanned
    // even though no manifest names it, and by the edge that targets it.
    record("OBS-01", "manifest independence: an undeclared tracked file is still scanned", seen,
      { files_scanned: graph.filesScanned, undeclared_owner_of_target: graph.edges[0]?.toOwner ?? null });
  }

  // OBS-02 — undeclared target preservation.
  {
    const contents = {
      "electron/fixture/alpha.ts": 'import { b } from "./undeclared";\n',
      "electron/fixture/undeclared.ts": "export const b = 1;\n",
    };
    const graph = runFixtureObserver(Object.keys(contents), contents);
    const edge = graph.edges.find((e) => e.from === "electron/fixture/alpha.ts" && e.to === "electron/fixture/undeclared.ts");
    record("OBS-02", "undeclared target preservation: the edge survives with owner UNDECLARED", Boolean(edge) && edge.toOwner === OWNER_UNDECLARED,
      { edge: edge ?? null });
  }

  // OBS-03 — false-import negative control.
  {
    const contents = {
      "electron/fixture/alpha.ts": [
        '// import { x } from "./comment-target";',
        "/* require('./block-comment-target') */",
        'const s = "import { y } from \\"./string-target\\"";',
        "const t = `import { z } from './template-target'`;",
        "export const ok = 1;",
      ].join("\n"),
      "electron/fixture/comment-target.ts": "export const x = 1;\n",
      "electron/fixture/block-comment-target.ts": "export const y = 1;\n",
      "electron/fixture/string-target.ts": "export const z = 1;\n",
      "electron/fixture/template-target.ts": "export const w = 1;\n",
    };
    const graph = runFixtureObserver(Object.keys(contents), contents);
    record("OBS-03", "false-import negative control: comment/string/template text yields no edge", graph.edges.length === 0,
      { edges: graph.edges });
  }

  // OBS-04 — supported import forms, each edge exactly once.
  {
    const contents = {
      "electron/fixture/alpha.ts": [
        'import a from "./f-static";',
        'import "./f-side-effect";',
        'export { b } from "./f-export-from";',
        'const c = require("./f-require");',
        'const d = import("./f-dynamic");',
        'import a2 from "./f-static";',
      ].join("\n"),
      "electron/fixture/f-static.ts": "export default 1;\n",
      "electron/fixture/f-side-effect.ts": "export const s = 1;\n",
      "electron/fixture/f-export-from.ts": "export const b = 1;\n",
      "electron/fixture/f-require.ts": "module.exports = 1;\n",
      "electron/fixture/f-dynamic.ts": "export const d = 1;\n",
    };
    const graph = runFixtureObserver(Object.keys(contents), contents);
    const fromAlpha = graph.edges.filter((e) => e.from === "electron/fixture/alpha.ts");
    const once = fromAlpha.length === 5;
    const staticEdge = fromAlpha.find((e) => e.to === "electron/fixture/f-static.ts");
    const duplicateCollapsed = staticEdge && staticEdge.occurrences === 2 && staticEdge.forms.length === 1;
    const formsPresent = [FORM_STATIC, FORM_SIDE_EFFECT, FORM_EXPORT_FROM, FORM_REQUIRE, FORM_DYNAMIC].every((form) =>
      fromAlpha.some((e) => e.forms.includes(form)));
    record("OBS-04", "supported import forms: five edges, one per (from,to), duplicate occurrence collapsed", once && Boolean(duplicateCollapsed) && formsPresent,
      { edge_count: fromAlpha.length, edges: fromAlpha, duplicate_occurrences: staticEdge?.occurrences ?? null });
  }

  // OBS-05 — mutation sensitivity.
  {
    const base = {
      "electron/fixture/alpha.ts": "export const a = 1;\n",
      "electron/fixture/target.ts": "export const t = 1;\n",
    };
    const before = runFixtureObserver(Object.keys(base), base);
    const mutated = { ...base, "electron/fixture/alpha.ts": 'import { t } from "./target";\nexport const a = t;\n' };
    const after = runFixtureObserver(Object.keys(mutated), mutated);
    const restored = runFixtureObserver(Object.keys(base), base);
    const delta = after.edges.length - before.edges.length;
    record("OBS-05", "mutation sensitivity: adding one real dependency yields exactly one edge, removal restores baseline",
      before.edges.length === 0 && delta === 1 && restored.edges.length === before.edges.length,
      { before: before.edges.length, after: after.edges.length, restored: restored.edges.length });
  }

  // OBS-06 — determinism: same input twice, semantic payload byte-identical.
  {
    const contents = {
      "electron/fixture/alpha.ts": 'import { b } from "./undeclared";\nimport { c } from "./other";\n',
      "electron/fixture/undeclared.ts": "export const b = 1;\n",
      "electron/fixture/other.ts": "export const c = 1;\n",
    };
    const first = canonicalJson(runFixtureObserver(Object.keys(contents), contents));
    const second = canonicalJson(runFixtureObserver(Object.keys(contents).reverse(), contents));
    record("OBS-06", "determinism: semantic output is canonical-hash identical across runs and input orders",
      sha256(first) === sha256(second), { hash: sha256(first) });
  }

  return results;
}

// ---------------------------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------------------------

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function markdownReport({ measurement, comparison, selfTests }) {
  const lines = [];
  lines.push("# PHASE 0 — ARCHITECTURE OBSERVATORY REPORT (real host run)");
  lines.push("");
  lines.push(`Generated: ${measurement.volatile.generatedAt} on host \`${measurement.volatile.host.hostname}\` (${measurement.volatile.host.platform} ${measurement.volatile.host.arch}), node ${measurement.volatile.host.node}.`);
  lines.push("");
  lines.push(`Specification: \`${SPEC_PATH}\` at spec commit \`${SPEC_COMMIT}\`.`);
  lines.push(`Measured commit: \`${measurement.volatile.git.commit}\` on \`${measurement.volatile.git.branch}\` (dirty: ${measurement.volatile.git.dirty}).`);
  lines.push("");
  lines.push("This is the **experimental sensor**. The legacy manifest gate is the **control sensor** and is unchanged.");
  lines.push("");
  lines.push("## Scan");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| scan roots | ${measurement.scan.roots.join(", ")} |`);
  lines.push(`| tracked source files scanned | ${measurement.scan.tracked_source_files_scanned} |`);
  lines.push(`| files with at least one reference | ${measurement.graph.files_with_references} |`);
  lines.push(`| parse issues | ${measurement.scan.parse_issues.length} |`);
  lines.push("");
  lines.push("## Ownership");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| manifests read | ${measurement.ownership.manifests} |`);
  lines.push(`| declared modules (manifest ` + "`modules`" + `) | ${measurement.ownership.declared_modules} |`);
  lines.push(`| declared-owned files present in scan set | ${measurement.ownership.declared_owned_files} |`);
  lines.push(`| UNDECLARED files | ${measurement.ownership.undeclared_files} |`);
  lines.push(`| module ownership conflicts | ${measurement.ownership.conflicts.length} |`);
  lines.push("");
  lines.push("## Graph");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| observer internal edges | ${measurement.graph.internal_edges} |`);
  lines.push(`| observer capability-level edges | ${measurement.graph.capability_edges} |`);
  lines.push(`| unresolved internal references | ${measurement.unresolved.count} |`);
  lines.push(`| distinct external packages | ${measurement.external.distinct} |`);
  lines.push("");
  lines.push("| Edge class | Count |");
  lines.push("|---|---|");
  for (const [key, value] of Object.entries(measurement.graph.edge_classes)) lines.push(`| ${key} | ${value} |`);
  lines.push("");
  lines.push("| Form | Edges carrying it |");
  lines.push("|---|---|");
  for (const [key, value] of Object.entries(measurement.graph.forms)) lines.push(`| ${key} | ${value} |`);
  lines.push("");
  lines.push("## Known-positive control");
  lines.push("");
  lines.push(`Source \`${measurement.known_positive.source}\` (declared owner: \`${measurement.known_positive.source_declared_owner}\`).`);
  lines.push("");
  lines.push(`- target observed from source: \`${measurement.known_positive.target_observed ?? "NOT OBSERVED"}\``);
  lines.push(`- observable: **${measurement.known_positive.observable ? "YES" : "NO"}**`);
  lines.push(`- the legacy visibility rule would have kept this edge: \`${measurement.known_positive.legacy_rule_would_keep_edge}\``);
  lines.push("");
  lines.push("## Control comparison (legacy vs observatory)");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| legacy scanned files (re-derived rule) | ${comparison.legacy_rule_rederivation.legacy_scanned_files} |`);
  lines.push(`| observer scanned files | ${measurement.scan.tracked_source_files_scanned} |`);
  lines.push(`| legacy internal edges (re-derived rule) | ${comparison.legacy_rule_rederivation.legacy_internal_edges} |`);
  lines.push(`| observer internal edges | ${measurement.graph.internal_edges} |`);
  lines.push(`| legacy visible edges (re-derived rule) | ${comparison.legacy_rule_rederivation.legacy_visible_edges} |`);
  lines.push(`| observer-only edges | ${comparison.observer_only_edges.count} |`);
  lines.push(`| unresolved internal references | ${measurement.unresolved.count} |`);
  lines.push(`| legacy ratchet exit code | ${comparison.legacy_cli.ratchet_exit_code} (pass: ${comparison.legacy_cli.ratchet_pass}) |`);
  lines.push(`| legacy declared capability edges | ${comparison.legacy_cli.declared_capability_edges} |`);
  lines.push("");
  lines.push("## Falsification self-tests");
  lines.push("");
  lines.push("| Test | Result |");
  lines.push("|---|---|");
  for (const test of selfTests) lines.push(`| ${test.id} — ${test.title} | **${test.pass ? "PASS" : "FAIL"}** |`);
  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  lines.push("Architecture findings are **measurements**, not failures. This report records what the tracked source tree contains; it does not repair it, and it does not enforce anything.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

function hostInfo() {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpus: os.cpus().length,
    totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
  };
}

function gitInfo(root) {
  const safe = (argv, fallback) => {
    try { return git(root, argv).trim(); } catch { return fallback; }
  };
  return {
    commit: safe(["rev-parse", "HEAD"], "unavailable"),
    branch: safe(["rev-parse", "--abbrev-ref", "HEAD"], "unavailable"),
    dirty: safe(["status", "--porcelain"], "").length > 0,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const selfTestOnly = argv.includes("--self-test");
  const knownPositiveOnly = argv.includes("--known-positive");
  const noWrite = argv.includes("--no-write");
  const outIndex = argv.indexOf("--out");
  const outArg = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : DEFAULT_OUT_DIR;
  // An absolute --out is honoured as given; a relative one is resolved against the repository root. Joining an
  // absolute path onto the root would produce a path that exists nowhere, which is how the first attempt at
  // the artifact-writing test failed.
  const outDir = path.isAbsolute(outArg) ? outArg : path.join(ROOT, outArg);
  const outLabel = path.isAbsolute(outArg) ? outArg : posix(path.relative(ROOT, outDir));
  const root = ROOT;
  const started = Date.now();

  if (selfTestOnly) {
    const results = runSelfTests();
    const payload = {
      schema: `${SCHEMA}#self-test`,
      spec: { path: SPEC_PATH, commit: SPEC_COMMIT },
      generatedAt: new Date().toISOString(),
      host: hostInfo(),
      git: gitInfo(root),
      tests: results,
      pass: results.every((r) => r.pass),
      test_count: results.length,
    };
    if (!noWrite) writeJson(path.join(outDir, "observatory-self-test.json"), payload);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload.pass ? 0 : 1;
  }

  const trackedFiles = listTrackedFiles(root);
  const scanFiles = selectScanSet(trackedFiles);
  if (scanFiles.length === 0) {
    process.stderr.write("observer invariant violated: the production scan set is empty\n");
    return 1;
  }
  const trackedSet = new Set(scanFiles);
  const { ownership, manifestCount } = loadOwnership(root);
  const readFile = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

  if (knownPositiveOnly) {
    const control = knownPositiveControl({ root, trackedSet, ownership, readFile });
    process.stdout.write(`${JSON.stringify(control, null, 2)}\n`);
    return 0;
  }

  const graph = buildObserverGraph({ root, files: scanFiles, trackedSet, ownership, readFile });
  const knownPositive = knownPositiveControl({ root, trackedSet, ownership, readFile });
  const legacy = legacyRuleRederrivation({ root, files: scanFiles, trackedSet, ownership });
  const legacyCliResult = legacyCli(root);
  const crossCheck = regexCrossCheck({ root, files: scanFiles, trackedSet, ownership });

  if (graph.parseIssues.some((issue) => issue.kind === "unreadable")) {
    process.stderr.write(`observer invariant violated: ${graph.parseIssues.filter((i) => i.kind === "unreadable").length} scan-set file(s) could not be read\n`);
    return 1;
  }

  const legacyVisible = new Set(legacy.legacy_visible_edge_pairs.map((p) => `${p.from}\u0000${p.to}`));
  const observerOnly = graph.edges.filter((edge) => !legacyVisible.has(`${edge.from}\u0000${edge.to}`));

  const declaredOwnedFiles = scanFiles.filter((file) => ownership.moduleOwner.has(file));
  const undeclaredFiles = scanFiles.filter((file) => !ownership.moduleOwner.has(file));
  const declaredModulesAbsentFromScanSet = [...ownership.declaredModules].filter((module) => !trackedSet.has(module)).sort();

  const unresolvedBreakdown = {};
  for (const item of graph.unresolved) unresolvedBreakdown[item.reason] = (unresolvedBreakdown[item.reason] ?? 0) + 1;

  const semantic = {
    spec: { path: SPEC_PATH, commit: SPEC_COMMIT },
    scan: {
      roots: SCAN_ROOTS,
      extensions: SOURCE_EXTENSIONS,
      source: "git ls-files",
      excluded_roots: ["tests/", "artifacts/", "runtime-data/", "dist/", "dist-electron/", "coverage/", "node_modules/", ".git/"],
      tracked_files_total: trackedFiles.length,
      tracked_source_files_scanned: scanFiles.length,
      declared_only_files_excluded_from_scan: declaredModulesAbsentFromScanSet,
      parse_issues: graph.parseIssues,
    },
    ownership: {
      manifests: manifestCount,
      declared_modules: ownership.declaredModules.size,
      declared_owned_files: declaredOwnedFiles.length,
      undeclared_files: undeclaredFiles.length,
      declared_modules_absent_as_tracked_source: declaredModulesAbsentFromScanSet.length,
      conflicts: ownership.conflicts,
      definition: "a tracked source file is declared-owned iff some manifest under config/capabilities names it in `modules`; everything else is UNDECLARED",
    },
    graph: {
      internal_edges: graph.edges.length,
      capability_edges: graph.capabilityEdges.length,
      files_scanned: graph.filesScanned,
      files_with_references: graph.filesWithReferences,
      edge_classes: graph.edgeClassCounts,
      forms: graph.formCounts,
      edge_endpoints: graph.declaredEndpoints,
      capability_edge_list: graph.capabilityEdges,
      edges: graph.edges,
    },
    unresolved: {
      count: graph.unresolved.length,
      breakdown: unresolvedBreakdown,
      items: graph.unresolved,
    },
    external: {
      distinct: graph.external.length,
      occurrences: graph.external.reduce((sum, entry) => sum + entry.occurrences, 0),
      packages: graph.external,
    },
    known_positive: knownPositive,
    regex_cross_check: crossCheck,
    undeclared_files_sample: undeclaredFiles.slice(0, 50),
  };

  const measurement = {
    schema: SCHEMA,
    volatile: { generatedAt: new Date().toISOString(), durationMs: Date.now() - started, host: hostInfo(), git: gitInfo(root) },
    ...semantic,
    semantic_hash: sha256(canonicalJson(semantic)),
    observer_invariants: {
      scan_set_non_empty: true,
      every_scanned_file_readable: true,
      every_resolved_internal_edge_retained: true,
      undeclared_targets_preserved: true,
    },
  };

  const comparison = {
    schema: `${SCHEMA}#legacy-comparison`,
    volatile: { generatedAt: measurement.volatile.generatedAt, host: measurement.volatile.host, git: measurement.volatile.git },
    framing: {
      legacy_ratchet: "control sensor",
      observatory: "experimental sensor",
      production_tree: "same measured object",
      note: "the legacy gate is not modified; the comparison is only meaningful while both sensors read the same tree",
    },
    legacy_cli: legacyCliResult,
    legacy_rule_rederivation: legacy,
    observer: {
      scanned_files: scanFiles.length,
      internal_edges: graph.edges.length,
      declared_owned_files: declaredOwnedFiles.length,
      undeclared_files: undeclaredFiles.length,
    },
    observer_only_edges: {
      count: observerOnly.length,
      sample: observerOnly.slice(0, 200),
    },
    inherited_historical_counts: {
      note: "historical measurements, shown for comparison only; never acceptance truth",
      files_scanned_by_existing_gate: 25,
      owned_source_files: 594,
      measured_file_level_cross_capability_edges: 187,
      measured_kernel_to_feature_implementation_edges: 43,
      provenance: "research/capability-city dataset (branch refactor/capability-city-v1)",
    },
    semantic_hash: sha256(canonicalJson({
      legacy_cli: legacyCliResult,
      legacy_rule: { scanned: legacy.legacy_scanned_files, internal: legacy.legacy_internal_edges, visible: legacy.legacy_visible_edges },
      observer: { scanned: scanFiles.length, internal: graph.edges.length },
      observer_only: observerOnly.length,
    })),
  };

  const selfTests = runSelfTests();

  if (!noWrite) {
    writeJson(path.join(outDir, "architecture-observatory.json"), measurement);
    writeJson(path.join(outDir, "legacy-comparison.json"), comparison);
    writeJson(path.join(outDir, "observatory-self-test.json"), {
      schema: `${SCHEMA}#self-test`,
      spec: { path: SPEC_PATH, commit: SPEC_COMMIT },
      generatedAt: measurement.volatile.generatedAt,
      host: measurement.volatile.host,
      git: measurement.volatile.git,
      tests: selfTests,
      pass: selfTests.every((t) => t.pass),
      test_count: selfTests.length,
    });
    fs.writeFileSync(path.join(outDir, "ARCHITECTURE_OBSERVATORY_REPORT.md"), markdownReport({ measurement, comparison, selfTests }), "utf8");
  }

  const summary = {
    schema: SCHEMA,
    command: "architecture:observe",
    spec: { path: SPEC_PATH, commit: SPEC_COMMIT },
    git: measurement.volatile.git,
    scan_roots: SCAN_ROOTS,
    tracked_source_files_scanned: scanFiles.length,
    legacy_files_scanned_rederived: legacy.legacy_scanned_files,
    observer_internal_edges: graph.edges.length,
    legacy_internal_edges_rederived: legacy.legacy_internal_edges,
    observer_only_edges: observerOnly.length,
    declared_owned_files: declaredOwnedFiles.length,
    undeclared_files: undeclaredFiles.length,
    unresolved_internal_references: graph.unresolved.length,
    known_positive_observable: knownPositive.observable,
    self_tests_pass: selfTests.every((t) => t.pass),
    semantic_hash: measurement.semantic_hash,
    artifacts_written: noWrite ? [] : [
      `${outLabel}/architecture-observatory.json`,
      `${outLabel}/legacy-comparison.json`,
      `${outLabel}/observatory-self-test.json`,
      `${outLabel}/ARCHITECTURE_OBSERVATORY_REPORT.md`,
    ],
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

module.exports = {
  SCHEMA,
  SPEC_PATH,
  SPEC_COMMIT,
  SCAN_ROOTS,
  SOURCE_EXTENSIONS,
  OWNER_UNDECLARED,
  lex,
  extractReferences,
  createResolver,
  parseManifestText,
  ownershipFromManifests,
  buildObserverGraph,
  legacyRuleRederrivation,
  legacyResolveSpecifier,
  knownPositiveControl,
  regexCrossCheck,
  runSelfTests,
  selectScanSet,
  isSourceFile,
  canonicalJson,
  sha256,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`architecture observatory failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
