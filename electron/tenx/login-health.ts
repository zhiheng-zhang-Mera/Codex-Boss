import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../commander/durable-json";
import { isHumanGated, type LoginHealthReport } from "../../src/shared/tenx/session";

/**
 * 10O: login status scanner (forward, durable).
 *
 * Reports per provider/account: sessionPresent / authenticated / requiresLogin /
 * requiresMFA / requiresCaptcha / expired / unknown. Observations only — a
 * session is 'authenticated' only when actually observed. MFA / CAPTCHA /
 * human-verification states become human-gated reports; Boss never tries to
 * bypass them and never crashes. Scanner probes are injectable (deterministic
 * tests, live adapters later).
 */

export interface TenxLoginHealthFile {
  schemaVersion: 1;
  reports: LoginHealthReport[];
}

export interface LoginProbe {
  provider: string;
  account?: string;
  /** Observable result from the probe adapter. */
  result: {
    sessionPresent?: boolean;
    authenticated?: boolean;
    requiresLogin?: boolean;
    requiresMFA?: boolean;
    requiresCaptcha?: boolean;
    expired?: boolean;
    unknown?: boolean;
  };
}

export type LoginProbeFn = (provider: string, account?: string) => Promise<LoginProbe["result"]>;

export class TenxLoginHealthScanner {
  private readonly reports = new Map<string, LoginHealthReport>();

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly probe?: LoginProbeFn
  ) {
    this.restore();
  }

  /** Scan one provider/account. A throwing probe is isolated to an explicit unknown report. */
  async scan(provider: string, account?: string): Promise<LoginHealthReport> {
    let result: LoginProbe["result"] = {};
    try {
      result = this.probe ? await this.probe(provider, account) : { unknown: true };
    } catch (error) {
      result = { unknown: true };
      void error;
    }
    const report = this.toReport(provider, account, result);
    this.reports.set(key(provider, account), report);
    this.persist();
    return structuredClone(report);
  }

  /** Apply an externally-produced observation without a probe call. */
  observe(provider: string, account: string | undefined, result: LoginProbe["result"]): LoginHealthReport {
    const report = this.toReport(provider, account, result);
    this.reports.set(key(provider, account), report);
    this.persist();
    return structuredClone(report);
  }

  status(provider: string, account?: string): LoginHealthReport | undefined {
    const report = this.reports.get(key(provider, account));
    return report ? structuredClone(report) : undefined;
  }

  /** Providers currently gated behind human action (MFA/CAPTCHA/login) — never automated around. */
  humanGated(): LoginHealthReport[] {
    return [...this.reports.values()].filter((report) => isHumanGated(report)).map((report) => structuredClone(report));
  }

  list(): LoginHealthReport[] {
    return [...this.reports.values()].map((report) => structuredClone(report)).sort((a, b) => a.provider.localeCompare(b.provider));
  }

  private toReport(provider: string, account: string | undefined, result: LoginProbe["result"]): LoginHealthReport {
    const authenticated = result.authenticated ?? false;
    const requiresMFA = result.requiresMFA ?? false;
    const requiresCaptcha = result.requiresCaptcha ?? false;
    const requiresLogin = result.requiresLogin ?? false;
    const expired = result.expired ?? false;
    const unknown = result.unknown ?? (!authenticated && !requiresMFA && !requiresCaptcha && !requiresLogin && !expired && !(result.sessionPresent ?? false));
    const report: LoginHealthReport = {
      provider,
      account,
      sessionPresent: result.sessionPresent ?? false,
      authenticated,
      requiresLogin,
      requiresMFA,
      requiresCaptcha,
      expired,
      unknown,
      humanGated: isHumanGated({ provider, account, sessionPresent: result.sessionPresent ?? false, authenticated, requiresLogin, requiresMFA, requiresCaptcha, expired, unknown, humanGated: false, scannedAt: "" }),
      scannedAt: this.now()
    };
    return report;
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxLoginHealthFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.reports)) throw new Error("Invalid tenx login health store");
    for (const report of parsed.reports) {
      if (!report || typeof report.provider !== "string") throw new Error("Invalid tenx login health report");
      this.reports.set(key(report.provider, report.account), report);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxLoginHealthFile = { schemaVersion: 1, reports: [...this.reports.values()] };
    writeJson(this.filePath, file);
  }
}

function key(provider: string, account?: string): string {
  return account ? `${provider}::${account}` : provider;
}
