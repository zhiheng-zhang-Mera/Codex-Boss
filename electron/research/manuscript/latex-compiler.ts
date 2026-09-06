/**
 * LaTeX compiler (plan 9-7 §31). Compiles a manuscript's paper.tex into
 * paper.pdf using the first available TeX engine (pdflatex → xelatex →
 * lualatex → tectonic), runs the engine twice so references resolve, and
 * writes a durable compile audit. Never claims success without a real PDF:
 * engine missing or compile failure ⇒ status FAIL + the .tex stays for fixes.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";

export interface LatexCompileAudit {
  status: "PASS" | "FAIL";
  engine: string | null;
  tex: string;
  pdf: string | null;
  logTail: string;
  compiledAt: string;
}

export interface LatexCompilerOptions {
  /** Explicit engine override (basename or path). Auto-detected when absent. */
  engine?: string;
  /** Run count (references need two passes); default 2. */
  passes?: number;
  /** Injectable engine detector (tests). Default probes PATH. */
  resolveEngine?: () => string | null;
  /** Injectable engine runner (tests). Default execFile. */
  run?: (engine: string, args: string[], cwd: string) => Promise<{ code: number; output: string }>;
}

const ENGINE_CANDIDATES = ["pdflatex", "xelatex", "lualatex", "tectonic"];

function defaultResolveEngine(): string | null {
  for (const candidate of ENGINE_CANDIDATES) {
    try {
      execFileSync(candidate, ["--version"], { timeout: 10000, windowsHide: true, stdio: "ignore" });
      return candidate;
    } catch {
      // try next engine
    }
  }
  return null;
}

function defaultRun(engine: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(engine, args, { cwd, timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, _stdout, stderr) => {
      resolve({ code: error ? (error as { code?: number }).code ?? 1 : 0, output: String(stderr || error || "") });
    });
  });
}

export class LatexCompiler {
  private readonly passes: number;
  private readonly resolveEngineFn: () => string | null;
  private readonly runFn: (engine: string, args: string[], cwd: string) => Promise<{ code: number; output: string }>;

  constructor(private readonly options: LatexCompilerOptions = {}) {
    this.passes = options.passes ?? 2;
    this.resolveEngineFn = options.resolveEngine ?? (options.engine ? () => options.engine ?? null : defaultResolveEngine);
    this.runFn = options.run ?? defaultRun;
  }

  /** Compiles paper.tex in `manuscriptDir`; writes audit/compile.json. */
  async compile(manuscriptDir: string): Promise<LatexCompileAudit> {
    const tex = path.join(manuscriptDir, "paper.tex");
    const pdf = path.join(manuscriptDir, "paper.pdf");
    if (!fs.existsSync(tex)) throw new Error(`paper.tex not found: ${tex}`);
    const engine = this.resolveEngineFn();
    const compiledAt = new Date().toISOString();
    if (!engine) {
      const audit: LatexCompileAudit = { status: "FAIL", engine: null, tex, pdf: null, logTail: "no TeX engine found (pdflatex/xelatex/lualatex/tectonic); .tex preserved for later compile", compiledAt };
      this.writeAudit(manuscriptDir, audit);
      return audit;
    }
    const logs: string[] = [];
    for (let pass = 0; pass < this.passes; pass += 1) {
      const result = await this.runFn(engine, ["-interaction=nonstopmode", "-halt-on-error", "paper.tex"], manuscriptDir);
      logs.push(`pass ${pass + 1}: ${result.output.slice(-3000)}`);
      if (result.code !== 0) {
        const audit: LatexCompileAudit = { status: "FAIL", engine, tex, pdf: null, logTail: logs.join("\n").slice(-4000), compiledAt };
        this.writeAudit(manuscriptDir, audit);
        return audit;
      }
    }
    const pdfExists = fs.existsSync(pdf) && fs.statSync(pdf).size > 0;
    const audit: LatexCompileAudit = pdfExists
      ? { status: "PASS", engine, tex, pdf, logTail: `engine ${engine} produced paper.pdf after ${this.passes} passes`, compiledAt }
      : { status: "FAIL", engine, tex, pdf: null, logTail: `${engine} exited cleanly but no paper.pdf appeared; .tex preserved`, compiledAt };
    this.writeAudit(manuscriptDir, audit);
    return audit;
  }

  private writeAudit(manuscriptDir: string, audit: LatexCompileAudit): void {
    const auditDir = path.join(path.dirname(manuscriptDir), "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(path.join(auditDir, "compile.json"), JSON.stringify(audit, null, 2), "utf8");
  }
}
