#!/usr/bin/env node
/**
 * Host-M P4 — unified read-only observer CLI.
 *
 *   node scripts/host-observe.cjs [options]
 *
 * Options
 *   --data-root PATH   Boss data root (default: <repo>/runtime-data, or --boss-data-dir=)
 *   --recent N         how many recent routing decisions/failures to carry (default 20)
 *   --json             print the snapshot JSON (default: a one-line summary)
 *   --out PATH         also write the snapshot to this file
 *
 * Guarantees, in the order they matter:
 *   - READ ONLY. The collector never calls a writer on any store; in particular
 *     it does not construct a StateStore (whose constructor persists a startup
 *     session) and does not call NodeCapabilityRegistry.refresh() (as the
 *     boss:node-status IPC handler does).
 *   - Isolated. One broken dimension degrades that dimension only.
 *   - Honest. A dimension whose store is absent is UNAVAILABLE, never a healthy
 *     empty one.
 *
 * Exit codes: 0 when a snapshot was produced (degraded dimensions are reported
 * inside it, not as a failure); 2 when the snapshot could not be produced at
 * all.
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function fail(message, code = 2) {
  console.error(`HOST_OBSERVE_ERROR ${message}`);
  process.exit(code);
}

function compiled(relative) {
  const file = path.join(repoRoot, "dist-electron", ...relative);
  if (!fs.existsSync(file)) fail(`missing ${path.relative(repoRoot, file)} — run: npx tsc -p tsconfig.electron.json`);
  return require(file);
}

function parseArgs(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    if (arg === "--data-root") options.dataRoot = path.resolve(next());
    else if (arg === "--recent") options.recent = Number(next());
    else if (arg === "--out") options.out = path.resolve(next());
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else fail(`unknown option ${arg}`);
  }
  return options;
}

function helpText() {
  const source = fs.readFileSync(__filename, "utf8");
  const block = source.slice(source.indexOf("/**") + 3, source.indexOf("*/"));
  return block.split("\n").map((line) => line.replace(/^\s*\* ?/, "")).join("\n");
}

function resolveDataRoot(explicit) {
  if (explicit) return explicit;
  const fromArgv = process.argv.find((arg) => arg.startsWith("--boss-data-dir="));
  if (fromArgv) return path.resolve(fromArgv.slice("--boss-data-dir=".length));
  // Matches electron/main.ts: the default data root is <appPath>/runtime-data.
  return path.join(repoRoot, "runtime-data");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return 0;
  }

  const { collectHostSnapshot } = compiled(["electron", "host", "host-observer-collector.js"]);
  const { projectHostObserver, summarizeHostSnapshot } = compiled(["src", "shared", "host-observer.js"]);

  const dataRoot = resolveDataRoot(options.dataRoot);
  if (!fs.existsSync(dataRoot)) {
    fail(`data root does not exist: ${dataRoot}`);
  }

  const raw = await collectHostSnapshot({ dataRoot });
  const snapshot = options.recent
    ? projectHostObserver(raw, { recentLimit: options.recent })
    : raw;

  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(snapshot, null, 2), "utf8");
  }

  if (options.json) console.log(JSON.stringify(snapshot, null, 2));
  else {
    console.log(`HOST_OBSERVE_READ_ONLY ${snapshot.generatedAt} root=${dataRoot}`);
    console.log(summarizeHostSnapshot(snapshot));
    for (const dimension of snapshot.dimensions) {
      const detail = dimension.reason ? ` — ${dimension.reason}` : "";
      console.log(`  ${dimension.status.padEnd(11)} ${dimension.dimension.padEnd(10)} ${dimension.records} record(s)${detail}`);
    }
    if (options.out) console.log(`snapshot: ${path.relative(repoRoot, options.out)}`);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("HOST_OBSERVE_ERROR " + (error && error.stack ? error.stack : String(error)));
    process.exit(2);
  });
