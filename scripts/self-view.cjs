#!/usr/bin/env node
/**
 * Self Cognition — the self view, as a runnable answer.
 *
 * This CLI only reports. It reads the repository's own facts through the compiled modules, builds
 * the self model and prints the answer to one question. It writes nothing except the JSON file a
 * caller explicitly asks for with `--out`, and it has no flag that changes anything.
 *
 *   node scripts/self-view.cjs                      the whole self description
 *   node scripts/self-view.cjs --component <id>     one component
 *   node scripts/self-view.cjs --capability <id>    one capability
 *   node scripts/self-view.cjs --path <from> <to>   the dependency path between two components
 *   node scripts/self-view.cjs --affected <id>      what a component's failure touches
 *   node scripts/self-view.cjs --authority <id>     who may change it
 *   node scripts/self-view.cjs --json --out <file>  the raw model beside the reading
 *
 * Run `pnpm run build:electron` first: the CLI loads the compiled modules.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function load(relative) {
  const file = path.join(ROOT, "dist-electron", ...relative.split("/"));
  if (!fs.existsSync(file)) {
    process.stderr.write(`the compiled self-cognition modules are missing at ${path.relative(ROOT, file)}; run \`pnpm run build:electron\` first\n`);
    process.exitCode = 1;
    return undefined;
  }
  return require(file);
}

function parseArgs(argv) {
  const options = { command: "describe", target: undefined, to: undefined, json: false, out: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--component") { options.command = "component"; options.target = argv[++index]; }
    else if (argument === "--capability") { options.command = "capability"; options.target = argv[++index]; }
    else if (argument === "--affected") { options.command = "affected"; options.target = argv[++index]; }
    else if (argument === "--authority") { options.command = "authority"; options.target = argv[++index]; }
    else if (argument === "--path") { options.command = "path"; options.target = argv[++index]; options.to = argv[++index]; }
    else if (argument === "--root") options.root = path.resolve(argv[++index] ?? "");
    else if (argument === "--json") options.json = true;
    else if (argument === "--out") options.out = path.resolve(argv[++index] ?? "");
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write("usage: node scripts/self-view.cjs [--component <id>|--capability <id>|--path <from> <to>|--affected <id>|--authority <id>] [--root <dir>] [--json] [--out <file>]\n");
      process.exit(0);
    } else {
      process.stderr.write(`unknown argument ${argument}\n`);
      process.exitCode = 1;
      return undefined;
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options) {
  const factsModule = load("electron/self-cognition/facts.js");
  const anatomyModule = load("src/shared/self-cognition/anatomy.js");
  const describeModule = load("src/shared/self-cognition/describe.js");
  if (factsModule && anatomyModule && describeModule) {
    const facts = factsModule.collectSelfFacts({ repositoryRoot: options.root ?? ROOT });
    const model = anatomyModule.buildSelfModel(facts);
    const answer = (() => {
      switch (options.command) {
        case "component": return describeModule.describeComponent(model, options.target ?? "");
        case "capability": return describeModule.describeCapability(model, options.target ?? "");
        case "affected": return describeModule.affectedBy(model, options.target ?? "");
        case "authority": return describeModule.authorityOf(model, options.target ?? "");
        case "path": return describeModule.dependencyPath(model, options.target ?? "", options.to ?? "");
        default: return describeModule.describeSelf(model);
      }
    })();

    const reading = options.json
      ? { selfModel: model, answer }
      : answer;
    const text = `${JSON.stringify(reading, null, 2)}\n`;
    process.stdout.write(text);
    if (options.out) {
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.writeFileSync(options.out, text, "utf8");
    }
    // A refused question is a non-zero exit, so a script cannot mistake "not found" for an answer.
    if (!options.json && answer && typeof answer === "object" && typeof answer.status === "string" && answer.status !== "AVAILABLE") {
      process.stderr.write(`${answer.status}: ${answer.reason}\n`);
      process.exitCode = 2;
    }
  }
}
