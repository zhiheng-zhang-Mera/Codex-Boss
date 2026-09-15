import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Phase K's measurement, kept in the repository so the claim is reproducible.
 *
 * The audit recorded "213 unused exports / 886 unused type exports" without a method, and a
 * name-import scan is what produces a number like that. Measured against the compiler and the whole
 * tree instead, those symbols are not dead code: every one of them is used inside its own module (so
 * only the `export` keyword is unused) or is named outside it (in another module's comment, in a
 * script that loads the compiled module, or in `docs/`). This helper draws that line explicitly:
 *
 *   reachable   some type-checked file imports the name, directly or through a re-export chain
 *   mentioned   the identifier occurs in another tracked file (code, script, manifest or document)
 *   unreachable neither: an export nothing in the repository refers to, which is dead surface
 *
 * `tests/unit/export-surface.test.ts` fails while `unreachable` is non-empty, so the surface cannot
 * silently grow dead exports again.
 */

export interface ExportedSymbol {
  file: string;
  name: string;
  reachable: boolean;
  mentionedIn: string[];
}

export interface ExportSurface {
  providerFiles: number;
  consumerFiles: number;
  exports: ExportedSymbol[];
  unreachable: ExportedSymbol[];
}

const EXTENSIONS = [".ts", ".tsx"];
const TEXT_EXTENSIONS = [".ts", ".tsx", ".cjs", ".mjs", ".js", ".json", ".md", ".yml", ".yaml", ".css", ".html"];

const DECLARATION = /^[ \t]*export[ \t]+(?:declare[ \t]+)?(?:abstract[ \t]+)?(?:async[ \t]+)?(interface|type|function|class|const|let|var|enum)[ \t]+([A-Za-z_$][\w$]*)/gm;
// Clauses without line anchoring: this codebase formats multi-line import lists.
const EXPORT_CLAUSE = /(?:^|\n)[ \t]*export[ \t]*(?:type[ \t]+)?\{([^}]*)\}(?:[ \t]*from[ \t]*["']([^"']+)["'])?/g;
const EXPORT_STAR = /(?:^|\n)[ \t]*export[ \t]*(?:type[ \t]+)?\*[ \t]*from[ \t]*["']([^"']+)["']/g;
const IMPORT_CLAUSE = /(?:^|\n)[ \t]*import[ \t]*(?:type[ \t]+)?(?:[A-Za-z_$][\w$]*[ \t]*,[ \t]*)?\{([^}]*)\}[ \t]*from[ \t]*["']([^"']+)["']/g;
const IMPORT_NAMESPACE = /(?:^|\n)[ \t]*import[ \t]*(?:type[ \t]+)?\*[ \t]*as[ \t]+([A-Za-z_$][\w$]*)[ \t]*from[ \t]*["']([^"']+)["']/g;
const IMPORT_DEFAULT = /(?:^|\n)[ \t]*import[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?:,[^"']*)?from[ \t]*["']([^"']+)["']/g;
const REQUIRE_CALL = /require\([ \t]*["']([^"']+)["'][ \t]*\)/g;
const DYNAMIC_IMPORT = /import\([ \t]*["']([^"']+)["'][ \t]*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.includes(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function namesInClause(clause: string): string[] {
  return clause
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const aliased = /^[A-Za-z_$][\w$]*[ \t]+as[ \t]+([A-Za-z_$][\w$]*)$/.exec(part);
      if (aliased) return aliased[1];
      const typeOnly = /^type[ \t]+([A-Za-z_$][\w$]*)$/.exec(part);
      if (typeOnly) return typeOnly[1];
      return part;
    })
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

export function scanExportSurface(repoRoot: string): ExportSurface {
  const rel = (file: string) => path.relative(repoRoot, file).split(path.sep).join("/");
  const providerFiles = ["electron", "src"].flatMap((dir) => walk(path.join(repoRoot, dir)));
  const consumerFiles = ["electron", "src", "tests"].flatMap((dir) => walk(path.join(repoRoot, dir)));
  const providerSet = new Set(providerFiles.map(rel));

  const resolveSpecifier = (specifier: string, fromFile: string): string | null => {
    if (!specifier.startsWith(".")) return null;
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [
      ...EXTENSIONS.map((extension) => `${base}${extension}`),
      ...EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
      ...(/\.js$/.test(base) ? EXTENSIONS.map((extension) => `${base.slice(0, -3)}${extension}`) : [])
    ];
    for (const candidate of candidates) if (fs.existsSync(candidate)) return rel(candidate);
    return null;
  };

  const exportsByFile = new Map<string, string[]>();
  const reexports = new Map<string, Array<{ local: string; source: string }>>();
  const starSources = new Map<string, string[]>();
  const importedNames = new Map<string, Set<string>>();
  const namespaceModules = new Set<string>();

  for (const file of new Set([...providerFiles, ...consumerFiles])) {
    const text = fs.readFileSync(file, "utf8");
    const key = rel(file);
    if (providerSet.has(key)) {
      const declared: string[] = [];
      for (const match of text.matchAll(DECLARATION)) declared.push(match[2]);
      for (const match of text.matchAll(EXPORT_CLAUSE)) {
        if (match[2]) continue;
        declared.push(...namesInClause(match[1]));
      }
      exportsByFile.set(key, declared);
      for (const match of text.matchAll(EXPORT_STAR)) {
        const target = resolveSpecifier(match[1], file);
        if (target) starSources.set(key, [...(starSources.get(key) ?? []), target]);
      }
      for (const match of text.matchAll(EXPORT_CLAUSE)) {
        if (!match[2]) continue;
        const target = resolveSpecifier(match[2], file);
        if (!target) continue;
        reexports.set(key, [...(reexports.get(key) ?? []), ...namesInClause(match[1]).map((local) => ({ local, source: target }))]);
      }
    }
    for (const match of text.matchAll(IMPORT_CLAUSE)) {
      const target = resolveSpecifier(match[2], file);
      if (!target) continue;
      const names = importedNames.get(target) ?? new Set<string>();
      for (const name of namesInClause(match[1])) names.add(name);
      importedNames.set(target, names);
    }
    for (const match of text.matchAll(IMPORT_NAMESPACE)) {
      const target = resolveSpecifier(match[2], file);
      if (target) namespaceModules.add(target);
    }
    for (const match of text.matchAll(IMPORT_DEFAULT)) {
      const target = resolveSpecifier(match[2], file);
      if (!target) continue;
      const names = importedNames.get(target) ?? new Set<string>();
      names.add("default");
      importedNames.set(target, names);
    }
    for (const pattern of [REQUIRE_CALL, DYNAMIC_IMPORT]) {
      for (const match of text.matchAll(pattern)) {
        const target = resolveSpecifier(match[1], file);
        if (target) namespaceModules.add(target);
      }
    }
  }

  /** Does `module` (transitively) declare `name`? */
  const declares = (module: string, name: string, seen = new Set<string>()): boolean => {
    const key = `${module}#${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if ((exportsByFile.get(module) ?? []).includes(name)) return true;
    for (const entry of reexports.get(module) ?? []) if (entry.local === name && declares(entry.source, name, seen)) return true;
    for (const source of starSources.get(module) ?? []) if (declares(source, name, seen)) return true;
    return false;
  };

  // Reachability first (cheap: TypeScript files only), then one identifier pass over every tracked
  // text file for the names that are not reachable. Doing it the other way round — a regex per
  // name per file — is millions of regex compilations and does not fit in a unit-tier test.
  const unreachableByImport: ExportedSymbol[] = [];
  const symbols: ExportedSymbol[] = [];
  for (const [file, names] of exportsByFile) {
    for (const name of new Set(names)) {
      if (name === "default") continue;
      let reachable = namespaceModules.has(file);
      if (!reachable) {
        for (const [module, names] of importedNames) {
          if (!names.has(name)) continue;
          if (module === file || declares(module, name)) {
            reachable = true;
            break;
          }
        }
      }
      const symbol: ExportedSymbol = { file, name, reachable, mentionedIn: [] };
      symbols.push(symbol);
      if (!reachable) unreachableByImport.push(symbol);
    }
  }

  const pending = new Map<string, ExportedSymbol[]>();
  for (const symbol of unreachableByImport) pending.set(symbol.name, [...(pending.get(symbol.name) ?? []), symbol]);
  if (pending.size > 0) {
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && TEXT_EXTENSIONS.includes(path.extname(line)));
    for (const relative of tracked) {
      let text = "";
      try {
        text = fs.readFileSync(path.join(repoRoot, relative), "utf8");
      } catch {
        continue;
      }
      for (const token of text.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        const matches = pending.get(token);
        if (!matches) continue;
        for (const symbol of matches) {
          if (symbol.file !== relative) symbol.mentionedIn.push(relative);
        }
      }
    }
  }

  return {
    providerFiles: providerFiles.length,
    consumerFiles: consumerFiles.length,
    exports: symbols,
    unreachable: symbols.filter((symbol) => !symbol.reachable && symbol.mentionedIn.length === 0)
  };
}
