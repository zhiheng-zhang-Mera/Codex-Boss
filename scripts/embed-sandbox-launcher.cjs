#!/usr/bin/env node
/**
 * Embed `launcher.cs` as its own source-of-truth module.
 *
 * ## The drift this removes
 *
 * The C# launcher existed twice: as `windows-appcontainer/launcher.cs`, and as the string literal
 * `SANDBOX_LAUNCHER_SOURCE` in `launcher-source.ts` that is what actually gets compiled. They had diverged
 * — 791 lines against 796, with the repository copy carrying a `job` directive the compiled launcher
 * rejected at run time with `unknown directive: job`. Nothing detected it, so the file a reader would edit
 * was not the file that ran.
 *
 * ## The single source of truth
 *
 * `launcher.cs` is canonical. This generator converts it to LF (so the embedded literal is byte-identical
 * on every platform, whatever `core.autocrlf` did to the working copy) and writes
 * `launcher-source.ts` from it. `--check` re-derives and fails when the two disagree, so a hand-edit of
 * either one cannot survive.
 *
 * Run: node scripts/embed-sandbox-launcher.cjs [--check]
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "electron", "self-evolution", "sandbox", "windows-appcontainer", "launcher.cs");
const OUT = path.join(ROOT, "electron", "self-evolution", "sandbox", "windows-appcontainer", "launcher-source.ts");

/** Canonical line endings: the embedded literal is compared byte-for-byte across platforms. */
function canonical(text) {
  return text.split("\r\n").join("\n");
}

function render(source) {
  return `/**
 * GENERATED — do not edit by hand.
 *
 * Source of truth: \`electron/self-evolution/sandbox/windows-appcontainer/launcher.cs\`.
 * Regenerate with \`node scripts/embed-sandbox-launcher.cjs\`; \`--check\` fails when this file and the
 * C# source disagree, so the compiled launcher can no longer drift from the file a reader edits.
 *
 * Line endings are normalized to LF so the literal is byte-identical on every platform.
 */

/** SHA-256 of the canonical (LF) launcher source, for build/CI identity checks. */
const SANDBOX_LAUNCHER_SOURCE_SHA256 = ${JSON.stringify(crypto.createHash("sha256").update(source).digest("hex"))};

/** The C# source of the host-owned sandbox launcher, compiled at probe time by \`csc\`. */
export const SANDBOX_LAUNCHER_SOURCE = ${JSON.stringify(source)};
`;
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    process.stderr.write(`launcher source is missing: ${SOURCE}\n`);
    process.exitCode = 1;
    return;
  }
  const source = canonical(fs.readFileSync(SOURCE, "utf8"));
  const serialised = render(source);
  const check = process.argv.includes("--check");

  if (check) {
    if (!fs.existsSync(OUT)) {
      process.stderr.write("launcher-source.ts is missing; run `node scripts/embed-sandbox-launcher.cjs`\n");
      process.exitCode = 1;
      return;
    }
    if (fs.readFileSync(OUT, "utf8") !== serialised) {
      process.stderr.write(
        "the embedded sandbox launcher has drifted from launcher.cs; run `node scripts/embed-sandbox-launcher.cjs`\n"
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`sandbox launcher embedding is current: ${source.length} chars\n`);
    return;
  }

  fs.writeFileSync(OUT, serialised, "utf8");
  process.stdout.write(`wrote ${path.relative(ROOT, OUT).split(path.sep).join("/")}\n`);
  process.stdout.write(`  ${source.length} chars, sha256 ${crypto.createHash("sha256").update(source).digest("hex").slice(0, 16)}…\n`);
}

main();
