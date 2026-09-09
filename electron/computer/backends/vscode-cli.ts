import fs from "node:fs";
import path from "node:path";
export function resolveVSCodeCli(executable: string): string | undefined {
 const directory = path.dirname(executable);
 const stable = path.join(directory, "resources", "app", "out", "cli.js");
 if (fs.existsSync(stable)) return stable;
 const launcher = path.join(directory, "bin", "code.cmd");
 if (!fs.existsSync(launcher) || fs.statSync(launcher).size > 10000) return undefined;
 const relative = /"%~dp0\.\.\\([a-f0-9]{6,64}\\resources\\app\\out\\cli\.js)"/i.exec(fs.readFileSync(launcher, "utf8"))?.[1];
 if (!relative) return undefined;
 const cli = path.resolve(directory, relative);
 return fs.existsSync(cli) ? cli : undefined;
}
