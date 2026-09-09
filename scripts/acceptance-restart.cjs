const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const project = path.resolve(__dirname, "..");
const root = path.join(project, "artifacts", "restart-" + randomUUID());
fs.mkdirSync(root, { recursive: true });
const env = { ...process.env, TEMP: path.join(root, "tmp"), TMP: path.join(root, "tmp") };
delete env.ELECTRON_RUN_AS_NODE; fs.mkdirSync(env.TEMP);
function phase(name) {
 return new Promise((resolve, reject) => {
  const out = fs.openSync(path.join(root, name + ".stdout.log"), "w"); const err = fs.openSync(path.join(root, name + ".stderr.log"), "w");
  const child = spawn(path.join(project, "node_modules", "electron", "dist", "electron.exe"), [project, "--codex-boss-smoke-test", "--boss-restart-" + name, "--boss-data-dir=" + root], { cwd: project, env, windowsHide: true, stdio: ["ignore", out, err] });
  const timer = setTimeout(() => { child.kill(); reject(new Error(name + " timed out")); }, 30000);
  child.once("error", reject);
  child.once("close", code => { clearTimeout(timer); fs.closeSync(out); fs.closeSync(err); code === 0 ? resolve() : reject(new Error(name + " exited " + code)); });
 });
}
(async () => {
 await phase("seed");
 const seed = JSON.parse(fs.readFileSync(path.join(root, "restart-seeded.json"), "utf8"));
 await phase("verify");
 const result = JSON.parse(fs.readFileSync(path.join(root, "restart-result.json"), "utf8"));
 if (seed.pid === result.pid || result.status !== "PASS") throw Error("Separate restart process not verified");
 console.log(JSON.stringify({ root, seed, result }, null, 2));
})().catch(error => { console.error(root, error); process.exitCode = 1; });
