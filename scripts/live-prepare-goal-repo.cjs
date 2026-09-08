const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(".live-acceptance", "goal-repo");
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.dirname(root), { recursive: true });
execFileSync("git", ["clone", "--quiet", "--local", process.cwd(), root], { stdio: "ignore", windowsHide: true });
const storeDir = "D:\\.pnpm-store";
const install = fs.existsSync(storeDir)
  ? `corepack pnpm install --offline --ignore-scripts "--store-dir=${storeDir}"`
  : "corepack pnpm install --ignore-scripts";
execFileSync("powershell", ["-NoProfile", "-Command", install], { cwd: root, stdio: "ignore" });
const seed = path.join(root, "src", "shared", "__seeded_live.ts");
fs.writeFileSync(seed, "export const seededLiveCount: number = \"not-a-number\";\n", "utf8");
console.log("GOAL_REPO_READY " + root);
