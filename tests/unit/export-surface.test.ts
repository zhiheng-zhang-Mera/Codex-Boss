import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanExportSurface } from "../helpers/export-surface-scan";

/**
 * Phase K — the export surface is measured, not assumed.
 *
 * The audit's item was "213 unused exports and 886 unused type exports across `electron/**` and
 * `src/**`", recorded without a method. Measuring it properly (through the import graph and the whole
 * tracked tree, so a re-export chain, a namespace import, a script that loads the compiled module or
 * a mention in `docs/` all count as a reference) shows something different: **not one export in this
 * repository is unreferenced**. The symbols that item counted fall into two classes —
 *
 *   - used inside their own module, so only the `export` keyword was unused (the phase's cleanup,
 *     done by removing the keyword rather than the declaration), and
 *   - named outside it, where the mention is the reason to keep it.
 *
 * This test is that measurement, and it fails when a new export nothing refers to appears: dead
 * surface is then a decision someone has to make and record in the exceptions file, not something
 * that accumulates unnoticed.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const EXCEPTIONS_FILE = path.join(ROOT, "tests", "fixtures", "export-surface-exceptions.json");

interface Exception {
  file: string;
  name: string;
  reason: string;
}

function readExceptions(): Exception[] {
  if (!fs.existsSync(EXCEPTIONS_FILE)) return [];
  const parsed = JSON.parse(fs.readFileSync(EXCEPTIONS_FILE, "utf8")) as { exceptions?: Exception[] };
  return parsed.exceptions ?? [];
}

describe("export surface", () => {
  const surface = scanExportSurface(ROOT);
  const exceptions = readExceptions();
  const key = (file: string, name: string) => `${file}#${name}`;
  const declared = new Set(exceptions.map((entry) => key(entry.file, entry.name)));
  const unrecorded = surface.unreachable.filter((symbol) => !declared.has(key(symbol.file, symbol.name)));

  it("scans the whole application surface", () => {
    // A scan that silently stops resolving paths would report an empty unreachable set and pass.
    // The export count is a floor, not a target: the Phase K cleanup removed 1080 unreachable
    // exports (3828 -> 2748), and new surface is expected to push it up again.
    expect(surface.providerFiles).toBeGreaterThan(400);
    expect(surface.consumerFiles).toBeGreaterThan(surface.providerFiles);
    expect(surface.exports.length).toBeGreaterThan(2500);
  });

  it("no export under electron/** or src/** is unreachable and unrecorded", () => {
    const grouped = new Map<string, string[]>();
    for (const symbol of unrecorded) grouped.set(symbol.file, [...(grouped.get(symbol.file) ?? []), symbol.name]);
    const report = [...grouped]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 20)
      .map(([file, names]) => `${file}: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ` (+${names.length - 8})` : ""}`);
    expect(
      report,
      "every export must be reachable (imported by name, directly or through a re-export chain) or " +
        "mentioned in another tracked file; otherwise drop the `export` keyword, or add a reasoned " +
        `entry to tests/fixtures/export-surface-exceptions.json. Unreachable (${unrecorded.length}):\n${report.join("\n")}`
    ).toEqual([]);
  });

  it("a recorded exception is still unreachable, so the list cannot rot", () => {
    const unreachable = new Set(surface.unreachable.map((symbol) => key(symbol.file, symbol.name)));
    const stale = exceptions.filter((entry) => !unreachable.has(key(entry.file, entry.name))).map((entry) => key(entry.file, entry.name));
    expect(stale, "these exceptions are no longer unreachable: remove them from the exceptions file").toEqual([]);
  });

  it("a recorded exception names a file and a symbol that exist", () => {
    const exportsByFile = new Map<string, Set<string>>();
    for (const symbol of surface.exports) {
      exportsByFile.set(symbol.file, new Set([...(exportsByFile.get(symbol.file) ?? []), symbol.name]));
    }
    const missing = exceptions
      .filter((entry) => !exportsByFile.get(entry.file)?.has(entry.name))
      .map((entry) => key(entry.file, entry.name));
    expect(missing).toEqual([]);
  });
});
