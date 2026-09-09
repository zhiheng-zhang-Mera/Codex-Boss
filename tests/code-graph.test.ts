import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanRepo } from "../electron/engineering/repo-inspector";
import { buildCodeGraph, cachedCodeGraph, moduleRisk } from "../electron/engineering/code-graph";
import { ContentCache } from "../electron/cache/content-cache";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-cg-")); dirs.push(dir); return dir; }
function write(root: string, relative: string, content = "") { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }

describe("code knowledge graph", () => {
  it("builds modules with own tests, dependency counts and change risk", () => {
    const dir = root();
    write(dir, "src/lib.ts", "import { u } from './util';");
    write(dir, "src/util.ts", "export const u = 1;");
    write(dir, "src/lib.test.ts", "import { lib } from './lib'; test('l', () => {});");
    const snapshot = scanRepo(dir);
    const graph = buildCodeGraph(snapshot);
    const lib = moduleRisk(graph, "src/lib.ts")!;
    expect(lib.tests).toEqual(["src/lib.test.ts"]);
    expect(lib.outbound).toBe(1); // -> util
    expect(lib.inbound).toBe(1);  // lib.test imports lib
    expect(lib.changeRisk).toBe(2);
    const util = moduleRisk(graph, "src/util.ts")!;
    expect(util.inbound).toBe(1);
  });

  it("caches per repo signature and invalidates on change", () => {
    const dir = root();
    write(dir, "src/a.ts", "export const a = 1;");
    write(dir, "src/a.test.ts", "import { a } from './a'; test('a', () => a);");
    const cache = new ContentCache<ReturnType<typeof buildCodeGraph>>();
    const snapshot = scanRepo(dir);
    const first = cachedCodeGraph(dir, cache, snapshot);
    expect(first.fromCache).toBe(false);
    const second = cachedCodeGraph(dir, cache, scanRepo(dir));
    expect(second.fromCache).toBe(true);
    // Content change that alters the signature invalidates.
    write(dir, "src/a.ts", "export const a = 2; // longer content for a size change");
    const third = cachedCodeGraph(dir, cache, scanRepo(dir));
    expect(third.fromCache).toBe(false);
  });

  it("sorts modules by change risk descending", () => {
    const dir = root();
    write(dir, "src/hot.ts", "import './mid';");
    write(dir, "src/mid.ts", "import './cold';");
    write(dir, "src/cold.ts", "export const c = 1;");
    const snapshot = scanRepo(dir);
    const graph = buildCodeGraph(snapshot);
    expect(graph.modules[0].file).toBe("src/mid.ts"); // inbound 1 + outbound 1 = 2
  });
});
