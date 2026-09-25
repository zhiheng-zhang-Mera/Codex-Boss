import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P2-A increment 2 step 3a — the provider contract closure, and the bridge that keeps it from being a half-move.
 *
 * WHY A SPLIT NEEDS ITS OWN TEST
 *
 *   Moving a closure out of a shared bundle is only a repair if EVERY importer moves with it. A single file left
 *   pointing at the old module keeps an edge that the ownership map still attributes to `status`, so the
 *   measurement would improve by however many files happened to be edited rather than by the closure -- and the
 *   next reader could not tell which. These cases pin the three properties that make the move complete:
 *
 *     1  the new module owns the whole closure and depends on nothing in `contracts.ts`;
 *     2  no file under `electron/` or `src/` still imports a moved symbol from `contracts.ts`;
 *     3  the ONE remaining exception is a declared bridge, exactly one symbol wide, named in a tracked document
 *        WITH an exit condition -- because a bridge whose scope is unpinned is how a split silently reverts.
 *
 *   `docs/city/PHASE2_P2A_PROVIDER_CLOSURE.md` carries the bridge's id, owner, reason, source, target, exit
 *   condition, deadline and tests, as the workbook requires of any temporary bridge.
 */

const PROJECT = process.cwd();
const CONTRACTS = "src/shared/contracts.ts";
const PROVIDER_CONTRACTS = "src/shared/provider-contracts.ts";
const BRIDGE_DOC = "docs/city/PHASE2_P2A_PROVIDER_CLOSURE.md";

/** The closure that moved. Named rather than derived, so a symbol quietly left behind is a failure. */
const MOVED = [
  "ProviderId", "RunTransport", "ApiProtocol", "AdapterOutcome", "ProviderRunPhase", "ProviderAccountMode",
  "Provider", "ProviderRun", "ProviderAccountState", "ApiProviderSetting", "UpdateApiSettingInput", "CustomProviderInput"
].sort();

/** The five Root Trust Surface suites the bridge exists for. Any OTHER file here is an unfinished move. */
const BRIDGED = [
  "tests/acceptance/architecture-discovery.test.ts",
  "tests/acceptance/execution-plan.test.ts",
  "tests/acceptance/knowledge-reuse.test.ts",
  "tests/acceptance/requirements-graph.test.ts",
  "tests/acceptance/workbook-production-acceptance.test.ts"
].sort();

const SKIP_DIRS = new Set(["node_modules", "dist", "dist-electron", ".git", "artifacts"]);
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(PROJECT, dir), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(relative, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(relative);
  }
  return out;
}
const read = (file: string): string => fs.readFileSync(path.join(PROJECT, file), "utf8");

/** Moved symbols a file imports from the OLD module, with the specifier RESOLVED against the importing file. */
function importedMovedFromContracts(file: string): string[] {
  // Resolving matters: a file inside `src/shared` writes `"./contracts"` and a file outside writes
  // `"../shared/contracts"`, so a suffix test on the raw specifier silently misses every straggler in the same
  // directory as the module -- which is exactly where the first version of this helper failed to look.
  const text = read(file);
  const found: string[] = [];
  for (const match of text.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];/g)) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2])).replace(/\.ts$/, "");
    if (resolved !== CONTRACTS.replace(/\.ts$/, "")) continue;
    for (const raw of match[1].split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (name && MOVED.includes(name)) found.push(name);
    }
  }
  return found;
}

describe("P2-A step 3a — the provider closure owns its types", () => {
  it("exports every moved symbol from the new module", () => {
    const text = read(PROVIDER_CONTRACTS);
    const exported = new Set([...text.matchAll(/^export\s+(?:interface|type|const|function|class|enum)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]));
    const missing = MOVED.filter((symbol) => !exported.has(symbol));
    expect(missing, `these moved symbols are not declared in ${PROVIDER_CONTRACTS}`).toEqual([]);
  });

  it("no longer DECLARES the moved symbols in contracts.ts", () => {
    const text = read(CONTRACTS);
    const declared = new Set([...text.matchAll(/^export\s+(?:interface|type|const|function|class|enum)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]));
    const stillThere = MOVED.filter((symbol) => declared.has(symbol));
    expect(stillThere, `these symbols are still declared in ${CONTRACTS}, so the closure did not move: ${stillThere.join(", ")}`).toEqual([]);
  });

  it("the new module does NOT depend on contracts.ts, which is what keeps the pair from cycling", () => {
    // A back-edge would make the two shared modules mutually dependent, and the inventory would report a new
    // `providers <-> status` mutual pair -- the P2-C half of config/p2b-kernel-feature-ratchet.json. This was
    // checked before the move; this case is what stops a later edit from reintroducing it.
    const text = read(PROVIDER_CONTRACTS);
    expect(text, `${PROVIDER_CONTRACTS} imports ./contracts, which can create a cycle between shared modules`).not.toMatch(/from\s+["'][^"']*contracts["']/);
  });
});

describe("P2-A step 3a — every importer moved except the declared bridge", () => {
  const files = [...walk("electron"), ...walk("src"), ...walk("tests")].filter((file) => file !== CONTRACTS && file !== PROVIDER_CONTRACTS);

  it("no electron/ or src/ file still imports a moved symbol from contracts.ts", () => {
    const stragglers: string[] = [];
    for (const file of files) {
      if (file.startsWith("tests/")) continue;
      const hit = importedMovedFromContracts(file);
      if (hit.length > 0) stragglers.push(`${file} [${hit.join(", ")}]`);
    }
    expect(stragglers, "these files still route a moved type through the old module, so the edge is unrepaired").toEqual([]);
  });

  it("NO file routes a moved symbol through the old module, because the bridge was RETIRED", () => {
    const remaining: string[] = [];
    for (const file of files) {
      if (importedMovedFromContracts(file).length > 0) remaining.push(file);
    }
    // This assertion used to be `toEqual(BRIDGED)` -- exactly the five Root Trust suites the bridge existed for.
    // Ledger CC-044 retired the bridge, so the guard INVERTS instead of disappearing: the expectation is now an
    // empty list, and a file appearing here is still an unfinished move.
    expect(remaining.sort()).toEqual([]);
    expect(BRIDGED.length, "the historical bridged list is part of the record and must not be quietly edited").toBe(5);
  });
});

describe("P2-A step 3a — the bridge was retired, and what it guarded is guarded harder", () => {
  it("no longer re-exports ANY moved symbol from contracts.ts", () => {
    const text = read(CONTRACTS);
    const reExports = [...text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']*provider-contracts["']/g)];
    expect(reExports.length, "a re-export came back: that IS the bridge, and it was retired by ledger CC-044").toBe(0);
  });

  it("keeps the bridge's name and fate in the source, so a reader meets the history where the constraint applied", () => {
    expect(read(CONTRACTS)).toMatch(/BRIDGE P2A-BRIDGE-01/);
    expect(read(CONTRACTS)).toMatch(/RETIRED/);
    // The type is still imported for contracts.ts's OWN declarations, which is what made the re-export a bridge
    // rather than the place the closure lived.
    expect(read(CONTRACTS)).toMatch(/^\s+ProviderId,$/m);
  });

  it("records the retirement as a walked lifecycle rather than as a deletion of the record", () => {
    const lifecycle = JSON.parse(read("config/city-replacement-lifecycle.json")) as {
      instances: Record<string, { state: string; history: Array<{ to: string }> }>;
    };
    const instance = lifecycle.instances["P2A-BRIDGE-01-RETIREMENT"];
    expect(instance.state).toBe("RETIRED");
    expect(instance.history.map((step) => step.to)).toEqual([
      "SHADOW", "DUAL_VALIDATED", "TRAFFIC_SWITCHED", "OLD_FALLBACK", "DRAINED", "RETIRED",
    ]);
  });

  it("declares no bridge in the flatness registry, so the seal gate has none to refuse", () => {
    const registry = JSON.parse(read("config/city-flatness.json")) as { bridges: Record<string, unknown> };
    expect(Object.keys(registry.bridges), "the registry still declares a bridge").toEqual([]);
  });

  it("the bridge is declared in a tracked document WITH an exit condition and a deadline", () => {
    const doc = read(BRIDGE_DOC);
    expect(doc).toContain("P2A-BRIDGE-01");
    for (const field of ["BRIDGE_ID", "OWNER", "REASON", "SOURCE", "TARGET", "EXIT_CONDITION", "DEADLINE/PHASE", "TESTS"]) {
      expect(doc, `the bridge declaration is missing ${field}`).toContain(field);
    }
    // A bridge without an exit condition is not allowed, so the exit must be stated and not merely implied.
    expect(doc).toMatch(/EXIT_CONDITION\s+delete the re-export/);
  });

  it("the bridge document names a test file that exists, so its TESTS field is not a promise", () => {
    const doc = read(BRIDGE_DOC);
    const named = [...doc.matchAll(/(tests\/[A-Za-z0-9_./-]+\.test\.ts)/g)].map((m) => m[1]);
    expect(named.length, "the bridge document names no test file").toBeGreaterThan(0);
    for (const file of new Set(named)) {
      expect(fs.existsSync(path.join(PROJECT, file)), `the bridge document names ${file}, which does not exist`).toBe(true);
    }
  });
});
