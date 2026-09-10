import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SENTINEL_DIMENSIONS,
  buildSentinelReport,
  compareAcceptance,
  compareBenchmarks,
  compareBuildSize,
  compareDependencies,
  compareFileFormats,
  compareInterfaces,
  compareProviderSuccess,
  compareSchemas,
  compareSnapshots,
  compareTests,
  emptySentinelSnapshot,
  missingDimensions,
  renderSentinelReport,
  summarizeFindings,
  type AcceptanceSlice,
  type SentinelSnapshot
} from "../../src/shared/regression-sentinel";
import {
  captureAcceptance,
  captureBenchmarks,
  captureBuildOutput,
  captureDependencies,
  captureFileSurface,
  captureInterfaces,
  captureProviderSuccess,
  captureSnapshot,
  normalizeSignature,
  readSnapshot,
  tryReadSnapshot,
  writeSnapshot
} from "../../electron/host/sentinel-capture";

const AT = "2026-09-10T00:00:00.000Z";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-sentinel-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function acceptance(overrides: Partial<AcceptanceSlice> = {}): AcceptanceSlice {
  return {
    overall: "PASS",
    digest: "aaaa1111",
    summary: { pass: 5, fail: 0, blockedExternal: 0, degraded: 0, skipped: 0, total: 5 },
    checks: [
      { id: "gate:typecheck", program: "build", status: "PASS" },
      { id: "gate:test-suite", program: "build", status: "PASS" }
    ],
    ...overrides
  };
}

/**
 * A candidate derived from the baseline: the digest moves whenever a check moves,
 * so the comparison sees a coherent record rather than a hand-written one.
 */
function acceptanceWithChecks(checks: AcceptanceSlice["checks"], overall = "PASS"): AcceptanceSlice {
  return acceptance({ overall, checks, digest: `digest-${checks.map((check) => `${check.id}=${check.status}`).join("|")}` });
}

function snapshot(overrides: Partial<SentinelSnapshot> = {}): SentinelSnapshot {
  return {
    ...emptySentinelSnapshot({ revision: "rev-b", branch: "9-10-M", capturedAt: AT }),
    ...overrides
  };
}

function write(relative: string, content: string): string {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return file;
}

describe("regression sentinel contract (P6)", () => {
  it("declares the dimensions the plan names", () => {
    expect([...SENTINEL_DIMENSIONS]).toEqual([
      "acceptance",
      "tests",
      "interfaces",
      "schemas",
      "benchmark",
      "provider-success",
      "file-formats",
      "dependencies",
      "build-size"
    ]);
  });

  it("treats a failing acceptance check as a regression and a vanished check as lost coverage", () => {
    const before = acceptance();
    // The candidate still runs gate:typecheck but it now fails, and it dropped
    // gate:test-suite entirely.
    const worse = acceptanceWithChecks([{ id: "gate:typecheck", program: "build", status: "FAIL" }], "FAIL");
    const findings = compareAcceptance(before, worse);

    const failed = findings.find((entry) => entry.key === "gate:typecheck")!;
    expect(failed.severity).toBe("REGRESSION");
    expect(failed.detail).toBe("PASS → FAIL");

    const vanished = findings.find((entry) => entry.key === "gate:test-suite")!;
    expect(vanished.severity).toBe("REGRESSION");
    expect(vanished.detail).toContain("did not run it");

    expect(findings.find((entry) => entry.key === "overall")!.severity).toBe("REGRESSION");
    expect(findings.find((entry) => entry.key === "digest")!.severity).toBe("DRIFT");
  });

  it("reports a check that improved as an improvement", () => {
    const before = acceptance({ checks: [{ id: "x", program: "host", status: "FAIL" }], overall: "FAIL" });
    const after = acceptance({ checks: [{ id: "x", program: "host", status: "PASS" }], overall: "PASS" });
    expect(compareAcceptance(before, after).find((entry) => entry.key === "x")!.severity).toBe("IMPROVEMENT");
  });

  it("reports a missing acceptance record as UNAVAILABLE, never as stability", () => {
    expect(compareAcceptance(undefined, acceptance())[0].severity).toBe("UNAVAILABLE");
    expect(compareAcceptance(acceptance(), undefined)[0].severity).toBe("UNAVAILABLE");
  });

  it("treats removed tests as a regression and added tests as informational", () => {
    const removed = compareTests({ files: 10, tests: 100, failed: 0 }, { files: 10, tests: 90, failed: 0 });
    expect(removed.find((entry) => entry.key === "tests")!.severity).toBe("REGRESSION");
    const added = compareTests({ files: 10, tests: 100, failed: 0 }, { files: 10, tests: 120, failed: 0 });
    expect(added.find((entry) => entry.key === "tests")!.severity).toBe("INFO");
    const failed = compareTests({ files: 10, tests: 100, failed: 0 }, { files: 10, tests: 100, failed: 2 });
    expect(failed.find((entry) => entry.key === "failed")!.severity).toBe("REGRESSION");
    const fewerFiles = compareTests({ files: 10, tests: 100, failed: 0 }, { files: 8, tests: 100, failed: 0 });
    expect(fewerFiles.find((entry) => entry.key === "files")!.severity).toBe("DRIFT");
  });

  it("does not invent a missing measurement when an optional sub-field is absent", () => {
    // Regression guard: per-suite counts are optional, and their absence used to
    // be reported as "the baseline has no measurement for this dimension".
    const findings = compareTests({ files: 1, tests: 1, failed: 0 }, { files: 1, tests: 1, failed: 0 });
    expect(findings).toEqual([]);
  });

  it("compares per-suite counts when both sides have them", () => {
    const findings = compareTests(
      { files: 2, tests: 10, failed: 0, suites: { a: 5, b: 5 } },
      { files: 2, tests: 10, failed: 0, suites: { a: 5, b: 3 } }
    );
    expect(findings.find((entry) => entry.key === "b")!.severity).toBe("REGRESSION");
  });

  it("treats a removed or reshaped export as drift and an added one as informational", () => {
    const before = {
      "function:route": { symbol: "function:route", kind: "function" as const, signature: "(request: X): Y" }
    };
    const removed = compareInterfaces(before, {});
    expect(removed[0].severity).toBe("DRIFT");
    expect(removed[0].detail).toContain("removed");

    const reshaped = compareInterfaces(before, {
      "function:route": { symbol: "function:route", kind: "function", signature: "(request: X, at: string): Y" }
    });
    expect(reshaped[0].severity).toBe("DRIFT");
    expect(reshaped[0].detail).toContain("signature changed");

    const unchanged = compareInterfaces(before, before);
    expect(unchanged).toEqual([]);

    const added = compareInterfaces({}, before);
    expect(added[0].severity).toBe("INFO");
  });

  it("reports a removed declared type as schema drift", () => {
    const findings = compareSchemas({ "a.ts": ["Foo", "Bar"] }, { "a.ts": ["Foo"] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("DRIFT");
    expect(findings[0].key).toContain("Bar");
  });

  it("respects each benchmark metric's own direction", () => {
    const before = { latency: { value: 100, unit: "ms", higherIsBetter: false }, throughput: { value: 10, unit: "ops", higherIsBetter: true } };
    const after = { latency: { value: 150, unit: "ms", higherIsBetter: false }, throughput: { value: 20, unit: "ops", higherIsBetter: true } };
    const findings = compareBenchmarks(before, after);
    expect(findings.find((entry) => entry.key === "latency")!.severity).toBe("REGRESSION");
    expect(findings.find((entry) => entry.key === "throughput")!.severity).toBe("IMPROVEMENT");
  });

  it("reports a provider success drop beyond tolerance as a regression and a small change as nothing", () => {
    expect(compareProviderSuccess({ "web:a": 0.9 }, { "web:a": 0.6 }).filter((entry) => entry.severity !== "INFO")).toHaveLength(1);
    expect(compareProviderSuccess({ "web:a": 0.9 }, { "web:a": 0.6 })[0].severity).toBe("REGRESSION");
    // Within tolerance: quiet.
    expect(compareProviderSuccess({ "web:a": 0.9 }, { "web:a": 0.895 })).toEqual([]);
  });

  it("reports an unexpected file-format change as drift", () => {
    const disappeared = compareFileFormats({ ".js": 10, ".css": 2 }, { ".js": 10 });
    expect(disappeared.find((entry) => entry.key === ".css")!.severity).toBe("DRIFT");
    const appeared = compareFileFormats({ ".js": 10 }, { ".js": 10, ".wasm": 1 });
    expect(appeared[0].severity).toBe("DRIFT");
    const halved = compareFileFormats({ ".js": 10 }, { ".js": 3 });
    expect(halved[0].severity).toBe("DRIFT");
  });

  it("reports a major dependency change as drift and a patch change as informational", () => {
    expect(compareDependencies({ react: "18.2.0" }, { react: "19.0.0" })[0].severity).toBe("DRIFT");
    expect(compareDependencies({ react: "18.2.0" }, { react: "18.3.1" })[0].severity).toBe("INFO");
    expect(compareDependencies({ react: "18.2.0" }, {})[0].severity).toBe("DRIFT");
  });

  it("reports an abnormal build-size change as drift", () => {
    expect(compareBuildSize({ dist: 1_000_000 }, { dist: 1_500_000 })[0].severity).toBe("DRIFT");
    expect(compareBuildSize({ dist: 1_000_000 }, { dist: 1_010_000 })).toEqual([]);
    expect(compareBuildSize({ dist: 1_000_000 }, { dist: 800_000 })[0].severity).toBe("IMPROVEMENT");
  });

  it("reports a dimension that only one side measured as UNAVAILABLE", () => {
    const findings = compareSnapshots(snapshot({ tests: { files: 1, tests: 1, failed: 0 } }), snapshot());
    expect(findings.some((entry) => entry.severity === "UNAVAILABLE" && entry.dimension === "tests")).toBe(true);
  });

  it("lists every dimension a snapshot could not measure", () => {
    expect(missingDimensions(snapshot())).toEqual([...SENTINEL_DIMENSIONS]);
    const full = snapshot({
      acceptance: acceptance(),
      tests: { files: 1, tests: 1, failed: 0 },
      interfaces: {},
      schemas: {},
      benchmarks: {},
      providerSuccess: {},
      fileFormats: {},
      dependencies: {},
      buildSize: {}
    });
    expect(missingDimensions(full)).toEqual([]);
  });

  it("fails on a regression but only reports drift", () => {
    const regression = buildSentinelReport({
      baseline: snapshot(),
      candidate: snapshot({ revision: "rev-c" }),
      findings: [{ dimension: "tests", severity: "REGRESSION", key: "tests", detail: "100 → 90" }],
      generatedAt: AT
    });
    expect(regression.overall).toBe("FAIL");
    expect(regression.policy).toBe("REPORT_ONLY");

    const drift = buildSentinelReport({
      baseline: snapshot(),
      candidate: snapshot({ revision: "rev-c" }),
      findings: [{ dimension: "interfaces", severity: "DRIFT", key: "function:route", detail: "signature changed" }],
      generatedAt: AT
    });
    expect(drift.overall).toBe("DRIFT");

    const clean = buildSentinelReport({ baseline: snapshot(), candidate: snapshot(), findings: [], generatedAt: AT });
    expect(clean.overall).toBe("PASS");
  });

  it("summarizes every severity exactly once", () => {
    const summary = summarizeFindings([
      { dimension: "tests", severity: "REGRESSION", key: "a", detail: "" },
      { dimension: "tests", severity: "DRIFT", key: "b", detail: "" },
      { dimension: "tests", severity: "IMPROVEMENT", key: "c", detail: "" },
      { dimension: "tests", severity: "INFO", key: "d", detail: "" },
      { dimension: "tests", severity: "UNAVAILABLE", key: "e", detail: "" }
    ]);
    expect(summary).toEqual({ regressions: 1, drift: 1, improvements: 1, info: 1, unavailable: 1, total: 5 });
  });

  it("renders the verdict and every non-informational finding, and states its policy", () => {
    const report = buildSentinelReport({
      baseline: snapshot(),
      candidate: snapshot({ revision: "rev-c" }),
      findings: [
        { dimension: "acceptance", severity: "REGRESSION", key: "gate:test-suite", detail: "PASS → FAIL" },
        { dimension: "dependencies", severity: "INFO", key: "react", detail: "18 → 18.1" }
      ],
      generatedAt: AT
    });
    const text = renderSentinelReport(report);
    expect(text).toContain("REPORT_ONLY");
    expect(text).toContain("gate:test-suite");
    expect(text).toContain("1 informational finding(s) omitted");
  });
});

describe("regression sentinel capture (P6)", () => {
  it("normalizes signatures so formatting churn is not drift", () => {
    expect(normalizeSignature("(  a :  string ,\n b: number )")).toBe("( a : string , b: number )");
  });

  it("captures exported functions, classes, consts and declared types", () => {
    const surface = captureFileSurface(
      [
        "export function route(request: RoleRoutingRequest): RuntimeCandidate[] {",
        "export async function later(): Promise<void> {",
        "export class RoleRouter {",
        "export const MAX = 5;",
        "export type Mode = 'a' | 'b';",
        "export interface Shape { id: string }"
      ].join("\n")
    );
    expect(surface.entries.map((entry) => entry.symbol)).toEqual([
      "function:route",
      "function:later",
      "class:RoleRouter",
      "const:MAX"
    ]);
    expect(surface.types).toEqual(["Mode", "Shape"]);
    expect(surface.entries.find((entry) => entry.symbol === "function:route")!.signature).toContain("RoleRoutingRequest");
  });

  it("captures interfaces from a real source tree and skips tests", () => {
    write("src/shared/thing.ts", "export function a(): void {}\nexport type T = 1;\n");
    write("src/shared/thing.test.ts", "export function notCaptured(): void {}\n");
    const { interfaces, schemas } = captureInterfaces({ repoRoot: dir });
    expect(Object.keys(interfaces)).toEqual(["src/shared/thing.ts#function:a"]);
    expect(schemas["src/shared/thing.ts"]).toEqual(["T"]);
  });

  it("reads the acceptance record P1 writes, and rejects a file that is not one", () => {
    write("record.json", JSON.stringify({ overall: "PASS", digest: "ab", summary: { pass: 1, fail: 0, blockedExternal: 0, degraded: 0, skipped: 0, total: 1 }, checks: [{ id: "x", program: "host", status: "PASS" }] }));
    expect(captureAcceptance(path.join(dir, "record.json"))!.digest).toBe("ab");
    write("bad.json", '{"rows":[]}');
    expect(captureAcceptance(path.join(dir, "bad.json"))).toBeUndefined();
    expect(captureAcceptance(path.join(dir, "missing.json"))).toBeUndefined();
    // A BOM must not defeat the capture, since evidence files here carry one.
    write("bom.json", `${String.fromCharCode(0xfeff)}${JSON.stringify({ overall: "FAIL", digest: "cd", summary: { pass: 0, fail: 1, blockedExternal: 0, degraded: 0, skipped: 0, total: 1 }, checks: [{ id: "x", program: "host", status: "FAIL" }] })}`);
    expect(captureAcceptance(path.join(dir, "bom.json"))!.overall).toBe("FAIL");
  });

  it("derives provider success rates from telemetry rows", () => {
    write(
      "telemetry.json",
      JSON.stringify({
        schemaVersion: 1,
        records: [
          { runtimeId: "web:a", outcome: "SUCCESS" },
          { runtimeId: "web:a", outcome: "FAILED" },
          { runtimeId: "web:b", outcome: "SUCCESS" }
        ]
      })
    );
    expect(captureProviderSuccess(path.join(dir, "telemetry.json"))).toEqual({ "web:a": 0.5, "web:b": 1 });
    expect(captureProviderSuccess(path.join(dir, "nope.json"))).toBeUndefined();
  });

  it("reads benchmarks from the first candidate that exists", () => {
    write("b.json", JSON.stringify({ persisted: 100, recovered: 20, routing: { prompts: 10, lightweight: 4 } }));
    const metrics = captureBenchmarks([path.join(dir, "missing.json"), path.join(dir, "b.json")])!;
    expect(metrics.persisted).toEqual({ value: 100, unit: "records", higherIsBetter: true });
    expect(metrics.lightweightRouted.value).toBe(4);
    expect(captureBenchmarks([path.join(dir, "missing.json")])).toBeUndefined();
  });

  it("captures build formats and sizes from a real output tree", () => {
    write("dist/index.html", "<html></html>");
    write("dist/assets/a.js", "x".repeat(100));
    write("dist-electron/electron/main.js", "y".repeat(200));
    const { fileFormats, buildSize } = captureBuildOutput(dir);
    expect(fileFormats[".js"]).toBe(2);
    expect(fileFormats[".html"]).toBe(1);
    expect(buildSize.dist).toBe(fs.statSync(path.join(dir, "dist/index.html")).size + 100);
    expect(buildSize["dist-electron"]).toBe(200);
  });

  it("captures dependencies from package.json", () => {
    write("package.json", JSON.stringify({ dependencies: { react: "18.2.0" }, devDependencies: { vitest: "4.1.11" } }));
    expect(captureDependencies(dir)).toEqual({ react: "18.2.0", vitest: "4.1.11" });
    expect(captureDependencies(path.join(dir, "nope"))).toBeUndefined();
  });

  it("captures a full snapshot, isolating a dimension that cannot be measured", () => {
    write("src/shared/thing.ts", "export function a(): void {}\n");
    write("package.json", JSON.stringify({ dependencies: { react: "18.2.0" } }));
    const captured = captureSnapshot({
      repoRoot: dir,
      tests: { files: 1, tests: 1, failed: 0 },
      now: () => AT
    });
    expect(captured.tests).toEqual({ files: 1, tests: 1, failed: 0 });
    expect(Object.keys(captured.interfaces!)).toContain("src/shared/thing.ts#function:a");
    expect(captured.dependencies).toEqual({ react: "18.2.0" });
    // Nothing was written into the tree by the capture itself.
    expect(fs.existsSync(path.join(dir, "artifacts"))).toBe(false);
    // Dimensions with no measurement are listed, not silently omitted.
    expect(captured.unavailable!.map((entry) => entry.dimension)).toContain("acceptance");
  });

  it("round-trips a snapshot through disk and refuses a foreign file", () => {
    const file = path.join(dir, "snap.json");
    writeSnapshot(file, snapshot({ tests: { files: 1, tests: 2, failed: 0 } }));
    expect(readSnapshot(file).tests).toEqual({ files: 1, tests: 2, failed: 0 });
    expect(tryReadSnapshot(path.join(dir, "missing.json"))).toBeUndefined();
    write("foreign.json", JSON.stringify({ kind: "SOMETHING_ELSE", schemaVersion: 1 }));
    expect(tryReadSnapshot(path.join(dir, "foreign.json"))).toBeUndefined();
    expect(() => readSnapshot(path.join(dir, "foreign.json"))).toThrow(/Not a sentinel snapshot/);
  });

  it("detects a real regression end to end against a real checkout", () => {
    write("src/shared/thing.ts", 'export function a(x: number): void {}\nexport interface S { id: string }\n');
    write("package.json", JSON.stringify({ dependencies: { react: "18.2.0" } }));
    const baseline = captureSnapshot({ repoRoot: dir, tests: { files: 1, tests: 10, failed: 0 }, now: () => AT });

    // A candidate that removed a test, reshaped an export and bumped a major dep.
    write("src/shared/thing.ts", 'export function a(x: number, y: string): void {}\n');
    write("package.json", JSON.stringify({ dependencies: { react: "19.0.0" } }));
    const candidate = captureSnapshot({ repoRoot: dir, tests: { files: 1, tests: 8, failed: 0 }, now: () => AT });

    const findings = compareSnapshots(baseline, candidate);
    expect(findings.some((entry) => entry.severity === "REGRESSION" && entry.key === "tests")).toBe(true);
    expect(findings.some((entry) => entry.severity === "DRIFT" && entry.key.includes("function:a"))).toBe(true);
    expect(findings.some((entry) => entry.severity === "DRIFT" && entry.key === "react")).toBe(true);
    expect(findings.some((entry) => entry.severity === "DRIFT" && entry.key.includes("S"))).toBe(true);

    const report = buildSentinelReport({ baseline, candidate, findings, generatedAt: AT });
    expect(report.overall).toBe("FAIL");
  });
});
