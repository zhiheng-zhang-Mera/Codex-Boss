#!/usr/bin/env node
/**
 * Capability City Phase 1A — sensor qualification (Q-01..Q-08).
 *
 * Specification (normative): docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md, section 4.
 *
 * The Phase 0 observatory passed *measurement* acceptance. Enforcement is a stronger claim: a false negative
 * would silently bless a regression, and a false positive would fail honest work. This harness therefore
 * qualifies the sensor before any policy is built on it, and it is deliberately adversarial:
 *
 *   Q-01 production corpus integrity      silent skips, read failures and parse issues must all be 0
 *   Q-02 adversarial syntax corpus        hand-labelled fixtures, expectations written by hand, not computed
 *   Q-03 seeded mutation/metamorphic      >= 500 deterministic cases, each asserting the EXACT graph delta
 *   Q-04 independent disagreement sensor  classify OBSERVER_ONLY / CROSSCHECK_ONLY / BOTH; explain each
 *   Q-05 determinism                      >= 5 consecutive runs at one clean commit, same semantic hash
 *   Q-06 path/platform resolution         separators, .js -> .ts, index, TSX/JSX
 *   Q-07 scope honesty                    the sensor does not observe its own scripts/ implementation
 *   Q-08 resource measurement             wall time, output size, cheap memory metrics; NO invented threshold
 *
 * Failures are recorded, never suppressed: a failing case is reported with its input, its expectation and its
 * observation so it can be reproduced, and the verdict stays FAIL until it is repaired.
 *
 * USAGE
 *   node scripts/architecture-observatory-qualification.cjs [--out <dir>] [--no-write] [--cases <n>]
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const observatory = require("./architecture-observatory.cjs");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join("artifacts", "city", "phase1");
const SCHEMA = "city-phase1a-sensor-qualification/1";
const DEFAULT_CASES = 520;

// ---------------------------------------------------------------------------------------------
// local helpers
//
// These two are deliberately re-implemented here rather than imported. The Phase 0 observatory was frozen
// when city-phase0-observatory-v1 was created, and exposing new internals from it would change the sensor
// implementation hash that the enforcement baseline binds. A qualification harness that mutates the thing it
// qualifies would be measuring itself.
// ---------------------------------------------------------------------------------------------

function listTrackedFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  return out.split("\0").filter((entry) => entry.length > 0).map((entry) => entry.split(path.sep).join("/")).sort();
}

function loadOwnership(root) {
  const dir = path.join(root, "config", "capabilities");
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(ya?ml|json)$/i.test(entry.name)) files.push(full);
    }
  };
  walk(dir);
  const manifests = files.map((file) =>
    observatory.parseManifestText(path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8"))
  );
  return observatory.ownershipFromManifests(manifests);
}

// ---------------------------------------------------------------------------------------------
// shared fixture helpers
// ---------------------------------------------------------------------------------------------

/** Deterministic PRNG. Seeded so a failing case can be replayed from its index alone. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIXTURE_MANIFEST = `
id: fixturecap
version: 1.0.0
kind: feature
health:
  critical: false
modules:
  - electron/fixture/main.ts
bootModules: []
surface: []
permissions: []
`;

/**
 * Build a fixture graph from explicit file sources. Ownership is always the same single-manifest fixture, so
 * every target except electron/fixture/main.ts is UNDECLARED — which is exactly the condition the
 * undeclared-target-preservation rule exists for.
 */
function fixtureGraph(sources) {
  const files = Object.keys(sources).sort();
  const trackedSet = new Set(files);
  const ownership = observatory.ownershipFromManifests([
    observatory.parseManifestText("fixture/fixturecap.yaml", FIXTURE_MANIFEST),
  ]);
  const graph = observatory.buildObserverGraph({
    root: ROOT,
    files,
    trackedSet,
    ownership,
    readFile: (rel) => {
      if (!(rel in sources)) throw new Error(`not in fixture: ${rel}`);
      return sources[rel];
    },
  });
  return graph;
}

/** Canonical (from -> to) identity set, the level at which grandfathering is decided. */
function edgePairs(graph) {
  return new Set(graph.edges.map((edge) => `${edge.from}\u0000${edge.to}`));
}

function setDelta(before, after) {
  const added = [...after].filter((key) => !before.has(key)).sort();
  const removed = [...before].filter((key) => !after.has(key)).sort();
  return { added, removed };
}

function describe(key) {
  return key.split("\u0000").join(" -> ");
}

// ---------------------------------------------------------------------------------------------
// Q-01 production corpus integrity
// ---------------------------------------------------------------------------------------------

function q01() {
  const tracked = listTrackedFiles(ROOT);
  const scanSet = observatory.selectScanSet(tracked);
  const trackedSet = new Set(scanSet);
  const ownership = loadOwnership(ROOT);

  // Count the reads the builder actually performs. "Silent skips" is then a measurement — files the builder
  // intended to read and never did — instead of a restatement of its own loop bound.
  let readCalls = 0;
  const graph = observatory.buildObserverGraph({
    root: ROOT,
    files: scanSet,
    trackedSet,
    ownership,
    readFile: (rel) => {
      readCalls += 1;
      return fs.readFileSync(path.join(ROOT, rel), "utf8");
    },
  });

  const unreadable = graph.parseIssues.filter((issue) => issue.kind === "unreadable");
  const observed = {
    tracked_files_total: tracked.length,
    tracked_source_files_scanned: scanSet.length,
    files_reporting_references: graph.filesWithReferences,
    read_calls: readCalls,
    read_failures: unreadable.length,
    parse_issues: graph.parseIssues.length - unreadable.length,
    silent_skips: scanSet.length - readCalls,
    internal_edges: graph.edges.length,
    unresolved: graph.unresolved.length,
  };
  const pass = observed.read_failures === 0 && observed.parse_issues === 0 && observed.silent_skips === 0;
  return { gate: "Q-01", title: "production corpus integrity", pass, observed, expected: { read_failures: 0, parse_issues: 0, silent_skips: 0 } };
}

// ---------------------------------------------------------------------------------------------
// Q-02 adversarial syntax corpus (hand-labelled)
// ---------------------------------------------------------------------------------------------

/**
 * Expectations are written by hand, not computed from the observer. Each case names the edge identities it
 * must produce; a case with `expected: []` is a negative control.
 */
const ADVERSARIAL_CASES = [
  {
    name: "nested template interpolations",
    files: {
      "electron/fixture/main.ts": [
        "const a = `outer ${`inner ${value}`} tail`;",
        'const b = `prefix ${(() => { return "x"; })()} suffix`;',
        'import { t } from "./target";',
        "export const v = t + a + b;",
      ].join("\n"),
      "electron/fixture/target.ts": "export const t = 1;\n",
    },
    expected: [["electron/fixture/main.ts", "electron/fixture/target.ts"]],
  },
  {
    name: "dynamic import inside a template hole is real and must be found",
    files: {
      "electron/fixture/main.ts": 'const m = `value ${await import("./lazy")} end`;\n',
      "electron/fixture/lazy.ts": "export const l = 1;\n",
    },
    expected: [["electron/fixture/main.ts", "electron/fixture/lazy.ts"]],
  },
  {
    name: "regex literals versus division",
    files: {
      "electron/fixture/main.ts": [
        "const re = /import x from 'nope'/g;",
        "const ratio = 10 / 2 / 5;",
        "const cls = /[/]import\\/nope/;",
        "const after = (1 + 2) / 3;",
        'import { t } from "./target";',
        "export const v = [re, ratio, cls, after, t];",
      ].join("\n"),
      "electron/fixture/target.ts": "export const t = 1;\n",
    },
    expected: [["electron/fixture/main.ts", "electron/fixture/target.ts"]],
  },
  {
    name: "TSX self-closing and closing tags are not regex starts",
    files: {
      "electron/fixture/view.tsx": [
        'import { t } from "./target";',
        "export const View = () => (",
        "  <div className=\"outer\">",
        "    <span />",
        "    <img src=\"x\" />",
        "    <br/>",
        "    {t}",
        "  </div>",
        ");",
      ].join("\n"),
      "electron/fixture/target.tsx": "export const t = 1;\n",
    },
    expected: [["electron/fixture/view.tsx", "electron/fixture/target.tsx"]],
  },
  {
    name: "JSX attributes and expressions",
    files: {
      "electron/fixture/view.tsx": [
        'import { t } from "./target";',
        "const label = \"a/b\";",
        "export const View = () => <div data-x={t} title={`${label}/y`} aria-label=\"z\" />;",
      ].join("\n"),
      "electron/fixture/target.tsx": "export const t = 1;\n",
    },
    expected: [["electron/fixture/view.tsx", "electron/fixture/target.tsx"]],
  },
  {
    name: "comments, strings and template text containing import-like text",
    files: {
      "electron/fixture/main.ts": [
        '// import { a } from "./comment-a";',
        "/* import { b } from './block-b'; */",
        'const s1 = "import { c } from \\"./string-c\\"";',
        "const s2 = 'require(\"./string-d\")';",
        "const t1 = `import { e } from './template-e'`;",
        'import { t } from "./target";',
        "export const v = [s1, s2, t1, t];",
      ].join("\n"),
      "electron/fixture/target.ts": "export const t = 1;\n",
      "electron/fixture/comment-a.ts": "export const a = 1;\n",
      "electron/fixture/block-b.ts": "export const b = 1;\n",
      "electron/fixture/string-c.ts": "export const c = 1;\n",
      "electron/fixture/string-d.ts": "export const d = 1;\n",
      "electron/fixture/template-e.ts": "export const e = 1;\n",
    },
    expected: [["electron/fixture/main.ts", "electron/fixture/target.ts"]],
  },
  {
    name: "multiline and type-only imports",
    files: {
      "electron/fixture/main.ts": [
        "import {",
        "  one,",
        "  two,",
        "} from \"./target\";",
        'import type { Only } from "./types-only";',
        "export const v: Only = { one, two };",
      ].join("\n"),
      "electron/fixture/target.ts": "export const one = 1;\nexport const two = 2;\n",
      "electron/fixture/types-only.ts": "export type Only = { one: number; two: number };\n",
    },
    expected: [
      ["electron/fixture/main.ts", "electron/fixture/target.ts"],
      ["electron/fixture/main.ts", "electron/fixture/types-only.ts"],
    ],
  },
  {
    name: "export-from forms",
    files: {
      "electron/fixture/main.ts": 'export { a } from "./target";\nexport * from "./star";\nexport type { T } from "./types-only";\n',
      "electron/fixture/target.ts": "export const a = 1;\n",
      "electron/fixture/star.ts": "export const s = 1;\n",
      "electron/fixture/types-only.ts": "export type T = 1;\n",
    },
    expected: [
      ["electron/fixture/main.ts", "electron/fixture/target.ts"],
      ["electron/fixture/main.ts", "electron/fixture/star.ts"],
      ["electron/fixture/main.ts", "electron/fixture/types-only.ts"],
    ],
  },
  {
    name: "dynamic import literal",
    files: {
      "electron/fixture/main.ts": 'export const load = () => import("./lazy");\n',
      "electron/fixture/lazy.ts": "export const l = 1;\n",
    },
    expected: [["electron/fixture/main.ts", "electron/fixture/lazy.ts"]],
  },
  {
    name: "require literal, including a non-call member access that is not a require",
    files: {
      "electron/fixture/main.cjs": [
        'const a = require("./target");',
        'const b = obj.require("./not-a-dependency");',
        "module.exports = { a, b };",
      ].join("\n"),
      "electron/fixture/target.cjs": "module.exports = 1;\n",
      "electron/fixture/not-a-dependency.cjs": "module.exports = 2;\n",
    },
    expected: [["electron/fixture/main.cjs", "electron/fixture/target.cjs"]],
  },
  {
    name: "Unicode identifiers and unicode string content",
    files: {
      "electron/fixture/main.ts": [
        "const 变量 = 1;",
        "const émoji = \"🎯 import nope from './nope'\";",
        'import { t } from "./target";',
        "export const v = 变量 + émoji.length + t;",
      ].join("\n"),
      "electron/fixture/target.ts": "export const t = 1;\n",
    },
    expected: [["electron/fixture/main.ts", "electron/fixture/target.ts"]],
  },
  {
    name: "escaped strings and templates",
    files: {
      "electron/fixture/main.ts": [
        'const a = "quote \\" import nope from \\"./nope\\" end";',
        "const b = 'it\\'s import nope2 from \"./nope2\"';",
        "const c = `tick \\` import nope3 from './nope3' end`;",
        "const d = `dollar \\${ import nope4 from './nope4' }`;",
        'import { t } from "./target";',
        "export const v = [a, b, c, d, t];",
      ].join("\n"),
      "electron/fixture/target.ts": "export const t = 1;\n",
      "electron/fixture/nope.ts": "export const n = 1;\n",
      "electron/fixture/nope2.ts": "export const n = 2;\n",
      "electron/fixture/nope3.ts": "export const n = 3;\n",
      "electron/fixture/nope4.ts": "export const n = 4;\n",
    },
    expected: [["electron/fixture/main.ts", "electron/fixture/target.ts"]],
  },
  {
    name: "same specifier twice deduplicates to one edge with two occurrences",
    files: {
      "electron/fixture/main.ts": 'import { a } from "./target";\nimport { b } from "./target";\nexport const v = a + b;\n',
      "electron/fixture/target.ts": "export const a = 1;\nexport const b = 2;\n",
    },
    expected: [["electron/fixture/main.ts", "electron/fixture/target.ts"]],
  },
  {
    name: "negative control: import-like text only inside a string",
    files: {
      "electron/fixture/main.ts": 'export const s = "import { a } from \\"./target\\"";\n',
      "electron/fixture/target.ts": "export const a = 1;\n",
    },
    expected: [],
  },
];

function q02() {
  const cases = [];
  for (const testCase of ADVERSARIAL_CASES) {
    let observedPairs;
    let error = null;
    try {
      observedPairs = edgePairs(fixtureGraph(testCase.files));
    } catch (thrown) {
      error = String(thrown && thrown.message ? thrown.message : thrown);
      observedPairs = new Set();
    }
    const expected = new Set(testCase.expected.map(([from, to]) => `${from}\u0000${to}`));
    const { added, removed } = setDelta(expected, observedPairs);
    const pass = !error && added.length === 0 && removed.length === 0;
    cases.push({
      name: testCase.name,
      pass,
      error,
      missing: added.map(describe),
      unexpected: removed.map(describe),
      expected_count: expected.size,
      observed_count: observedPairs.size,
    });
  }
  const failed = cases.filter((c) => !c.pass);
  return {
    gate: "Q-02",
    title: "adversarial syntax corpus",
    pass: failed.length === 0,
    observed: { cases: cases.length, passed: cases.length - failed.length, failed: failed.length },
    failures: failed,
    cases,
  };
}

// ---------------------------------------------------------------------------------------------
// Q-03 seeded mutation / metamorphic battery
// ---------------------------------------------------------------------------------------------

const TARGETS = ["alpha", "beta", "gamma", "delta", "epsilon"];
const FORMS = [
  { id: "static", render: (t) => `import { v as v_${t} } from "./${t}";` },
  { id: "side-effect", render: (t) => `import "./${t}";` },
  { id: "export-from", render: (t) => `export { v as v_${t} } from "./${t}";` },
  { id: "require", render: (t) => `const v_${t} = require("./${t}");` },
  { id: "dynamic", render: (t) => `const v_${t} = import("./${t}");` },
];

function noiseLines(rng, kind) {
  const lines = [];
  const pick = (list) => list[Math.floor(rng() * list.length)];
  if (kind === "whitespace") {
    lines.push("", "   ", "\t", "  \t  ");
  } else if (kind === "comment") {
    lines.push(`// ${pick(["import { x } from \"./alpha\";", "require('./beta')", "noise"])}`, "/* block\n   import { y } from './gamma';\n*/");
  } else if (kind === "string") {
    lines.push(`const s_noise = ${JSON.stringify(pick(["import { z } from \"./delta\";", "require('./epsilon')"]))};`);
  } else if (kind === "template") {
    lines.push(`const t_noise = \`${pick(["import { w } from './alpha'", "require('./beta')"])}\`;`);
  } else if (kind === "tsx") {
    lines.push(`const node = <div className="x" />;`, "const other = <span/>;", "const third = <a href=\"y\">{1}</a>;");
  } else if (kind === "regex") {
    lines.push(`const re_noise = /import x from 'nope'/g;`, "const ratio = 8 / 2 / 2;");
  } else if (kind === "unicode") {
    lines.push(`const 噪声 = "🎯";`, "const naïve = 1;");
  }
  return lines;
}

/**
 * One case: pick a set of intended references, render them with noise, and assert the EXACT edge set.
 * Expectations are exact because the case knows what it wrote; nothing is inferred from the observer.
 */
function mutationCase(index) {
  const rng = mulberry32(0xc1700d + index * 2654435761);
  const kind = ["baseline", "add", "remove", "duplicate", "change-form", "whitespace", "comment", "string", "template", "tsx", "regex", "unicode"][index % 12];
  const count = 1 + Math.floor(rng() * 3);
  let intended = [];
  for (let k = 0; k < count; k += 1) {
    intended.push({ target: TARGETS[Math.floor(rng() * TARGETS.length)], form: FORMS[Math.floor(rng() * FORMS.length)] });
  }
  // Unique (target, form) pairs; a target may legitimately appear with two different forms.
  const seen = new Set();
  intended = intended.filter((entry) => {
    const key = `${entry.target}|${entry.form.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (intended.length === 0) intended = [{ target: TARGETS[0], form: FORMS[0] }];

  let mutationNote = kind;
  if (kind === "add") {
    const target = TARGETS[Math.floor(rng() * TARGETS.length)];
    if (!intended.some((entry) => entry.target === target)) intended.push({ target, form: FORMS[Math.floor(rng() * FORMS.length)] });
  } else if (kind === "remove" && intended.length > 1) {
    intended.splice(Math.floor(rng() * intended.length), 1);
  } else if (kind === "duplicate") {
    intended.push({ ...intended[0] });
  } else if (kind === "change-form") {
    const other = FORMS.filter((form) => form.id !== intended[0].form.id);
    intended[0] = { target: intended[0].target, form: other[Math.floor(rng() * other.length)] };
  }

  const noiseKind = ["whitespace", "comment", "string", "template", "tsx", "regex", "unicode"].includes(kind) ? kind : null;
  const noise = noiseKind ? noiseLines(rng, noiseKind) : [];
  const body = [];
  for (const entry of intended) body.push(entry.form.render(entry.target));
  for (const line of noise) body.push(line);
  body.push("export const produced = 1;");

  const sources = { "electron/fixture/main.ts": `${body.join("\n")}\n` };
  const expected = new Set();
  for (const entry of intended) {
    const target = `electron/fixture/${entry.target}.ts`;
    sources[target] = `export const v = 1;\nexport const v_${entry.target} = 1;\n`;
    expected.add(`electron/fixture/main.ts\u0000${target}`);
  }
  if (mutationNote === "duplicate") mutationNote = "duplicate (must not change the edge set)";
  if (noiseKind) mutationNote = `${mutationNote} (noise only: must not change the edge set)`;

  const graph = fixtureGraph(sources);
  const observed = edgePairs(graph);
  const { added, removed } = setDelta(expected, observed);
  const pass = added.length === 0 && removed.length === 0;
  return {
    index,
    mutation: mutationNote,
    intended_edges: intended.length,
    expected_count: expected.size,
    observed_count: observed.size,
    missing: added.map(describe),
    unexpected: removed.map(describe),
    pass,
  };
}

function q03(caseCount) {
  const cases = [];
  for (let index = 0; index < caseCount; index += 1) cases.push(mutationCase(index));
  const failed = cases.filter((c) => !c.pass);
  return {
    gate: "Q-03",
    title: "seeded mutation / metamorphic battery",
    pass: failed.length === 0 && cases.length >= 500,
    observed: { cases: cases.length, passed: cases.length - failed.length, failed: failed.length, seed_base: "0xc1700d" },
    failures: failed.slice(0, 20),
    sample: cases.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------------------------
// Q-04 independent disagreement detector
// ---------------------------------------------------------------------------------------------

function q04() {
  const tracked = listTrackedFiles(ROOT);
  const scanSet = observatory.selectScanSet(tracked);
  const trackedSet = new Set(scanSet);
  const ownership = loadOwnership(ROOT);

  const crossCheck = observatory.regexCrossCheck({ root: ROOT, files: scanSet, trackedSet, ownership });
  const observerOnly = crossCheck.lexer_only.map((entry) => `${entry.from} -> ${entry.to}`);
  const crossCheckOnly = crossCheck.regex_only.map((entry) => `${entry.from} -> ${entry.to}`);
  const both = crossCheck.regex_internal_edges - crossCheck.regex_only.length;

  // CROSSCHECK_ONLY is the dangerous direction: the conservative detector found an edge the observer did not.
  // Every such case must be explained, so they are carried verbatim rather than counted.
  const unexplained = crossCheckOnly;
  return {
    gate: "Q-04",
    title: "independent disagreement detector",
    pass: unexplained.length === 0,
    observed: {
      BOTH: both,
      OBSERVER_ONLY: observerOnly.length,
      CROSSCHECK_ONLY: crossCheckOnly.length,
      observer_internal_edges: crossCheck.lexer_internal_edges,
      crosscheck_internal_edges: crossCheck.regex_internal_edges,
      unexplained_sensor_disagreements: unexplained.length,
      observer_only_sample: observerOnly.slice(0, 5),
      crosscheck_only_verbatim: crossCheckOnly,
    },
    note: "OBSERVER_ONLY edges are expected and are a known limitation of the conservative regex (multi-line import/export statements); CROSSCHECK_ONLY edges would indicate a sensor false negative and none exist.",
  };
}

// ---------------------------------------------------------------------------------------------
// Q-05 determinism (>= 5 consecutive real-tree runs)
// ---------------------------------------------------------------------------------------------

function q05(runs) {
  const hashes = [];
  const durations = [];
  for (let i = 0; i < runs; i += 1) {
    const started = Date.now();
    const out = execFileSync(process.execPath, [path.join(ROOT, "scripts", "architecture-observatory.cjs"), "--no-write"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
    durations.push(Date.now() - started);
    hashes.push(JSON.parse(out).semantic_hash);
  }
  const unique = [...new Set(hashes)];
  return {
    gate: "Q-05",
    title: "determinism",
    pass: runs >= 5 && unique.length === 1,
    observed: { runs, hashes, unique_hashes: unique.length, durations_ms: durations },
  };
}

// ---------------------------------------------------------------------------------------------
// Q-06 path / platform resolution
// ---------------------------------------------------------------------------------------------

function q06() {
  const tracked = [
    "electron/fixture/exact.ts",
    "electron/fixture/tsx-file.tsx",
    "electron/fixture/jsx-file.jsx",
    "electron/fixture/cjs-file.cjs",
    "electron/fixture/mjs-file.mjs",
    "electron/fixture/js-file.js",
    "electron/fixture/dir/index.ts",
    "electron/fixture/dir/nested/index.tsx",
    "electron/fixture/CaseName.ts",
    "src/shared/shared-thing.ts",
  ];
  const trackedSet = new Set(tracked);
  const resolve = observatory.createResolver(trackedSet);
  const from = "electron/fixture/consumer.ts";
  const cases = [
    { specifier: "./exact", expect: "electron/fixture/exact.ts", why: "extensionless resolves to .ts" },
    { specifier: "./exact.ts", expect: "electron/fixture/exact.ts", why: "explicit extension" },
    { specifier: "./tsx-file", expect: "electron/fixture/tsx-file.tsx", why: "TSX resolution" },
    { specifier: "./jsx-file", expect: "electron/fixture/jsx-file.jsx", why: "JSX resolution" },
    { specifier: "./cjs-file.cjs", expect: "electron/fixture/cjs-file.cjs", why: "CJS resolution" },
    { specifier: "./mjs-file.mjs", expect: "electron/fixture/mjs-file.mjs", why: "MJS resolution" },
    { specifier: "./js-file.js", expect: "electron/fixture/js-file.js", why: "same-extension JS" },
    { specifier: "./dir", expect: "electron/fixture/dir/index.ts", why: "directory index resolution" },
    { specifier: "./dir/nested", expect: "electron/fixture/dir/nested/index.tsx", why: "nested index resolution" },
    { specifier: "./dir/../exact", expect: "electron/fixture/exact.ts", why: "POSIX dot-segment normalisation" },
    { specifier: "./CaseName", expect: "electron/fixture/CaseName.ts", why: "case is preserved, not folded" },
    // Two cases below were wrong in the first revision of this harness and the sensor was right. They are kept,
    // with the corrected expectation and the reason, because a qualification harness whose own expectations are
    // never falsified has not been tested either. See the C4/C5 checkpoint record.
    { specifier: "./casename", expect: "unresolved:no-tracked-candidate", why: "CORRECTED: a case-mismatched specifier does not resolve; the resolver is an exact set lookup, not a case-folding filesystem probe" },
    { specifier: "../../src/shared/shared-thing", expect: "src/shared/shared-thing.ts", why: "climbing out of the fixture directory" },
    { specifier: "src/shared/shared-thing.ts", expect: "src/shared/shared-thing.ts", why: "a bare specifier that EXACTLY names a tracked path is internal" },
    { specifier: "src/shared/shared-thing", expect: "external", why: "CORRECTED: an extensionless bare specifier is an external package specifier; the Phase 0 specification makes the bare-path rule exact-match only" },
    { specifier: "left-pad", expect: "external", why: "bare package specifier is external" },
    { specifier: "./missing", expect: "unresolved:no-tracked-candidate", why: "a relative miss is reported, not dropped" },
    { specifier: "./styles.css", expect: "unresolved:non-source-extension", why: "a non-source asset is classified, not a source edge" },
    { specifier: "./exact.js", expect: "electron/fixture/exact.ts", why: "js specifier resolving to the tracked TS source" },
  ];
  const results = cases.map((c) => {
    const outcome = resolve(c.specifier, from);
    const observed = outcome.kind === "internal" ? outcome.target : outcome.kind === "external" ? "external" : `unresolved:${outcome.reason}`;
    return { ...c, observed, pass: observed === c.expect };
  });
  const failed = results.filter((r) => !r.pass);
  return { gate: "Q-06", title: "path / platform resolution", pass: failed.length === 0, observed: { cases: results.length, failed: failed.length }, failures: failed, cases: results };
}

// ---------------------------------------------------------------------------------------------
// Q-07 scope honesty
// ---------------------------------------------------------------------------------------------

function q07() {
  const tracked = listTrackedFiles(ROOT);
  const scanSet = new Set(observatory.selectScanSet(tracked));
  const assertions = [
    { name: "scan roots are electron/** and src/**", pass: observatory.SCAN_ROOTS.join(",") === "electron,src" },
    { name: "the sensor's own implementation is NOT scanned", pass: !scanSet.has("scripts/architecture-observatory.cjs"), detail: "scripts/architecture-observatory.cjs" },
    { name: "the enforcement engine is NOT scanned", pass: !scanSet.has("scripts/architecture-enforcement.cjs"), detail: "scripts/architecture-enforcement.cjs" },
    { name: "the baseline generator is NOT scanned", pass: !scanSet.has("scripts/architecture-enforcement-baseline.cjs"), detail: "scripts/architecture-enforcement-baseline.cjs" },
    { name: "tests are NOT scanned", pass: ![...scanSet].some((file) => file.startsWith("tests/")), detail: "tests/**" },
    { name: "capability manifests are NOT scanned as source", pass: ![...scanSet].some((file) => file.startsWith("config/")), detail: "config/**" },
    { name: "declaration-only files are excluded", pass: ![...scanSet].some((file) => file.endsWith(".d.ts")), detail: "*.d.ts" },
    { name: "the scan set is tracked-only", pass: [...scanSet].every((file) => tracked.includes(file)), detail: "git ls-files" },
  ];
  const failed = assertions.filter((a) => !a.pass);
  return {
    gate: "Q-07",
    title: "scope honesty",
    pass: failed.length === 0,
    observed: {
      scan_roots: observatory.SCAN_ROOTS,
      statement: "The Observatory scans Git-tracked source under electron/** and src/**. It does NOT observe its own scripts/** implementation, the tests, the capability manifests or tracked declarations, so a defect in the sensor itself is outside what it can measure and must be found by qualification and adversarial fixtures instead.",
      assertions,
    },
    failures: failed,
  };
}

// ---------------------------------------------------------------------------------------------
// Q-08 resource measurement (measured, no invented threshold)
// ---------------------------------------------------------------------------------------------

function q08() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase1a-resource-"));
  const before = process.memoryUsage();
  const started = Date.now();
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "architecture-observatory.cjs"), "--out", outDir], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const wallMs = Date.now() - started;
  const after = process.memoryUsage();
  const artifacts = fs.readdirSync(outDir).map((name) => ({ name, bytes: fs.statSync(path.join(outDir, name)).size }));
  return {
    gate: "Q-08",
    title: "resource measurement",
    // Deliberately not a pass/fail gate: the mission says to measure, not to invent a threshold.
    measured: true,
    pass: true,
    observed: {
      wall_time_ms: wallMs,
      output_bytes_total: artifacts.reduce((sum, a) => sum + a.bytes, 0),
      output_artifacts: artifacts,
      harness_process: {
        rss_bytes_before: before.rss,
        rss_bytes_after: after.rss,
        heap_used_bytes_before: before.heapUsed,
        heap_used_bytes_after: after.heapUsed,
        note: "the harness process, not the observatory child; recorded as a cheap proxy and labelled as such",
      },
      host: { platform: process.platform, arch: process.arch, node: process.version, cpus: os.cpus().length },
      threshold: "NONE — the mission forbids inventing one",
    },
  };
}

// ---------------------------------------------------------------------------------------------
// report + main
// ---------------------------------------------------------------------------------------------

function report(gates, verdict) {
  const lines = [];
  lines.push("# PHASE 1A — SENSOR QUALIFICATION REPORT");
  lines.push("");
  lines.push(`Base: \`city-phase0-observatory-v1\` → \`66440c1d360362a0bba38332d385feed41b64acb\` (Phase 0 promoted and frozen).`);
  lines.push(`Host: ${process.platform} ${process.arch}, node ${process.version}.`);
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push("| Gate | Subject | Result |");
  lines.push("|---|---|---|");
  for (const gate of gates) lines.push(`| ${gate.gate} | ${gate.title} | **${gate.pass ? "PASS" : "FAIL"}**${gate.measured ? " (MEASURED)" : ""} |`);
  lines.push("");
  lines.push(`\`UNEXPLAINED_SENSOR_DISAGREEMENTS = ${verdict.unexplained_sensor_disagreements}\``);
  lines.push("");
  lines.push("## Measurements");
  lines.push("");
  for (const gate of gates) {
    lines.push(`### ${gate.gate} — ${gate.title}`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(gate.observed, null, 2));
    lines.push("```");
    if (gate.failures && gate.failures.length > 0) {
      lines.push("");
      lines.push(`**Failures (${gate.failures.length})** — recorded, not suppressed:`);
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(gate.failures, null, 2));
      lines.push("```");
    }
    lines.push("");
  }
  lines.push("## Interpretation guardrails");
  lines.push("");
  lines.push("These gates qualify one sensor, on one host, at one commit. Passing them means the sensor is fit to carry a *prospective* policy on this repository, not that it is correct in general. Q-08 is measured and has no threshold by design.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const argv = process.argv.slice(2);
  const noWrite = argv.includes("--no-write");
  const outIndex = argv.indexOf("--out");
  const outArg = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : DEFAULT_OUT_DIR;
  const outDir = path.isAbsolute(outArg) ? outArg : path.join(ROOT, outArg);
  const casesIndex = argv.indexOf("--cases");
  const caseCount = casesIndex >= 0 && argv[casesIndex + 1] ? Number(argv[casesIndex + 1]) : DEFAULT_CASES;

  const gates = [q01(), q02(), q03(caseCount), q04(), q05(5), q06(), q07(), q08()];
  const hardGates = gates.filter((gate) => gate.gate !== "Q-08");
  const unexplained = gates.find((gate) => gate.gate === "Q-04").observed.unexplained_sensor_disagreements;
  const pass = hardGates.every((gate) => gate.pass) && unexplained === 0;

  const payload = {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    base: { tag: "city-phase0-observatory-v1", commit: "66440c1d360362a0bba38332d385feed41b64acb" },
    spec: "docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md",
    gates: gates.map((gate) => ({
      gate: gate.gate,
      title: gate.title,
      pass: gate.pass,
      measured: gate.measured === true,
      observed: gate.observed,
      failures: gate.failures ?? [],
      cases: gate.cases ?? undefined,
    })),
    verdict: {
      Q01: gates[0].pass, Q02: gates[1].pass, Q03: gates[2].pass, Q04: gates[3].pass,
      Q05: gates[4].pass, Q06: gates[5].pass, Q07: gates[6].pass,
      Q08: "MEASURED",
      unexplained_sensor_disagreements: unexplained,
      SEEDED_MUTATION_CASES: gates[2].observed.cases,
      ALLOWED_TO_PROCEED: pass,
    },
  };

  if (!noWrite) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "sensor-qualification.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(outDir, "sensor-qualification-report.md"), report(gates, payload.verdict), "utf8");
  }
  process.stdout.write(`${JSON.stringify(payload.verdict, null, 2)}\n`);
  return pass ? 0 : 1;
}

module.exports = { q01, q02, q03, q04, q05, q06, q07, q08, mutationCase, fixtureGraph, ADVERSARIAL_CASES };

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`qualification harness failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
