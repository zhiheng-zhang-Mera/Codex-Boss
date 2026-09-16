#!/usr/bin/env node
/**
 * Architecture diagnostics (platform foundation, Phase 01 Task E).
 *
 * Read-only inspection commands. Every one prints machine-readable JSON, so an Agent
 * can consume the result without scraping prose, and exits non-zero only when an
 * architecture ratchet is actually violated — a diagnostic that fails for a
 * formatting reason is a diagnostic nobody will run.
 *
 * Usage:
 *   node scripts/architecture.cjs graph      [--json]
 *   node scripts/architecture.cjs impact     <capability-id|id@major>
 *   node scripts/architecture.cjs ownership
 *   node scripts/architecture.cjs ratchet
 *   node scripts/architecture.cjs snapshot   (writes the phase artifact)
 *
 * The heavy lifting lives in the compiled-free TypeScript under `electron/platform`.
 * Because this script runs under plain Node without a TypeScript loader, it reads the
 * manifests itself and re-derives the graph through the same YAML parser, which keeps
 * the CLI honest: if the manifest set is invalid, the CLI fails exactly as a test would.
 */

const fs = require("node:fs");
const path = require("node:path");
const { parse: parseYaml } = require("yaml");

const ROOT = path.resolve(__dirname, "..");
const CAPABILITIES_ROOT = path.join(ROOT, "config", "capabilities");
const BASELINE_FILE = path.join(ROOT, "config", "architecture-baseline.json");
const SNAPSHOT_FILE = path.join(ROOT, "artifacts", "platform-foundation", "phase-01", "architecture-snapshot.json");

const REF = /^([a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)@([1-9][0-9]*)$/;

/** Read and validate every manifest. Throws with every problem at once. */
function loadManifests() {
  const problems = [];
  const manifests = [];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(ya?ml|json)$/i.test(entry.name)) files.push(full);
    }
  };
  walk(CAPABILITIES_ROOT);

  const seen = new Map();
  for (const file of files) {
    const source = path.relative(ROOT, file).split(path.sep).join("/");
    let raw;
    try {
      raw = parseYaml(fs.readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(`${source}: not parseable: ${error.message}`);
      continue;
    }
    if (!raw || typeof raw !== "object") { problems.push(`${source}: manifest must be a mapping`); continue; }
    if (typeof raw.id !== "string" || raw.id.trim() === "") { problems.push(`${source}: id is required`); continue; }
    if (typeof raw.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/.test(raw.version)) {
      problems.push(`${source}: version must be a semantic version`);
    }
    if (raw.kind !== "kernel" && raw.kind !== "feature") problems.push(`${source}: kind must be kernel or feature`);
    if (!raw.health || typeof raw.health.critical !== "boolean") problems.push(`${source}: health.critical must be a boolean`);
    if (!Array.isArray(raw.modules)) problems.push(`${source}: modules must be an array`);
    if (!Array.isArray(raw.bootModules)) problems.push(`${source}: bootModules must be an array`);
    if (!Array.isArray(raw.surface)) problems.push(`${source}: surface must be an array`);
    // Coerced rather than trusted: a malformed field is already recorded as a problem,
    // and continuing with `[]` lets one pass report every problem in the set instead of
    // dying on the first with a TypeError that names no file.
    const modules = Array.isArray(raw.modules) ? raw.modules : [];
    const bootModules = Array.isArray(raw.bootModules) ? raw.bootModules : [];
    const surface = Array.isArray(raw.surface) ? raw.surface : [];
    if (seen.has(raw.id)) problems.push(`${source}: duplicate capability id ${raw.id} (already in ${seen.get(raw.id)})`);
    seen.set(raw.id, source);

    const provides = [];
    for (const entry of raw.provides ?? []) {
      if (!REF.test(String(entry).trim())) { problems.push(`${source}: provides ${JSON.stringify(entry)} is not id@major`); continue; }
      provides.push(String(entry).trim());
    }
    const readRequirements = (list, kind) => (list ?? []).map((entry, index) => {
      if (!entry || typeof entry.ref !== "string" || !REF.test(entry.ref.trim())) {
        problems.push(`${source}: ${kind}[${index}].ref is not id@major`);
        return null;
      }
      if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
        problems.push(`${source}: ${kind}[${index}].reason is required`);
        return null;
      }
      return { ref: entry.ref.trim(), kind, reason: entry.reason.trim() };
    }).filter(Boolean);
    const requires = readRequirements(raw.requires, "required");
    const optional = readRequirements(raw.optional, "optional");
    const requiredRefs = new Set(requires.map((entry) => entry.ref));
    for (const entry of optional) {
      if (requiredRefs.has(entry.ref)) problems.push(`${source}: ${entry.ref} is both required and optional`);
    }
    const state = [];
    for (const entry of raw.state ?? []) {
      if (!entry || typeof entry.namespace !== "string") { problems.push(`${source}: state entry needs a namespace`); continue; }
      if (entry.owner !== raw.id) { problems.push(`${source}: state ${entry.namespace} must be owned by ${raw.id}, not ${entry.owner}`); continue; }
      state.push({ namespace: entry.namespace, owner: entry.owner });
    }
    for (const module of surface) if (!modules.includes(module)) problems.push(`${source}: surface ${module} is not in modules`);
    for (const module of bootModules) if (!modules.includes(module)) problems.push(`${source}: bootModules ${module} is not in modules`);

    manifests.push({
      id: raw.id, version: raw.version, kind: raw.kind, provides, requires, optional, state,
      critical: raw.health && raw.health.critical === true, modules, bootModules,
      surface, source
    });
  }
  if (problems.length > 0) {
    throw new Error(`manifest problems:\n  ${problems.join("\n  ")}`);
  }
  return manifests.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Build the capability graph: provider index, resolved edges, cycles, boot order. */
function buildGraph(manifests) {
  const providers = new Map();
  for (const manifest of manifests) for (const provided of manifest.provides) if (!providers.has(provided)) providers.set(provided, manifest.id);

  const nodes = manifests.map((manifest) => {
    const required = [];
    const optional = [];
    const missing = [];
    for (const requirement of [...manifest.requires, ...manifest.optional]) {
      const provider = providers.get(requirement.ref);
      if (!provider) { missing.push({ from: manifest.id, ref: requirement.ref, kind: requirement.kind, reason: requirement.reason }); continue; }
      (requirement.kind === "required" ? required : optional).push({ from: manifest.id, to: provider, ref: requirement.ref, kind: requirement.kind, reason: requirement.reason });
    }
    return { id: manifest.id, version: manifest.version, kind: manifest.kind, critical: manifest.critical, provides: [...manifest.provides].sort(), required, optional, missing };
  });

  const edges = nodes.flatMap((node) => [...node.required, ...node.optional]);
  const adjacency = new Map(nodes.map((node) => [node.id, [...node.required, ...node.optional].sort((a, b) => (a.to < b.to ? -1 : 1))]));

  // Cycle detection by DFS colouring, classifying a loop fatal only when every edge
  // on it is required (an optional edge can be declined, so the loop is survivable).
  const cycles = [];
  const signatures = new Set();
  const color = new Map(nodes.map((node) => [node.id, 0]));
  const visit = (root) => {
    const path = [];
    const refs = [];
    const index = new Map();
    const stack = [{ id: root, next: 0 }];
    color.set(root, 1); index.set(root, 0); path.push(root);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbours = adjacency.get(frame.id) ?? [];
      if (frame.next >= neighbours.length) { color.set(frame.id, 2); index.delete(frame.id); path.pop(); stack.pop(); continue; }
      const edge = neighbours[frame.next++];
      const target = color.get(edge.to);
      if (target === undefined) continue;
      if (target === 1) {
        const start = index.get(edge.to);
        if (start === undefined) continue;
        const cyclePath = path.slice(start);
        const cycleRefs = [...refs.slice(start), edge.ref];
        const pivot = cyclePath.indexOf([...cyclePath].sort()[0]);
        const rotated = [...cyclePath.slice(pivot), ...cyclePath.slice(0, pivot)];
        const rotatedRefs = [...cycleRefs.slice(pivot), ...cycleRefs.slice(0, pivot)];
        const signature = rotated.join(" -> ");
        if (signatures.has(signature)) continue;
        signatures.add(signature);
        const kinds = rotated.map((from, position) => {
          const to = rotated[(position + 1) % rotated.length];
          const match = (adjacency.get(from) ?? []).find((candidate) => candidate.to === to && candidate.ref === rotatedRefs[position]);
          return match ? match.kind : "optional";
        });
        cycles.push({ kind: kinds.every((kind) => kind === "required") ? "required" : "optional", path: rotated, refs: rotatedRefs });
        continue;
      }
      if (target === 0) {
        color.set(edge.to, 1); index.set(edge.to, path.length); refs.push(edge.ref); path.push(edge.to); stack.push({ id: edge.to, next: 0 });
      }
    }
  };
  for (const node of [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) if (color.get(node.id) === 0) visit(node.id);

  const fatalCycles = cycles.filter((cycle) => cycle.kind === "required");
  const indegree = new Map(nodes.map((node) => [node.id, node.required.length]));
  const dependents = new Map(nodes.map((node) => [node.id, []]));
  for (const node of nodes) for (const edge of node.required) dependents.get(edge.to).push(node.id);
  const bootOrder = [];
  const frontier = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id).sort();
  while (frontier.length > 0) {
    const id = frontier.shift();
    bootOrder.push(id);
    for (const dependent of [...dependents.get(id)].sort()) {
      const remaining = indegree.get(dependent) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) { let at = 0; while (at < frontier.length && frontier[at] < dependent) at++; frontier.splice(at, 0, dependent); }
    }
  }

  return {
    nodes,
    edges,
    providers: Object.fromEntries([...providers.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    cycles,
    fatalCycles,
    bootable: fatalCycles.length === 0 && !nodes.some((node) => node.missing.some((entry) => entry.kind === "required")),
    bootOrder,
    adjacency
  };
}

/** Transitive dependents of a capability, with the path that explains each. */
function impactRadius(graph, capabilityId) {
  const reverse = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) reverse.get(edge.to).push(edge);
  for (const list of reverse.values()) list.sort((a, b) => (a.from < b.from ? -1 : 1));
  const best = new Map();
  const queue = [{ id: capabilityId, via: [], required: true }];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of reverse.get(current.id) ?? []) {
      if (edge.from === capabilityId) continue;
      const candidate = { via: [...current.via, edge.to], required: current.required && edge.kind === "required" };
      const existing = best.get(edge.from);
      if (existing && (existing.via.length < candidate.via.length || (existing.via.length === candidate.via.length && existing.via.join(">") <= candidate.via.join(">")))) continue;
      best.set(edge.from, candidate);
      queue.push({ id: edge.from, via: candidate.via, required: candidate.required });
    }
  }
  return [...best.entries()].map(([capability, entry]) => ({ capability, via: entry.via, required: entry.required })).sort((a, b) => (a.capability < b.capability ? -1 : 1));
}

/** Namespace -> owner, plus the conflicts the registry exists to catch. */
function buildOwnership(manifests) {
  const byNamespace = new Map();
  for (const manifest of manifests) {
    for (const claim of manifest.state) {
      byNamespace.set(claim.namespace, [...(byNamespace.get(claim.namespace) ?? []), { owner: claim.owner, source: manifest.source }]);
    }
  }
  const namespaces = [];
  const conflicts = [];
  const ownerOf = {};
  const ownedBy = {};
  for (const namespace of [...byNamespace.keys()].sort()) {
    const declarations = byNamespace.get(namespace).slice().sort((a, b) => (a.owner < b.owner ? -1 : 1));
    const owners = [...new Set(declarations.map((entry) => entry.owner))].sort();
    if (owners.length > 1) { conflicts.push({ namespace, owners, declarations }); continue; }
    ownerOf[namespace] = owners[0];
    ownedBy[owners[0]] = [...(ownedBy[owners[0]] ?? []), namespace].sort();
    namespaces.push({ namespace, owner: owners[0], declaredBy: declarations });
  }
  return { namespaces, conflicts, ownerOf, ownedBy };
}

const IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

/** Resolve a relative specifier to a repo-relative POSIX path, or undefined. */
function resolveSpecifier(specifier, fromFile) {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(ROOT, path.dirname(fromFile), specifier);
  const withoutJs = base.endsWith(".js") ? base.slice(0, -3) : base;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${withoutJs}.ts`, `${withoutJs}.tsx`, path.join(base, "index.ts"), path.join(withoutJs, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.relative(ROOT, candidate).split(path.sep).join("/");
  }
  return undefined;
}

/** Every import edge between capability-owned modules. */
function collectImports(manifests) {
  const moduleOwners = {};
  const conflicts = [];
  const kinds = {};
  const surfaces = {};
  for (const manifest of manifests) {
    kinds[manifest.id] = manifest.kind;
    surfaces[manifest.id] = [...manifest.surface].sort();
    for (const module of manifest.modules) {
      if (moduleOwners[module] && moduleOwners[module] !== manifest.id) { conflicts.push({ module, capabilities: [moduleOwners[module], manifest.id].sort() }); continue; }
      moduleOwners[module] = manifest.id;
    }
  }
  const imports = [];
  for (const module of Object.keys(moduleOwners).sort()) {
    const absolute = path.join(ROOT, module);
    if (!fs.existsSync(absolute)) continue;
    const text = fs.readFileSync(absolute, "utf8");
    for (const specifier of new Set([...text.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4]).filter(Boolean))) {
      const target = resolveSpecifier(specifier, module);
      if (!target || !moduleOwners[target]) continue;
      imports.push({ from: module, to: target, fromCapability: moduleOwners[module], toCapability: moduleOwners[target] });
    }
  }
  return { moduleOwners, conflicts, kinds, surfaces, imports };
}

/**
 * The boot factory files the composition root actually calls.
 *
 * The identifier must be followed by `(` OR by a type-argument list and then `(`:
 * `createRuntimeModule<BrowserWindow>(` is a real call in `main.ts`, and a pattern
 * that only matched `name(` silently reported 23 wired modules where the book says
 * 24 — the kind of undercount that would let a whole module go unregistered.
 */
function wiredBootFactories() {
  const dir = path.join(ROOT, "electron", "bootstrap");
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.ts"), "utf8");
  const called = new Set([...main.matchAll(/\b(create[A-Za-z0-9]+)\s*(?:<[^>();]*>)?\s*\(/g)].map((match) => match[1]));
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && name !== "boot-module.ts")
    .map((name) => `electron/bootstrap/${name}`)
    .filter((file) => {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      return [...text.matchAll(/export function (create[A-Za-z0-9]+)\s*(?:<[^>();]*>)?\s*\(/g)].map((match) => match[1]).some((name) => called.has(name));
    })
    .sort();
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return undefined;
  try { return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")); } catch { return undefined; }
}

function main() {
  const command = (process.argv[2] ?? "graph").toLowerCase();
  const manifests = loadManifests();
  const graph = buildGraph(manifests);
  const ownership = buildOwnership(manifests);
  const scan = collectImports(manifests);
  const wired = wiredBootFactories();
  const registered = manifests.flatMap((manifest) => manifest.bootModules).sort();
  const mainSource = fs.readFileSync(path.join(ROOT, "electron", "main.ts"), "utf8");
  const literalIpc = [...mainSource.matchAll(/ipcMain\.handle\(\s*["'`]/g)].length;

  if (command === "graph") {
    console.log(JSON.stringify({
      capabilities: graph.nodes.length,
      edges: graph.edges.length,
      requiredEdges: graph.edges.filter((edge) => edge.kind === "required").length,
      cycles: graph.cycles.map((cycle) => ({ kind: cycle.kind, path: [...cycle.path, cycle.path[0]] })),
      bootable: graph.bootable,
      bootOrder: graph.bootOrder,
      kernel: graph.nodes.filter((node) => node.kind === "kernel").map((node) => node.id),
      features: graph.nodes.filter((node) => node.kind === "feature").map((node) => node.id),
      edges_detail: graph.edges.map((edge) => `${edge.from} -> ${edge.to} (${edge.ref}, ${edge.kind})`)
    }, null, 2));
    return 0;
  }

  if (command === "impact") {
    const selector = process.argv[3];
    if (!selector) { console.error("usage: architecture.cjs impact <capability-id|id@major>"); return 2; }
    const parsed = REF.exec(selector.trim());
    const id = graph.nodes.some((node) => node.id === selector.trim())
      ? selector.trim()
      : (parsed ? graph.providers[`${parsed[1]}@${parsed[2]}`] : undefined);
    if (!id) { console.log(JSON.stringify({ error: `unknown capability: ${selector}`, known: graph.nodes.map((node) => node.id) }, null, 2)); return 2; }
    const impact = impactRadius(graph, id);
    console.log(JSON.stringify({
      capability: id,
      impactRadius: impact.map((entry) => entry.capability),
      explains: impact.map((entry) => ({ capability: entry.capability, via: [...entry.via, id].reverse(), required: entry.required }))
    }, null, 2));
    return 0;
  }

  if (command === "ownership") {
    console.log(JSON.stringify({
      namespaces: ownership.namespaces.length,
      conflicts: ownership.conflicts,
      ownerOf: ownership.ownerOf,
      ownedBy: ownership.ownedBy
    }, null, 2));
    return ownership.conflicts.length === 0 ? 0 : 1;
  }

  if (command === "ratchet") {
    const baseline = loadBaseline();
    const violations = [];
    for (const cycle of graph.fatalCycles) violations.push({ ratchet: "required-dependency-cycles", detail: `cycle ${[...cycle.path, cycle.path[0]].join(" -> ")}` });
    for (const node of graph.nodes) for (const entry of node.missing) if (entry.kind === "required") violations.push({ ratchet: "unresolved-required-dependencies", detail: `${node.id} requires ${entry.ref}` });
    for (const conflict of ownership.conflicts) violations.push({ ratchet: "duplicate-state-owners", detail: `${conflict.namespace} owned by ${conflict.owners.join(", ")}` });
    for (const edge of scan.imports) {
      if (edge.fromCapability === edge.toCapability) continue;
      if (scan.kinds[edge.fromCapability] === "kernel" && scan.kinds[edge.toCapability] === "feature") {
        violations.push({ ratchet: "kernel-imports-feature", file: edge.from, detail: `${edge.from} -> ${edge.to}` });
        continue;
      }
      if (!(scan.surfaces[edge.toCapability] ?? []).includes(edge.to)) {
        violations.push({ ratchet: "feature-imports-undeclared-surface", file: edge.from, detail: `${edge.from} -> ${edge.to} (not on ${edge.toCapability}'s surface)` });
      }
    }
    const registeredSet = new Set(registered);
    for (const file of wired) if (!registeredSet.has(file)) violations.push({ ratchet: "unregistered-boot-module", file, detail: "wired but no manifest names it" });
    if (literalIpc > 0) violations.push({ ratchet: "literal-ipc-registration-in-main", detail: `${literalIpc} literal registration(s)` });
    for (const conflict of scan.conflicts) violations.push({ ratchet: "feature-imports-undeclared-surface", detail: `module ${conflict.module} claimed by ${conflict.capabilities.join(", ")}` });

    const metrics = {
      bootModuleCount: wired.length,
      capabilityCount: graph.nodes.length,
      dependencyEdgeCount: graph.edges.length,
      requiredEdgeCount: graph.edges.filter((edge) => edge.kind === "required").length,
      featureCapabilityCount: graph.nodes.filter((node) => node.kind === "feature").length,
      durableNamespaceCount: ownership.namespaces.length
    };
    const exceeded = [];
    if (baseline) {
      for (const [key, value] of Object.entries(metrics)) {
        const recorded = baseline.metrics?.[key];
        if (typeof recorded === "number" && value > recorded) exceeded.push({ metric: key, observed: value, baseline: recorded });
      }
    }
    for (const entry of exceeded) violations.push({ ratchet: `${entry.metric} density`, detail: `${entry.metric} is ${entry.observed}, above baseline ${entry.baseline}` });

    console.log(JSON.stringify({
      pass: violations.length === 0,
      metrics,
      baseline: baseline ? { updatedAt: baseline.updatedAt, reason: baseline.reason, metrics: baseline.metrics } : null,
      violations
    }, null, 2));
    return violations.length === 0 ? 0 : 1;
  }

  if (command === "snapshot") {
    const baseline = loadBaseline();
    const snapshot = {
      $comment: "Phase 01 architecture snapshot (platform foundation). Generated by `node scripts/architecture.cjs snapshot`; regenerated identically from the same sources.",
      generatedAt: new Date().toISOString(),
      baselineCommit: process.env.BOSS_BASELINE_SHA ?? null,
      capabilities: {
        count: graph.nodes.length,
        kernel: graph.nodes.filter((node) => node.kind === "kernel").map((node) => node.id),
        features: graph.nodes.filter((node) => node.kind === "feature").map((node) => node.id),
        critical: graph.nodes.filter((node) => node.critical).map((node) => node.id),
        manifests: manifests.map((manifest) => ({
          id: manifest.id, version: manifest.version, kind: manifest.kind, critical: manifest.critical,
          provides: manifest.provides, requires: manifest.requires.map((entry) => entry.ref),
          optional: manifest.optional.map((entry) => entry.ref), state: manifest.state.map((entry) => entry.namespace),
          bootModules: manifest.bootModules, source: manifest.source
        }))
      },
      dependencyGraph: {
        edgeCount: graph.edges.length,
        requiredEdges: graph.edges.filter((edge) => edge.kind === "required").length,
        optionalEdges: graph.edges.filter((edge) => edge.kind === "optional").length,
        cycles: graph.cycles.map((cycle) => ({ kind: cycle.kind, path: [...cycle.path, cycle.path[0]] })),
        requiredCycleCount: graph.fatalCycles.length,
        bootable: graph.bootable,
        bootOrder: graph.bootOrder,
        edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to, ref: edge.ref, kind: edge.kind }))
      },
      stateOwnership: {
        namespaces: ownership.namespaces.length,
        duplicateOwnerCount: ownership.conflicts.length,
        conflicts: ownership.conflicts,
        ownerOf: ownership.ownerOf
      },
      bootModules: {
        wiredCount: wired.length,
        registeredCount: registered.length,
        wired,
        unregistered: wired.filter((file) => !registered.includes(file)),
        registeredNotWired: registered.filter((file) => !wired.includes(file))
      },
      ratchet: {
        literalIpcRegistrationsInMain: literalIpc,
        crossCapabilityImports: scan.imports.filter((edge) => edge.fromCapability !== edge.toCapability).map((edge) => ({ from: edge.from, to: edge.to, declared: (scan.surfaces[edge.toCapability] ?? []).includes(edge.to) })),
        moduleOwnershipConflicts: scan.conflicts,
        baseline: baseline ?? null,
        metrics: {
          bootModuleCount: wired.length,
          capabilityCount: graph.nodes.length,
          dependencyEdgeCount: graph.edges.length,
          requiredEdgeCount: graph.edges.filter((edge) => edge.kind === "required").length,
          featureCapabilityCount: graph.nodes.filter((node) => node.kind === "feature").length,
          durableNamespaceCount: ownership.namespaces.length
        }
      }
    };
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ wrote: path.relative(ROOT, SNAPSHOT_FILE).split(path.sep).join("/"), capabilities: graph.nodes.length, edges: graph.edges.length, namespaces: ownership.namespaces.length }, null, 2));
    return 0;
  }

  console.error(`unknown command: ${command}\nusage: architecture.cjs [graph|impact <id>|ownership|ratchet|snapshot]`);
  return 2;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(String(error && error.message ? error.message : error));
  process.exitCode = 1;
}
