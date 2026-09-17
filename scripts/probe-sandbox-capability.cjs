// Re-check PF-DEBT-003 with the backend's own probe, so the reason is the platform's words rather than a
// guess. Prints only the capability record; no secret is read or written.
const path = require("node:path");
const fs = require("node:fs");

const COMPILED = path.join(__dirname, "..", "dist-electron", "electron", "self-evolution", "sandbox");
const candidates = ["windows-appcontainer-backend.js", "sandbox-backend.js"];
for (const name of candidates) {
  const file = path.join(COMPILED, name);
  process.stdout.write(`${name}: ${fs.existsSync(file) ? "present" : "absent"}\n`);
}

const mod = require(path.join(COMPILED, "windows-appcontainer-backend.js"));
process.stdout.write(`exports: ${Object.keys(mod).join(", ")}\n`);

(async () => {
  const exported = Object.entries(mod).find(([, value]) => typeof value === "function" && /Sandbox/i.test(value.name ?? ""));
  if (!exported) {
    process.stdout.write("no sandbox class export found\n");
    return;
  }
  const [name, Ctor] = exported;
  process.stdout.write(`probing via ${name}\n`);
  const backend = new Ctor({ containerName: "CodexBossPhase08Probe" });
  const capability = await backend.probe();
  process.stdout.write(`${JSON.stringify(capability, null, 2)}\n`);
})().catch((error) => {
  process.stdout.write(`probe threw: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
