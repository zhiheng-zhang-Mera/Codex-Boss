import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { resolveVSCodeCli } from "../electron/computer/backends/vscode-cli";
it("resolves stable and versioned install layouts without executing launcher text", () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"boss-vscode-"));
 try {
  const exe=path.join(root,"Code.exe"), cli=path.join(root,"08d4889f9e","resources","app","out","cli.js");
  fs.mkdirSync(path.dirname(cli),{recursive:true});fs.writeFileSync(cli,"fixture");
  fs.mkdirSync(path.join(root,"bin"));fs.writeFileSync(path.join(root,"bin","code.cmd"),String.raw`"%~dp0..\Code.exe" "%~dp0..\08d4889f9e\resources\app\out\cli.js" %*`);
  expect(resolveVSCodeCli(exe)).toBe(cli);
  fs.writeFileSync(path.join(root,"bin","code.cmd"),String.raw`"%~dp0..\..\outside\resources\app\out\cli.js"`);
  expect(resolveVSCodeCli(exe)).toBeUndefined();
  const stable=path.join(root,"resources","app","out","cli.js");fs.mkdirSync(path.dirname(stable),{recursive:true});fs.writeFileSync(stable,"fixture");
  expect(resolveVSCodeCli(exe)).toBe(stable);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
