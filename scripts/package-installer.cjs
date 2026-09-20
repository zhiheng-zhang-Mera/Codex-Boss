/**
 * RC1 Windows installer packager.
 *
 * It CONSUMES the output of `pnpm run package:portable` and never re-decides which
 * files belong to the application: the payload it ships is exactly that tree, plus
 * one generated `build-manifest.json`.
 *
 *   node scripts/package-installer.cjs [--portable <dir>] [--out <dir>]
 *
 * The installer executable is a thin C# stub compiled by the Windows-provided
 * `csc.exe` with the ZIP payload appended to it. No new runtime or packaging
 * dependency is introduced, and the application itself is not rebuilt here.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PRODUCT = "Codex-Boss";
const DISPLAY_NAME = "Codex-Boss Alien2 Real Work v1 RC1";
const CHANNEL = "alien2-real-work-rc";
const INSTALLER_BASENAME = "Codex-Boss-Alien2-RealWork-v1-RC1-Setup.exe";
const PORTABLE_BASENAME = "Codex-Boss-Alien2-RealWork-v1-RC1-Portable.zip";
const CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

function parseArgs(argv) {
  const options = { portable: undefined, out: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--portable") options.portable = path.resolve(argv[++index]);
    else if (argv[index] === "--out") options.out = path.resolve(argv[++index]);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function resolvePortable() {
  if (options.portable) return options.portable;
  const latest = path.join(ROOT, "artifacts", "latest-package.json");
  if (!fs.existsSync(latest)) throw new Error("no portable package: run `pnpm run package:portable` first");
  return JSON.parse(fs.readFileSync(latest, "utf8")).destination;
}

/** Copies the portable tree with hard links so the payload can carry one extra file. */
function stagePayload(portable, staging) {
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  let linked = 0;
  let copied = 0;
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) walk(source, target);
      else {
        try {
          fs.linkSync(source, target);
          linked += 1;
        } catch {
          fs.copyFileSync(source, target);
          copied += 1;
        }
      }
    }
  };
  walk(portable, staging);
  return { linked, copied };
}

/** The facts the manifest must state, each read from the code the payload will run. */
function buildFacts(portable) {
  const appRoot = path.join(portable, "resources", "app");
  const required = [
    "dist/index.html",
    "dist-electron/electron/main.js",
    "dist-electron/electron/runtime-intelligence/live-capture.js",
    "dist-electron/src/shared/runtime-intelligence/policy-registry.js",
    "dist-electron/src/shared/runtime-intelligence/evaluation-report.js",
    "package.json"
  ];
  for (const item of required) {
    if (!fs.existsSync(path.join(appRoot, item))) throw new Error(`the portable payload is incomplete: ${item}`);
  }

  const registry = require(path.join(appRoot, "dist-electron", "src", "shared", "runtime-intelligence", "policy-registry.js"));
  const policies = Object.fromEntries(registry.policyRegistry().map((policy) => [policy.policyId, policy.policyHash]));

  // Fail closed: the shipped bytes must still declare that the plane grants no
  // execution authority. A manifest that merely repeated a remembered literal
  // would not notice a build that changed it.
  const liveCapture = fs.readFileSync(path.join(appRoot, "dist-electron", "electron", "runtime-intelligence", "live-capture.js"), "utf8");
  const evaluationReport = fs.readFileSync(path.join(appRoot, "dist-electron", "src", "shared", "runtime-intelligence", "evaluation-report.js"), "utf8");
  if (!liveCapture.includes("executionAuthority: false")) throw new Error("live capture no longer declares executionAuthority: false");
  if (!evaluationReport.includes("grantsExecutionAuthority: false")) throw new Error("the evaluation report no longer declares grantsExecutionAuthority: false");

  const bless = execFileSync(process.execPath, ["scripts/acceptance-evolution-bless.cjs", "--check"], { cwd: ROOT, encoding: "utf8" });
  const epoch = /epoch (\d+) \(([^)]+)\) MATCHES/.exec(bless);
  const surface = /root trust surface: (\d+) files, aggregate ([0-9a-f]{64})/.exec(bless);
  if (!epoch || !surface) throw new Error(`bless --check did not report a matching epoch:\n${bless}`);
  const epochRecord = JSON.parse(fs.readFileSync(path.join(ROOT, "trust-policy", "trust-epoch.json"), "utf8"));

  const layerSubjects = git(["log", "--format=%H%x09%s", "origin/main..HEAD"])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split("\t");
      return { sha, subject };
    })
    .filter((entry) => entry.subject.includes("runtime-intelligence:"));
  const layers = layerSubjects.map((entry) => {
    const match = /\(RI-(\d{2})\)/.exec(entry.subject);
    return { level: match ? `RI-${match[1]}` : "RI-??", sha: entry.sha, subject: entry.subject.trim() };
  });
  const highest = layers.map((layer) => layer.level).sort().pop() ?? "none";

  return {
    product: PRODUCT,
    version: require(path.join(ROOT, "package.json")).version,
    displayName: DISPLAY_NAME,
    channel: CHANNEL,
    candidateBranch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    candidateCommit: git(["rev-parse", "HEAD"]),
    mainBaseCommit: git(["rev-parse", "origin/main"]),
    rootTrustEpoch: Number(epoch[1]),
    rootTrustContract: epoch[2],
    rootTrustSurfaceFiles: Number(surface[1]),
    rootTrustSurfaceHash: surface[2],
    rootTrustEpochRecordSurface: epochRecord.root_surface_hash ?? null,
    riLevel: highest,
    riLayers: layers,
    authorityPlane: "ADVISORY_ONLY",
    reliabilityLevel: "LEVEL 2 — SHADOW COUNTERFACTUAL",
    executionAuthority: false,
    continuationPolicyHash: policies["continuation-policy-v1"],
    continuationPolicyV0Hash: policies["continuation-policy-v0"],
    schedulerPolicyHash: policies["scheduler-policy-v0"],
    skillLoadoutPolicyHash: policies["skill-loadout-policy-v0"],
    confidencePolicyHash: policies["confidence-policy-v0"],
    buildTimestamp: new Date().toISOString(),
    builtBy: "scripts/package-installer.cjs",
    payloadSource: portable
  };
}

function writeBuildInfoSource(directory, facts) {
  const literal = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const source = [
    "// Generated by scripts/package-installer.cjs — not a source file.",
    "internal static class BuildInfo",
    "{",
    `    public const string ProductDisplayName = ${literal(facts.displayName)};`,
    `    public const string Publisher = ${literal(PRODUCT)};`,
    `    public const string ProductUrl = ${literal("https://github.com/zhiheng-zhang-Mera/Codex-Boss")};`,
    `    public const string Version = ${literal(facts.version + "-rc1")};`,
    `    public const string Channel = ${literal(CHANNEL)};`,
    `    public const string CandidateCommit = ${literal(facts.candidateCommit)};`,
    "}",
    ""
  ].join("\r\n");
  const file = path.join(directory, "BuildInfo.g.cs");
  fs.writeFileSync(file, source);
  return file;
}

function main() {
  const portable = resolvePortable();
  if (!fs.existsSync(path.join(portable, "Codex Boss.exe"))) throw new Error(`no portable application at ${portable}`);
  const out = options.out ?? path.join(ROOT, "artifacts", "rc1");
  const work = path.join(out, "build");
  fs.mkdirSync(work, { recursive: true });

  const facts = buildFacts(portable);
  const portableManifest = path.join(portable, "manifest.json");
  facts.portableManifestHash = fs.existsSync(portableManifest) ? sha256(portableManifest) : null;
  facts.portableManifestFiles = fs.existsSync(portableManifest) ? JSON.parse(fs.readFileSync(portableManifest, "utf8")).files.length : null;

  const staging = path.join(work, "payload");
  const staged = stagePayload(portable, staging);
  const buildManifestPath = path.join(staging, "build-manifest.json");
  // The manifest cannot state the hash of the file it is inside: that hash belongs
  // to release-manifest.json, which is written after this file is final.
  fs.writeFileSync(buildManifestPath, JSON.stringify(facts, null, 2));

  const payloadZip = path.join(work, "payload.zip");
  fs.rmSync(payloadZip, { force: true });
  execFileSync("tar.exe", ["-a", "-c", "-f", payloadZip, "-C", staging, "."], { stdio: "inherit" });

  // The payload IS the portable artifact: one ZIP that serves both as what the
  // installer unpacks and as the artifact a user can run without installing.
  const portableZip = path.join(out, PORTABLE_BASENAME);
  fs.rmSync(portableZip, { force: true });
  fs.copyFileSync(payloadZip, portableZip);

  const buildInfo = writeBuildInfoSource(work, facts);
  const stub = path.join(work, "stub.exe");
  execFileSync(CSC, [
    "/nologo",
    "/target:exe",
    "/platform:x64",
    "/optimize+",
    "/win32manifest:" + path.join(ROOT, "installer", "windows", "installer.manifest"),
    "/out:" + stub,
    "/reference:" + path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "System.IO.Compression.dll"),
    "/reference:" + path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "System.IO.Compression.FileSystem.dll"),
    path.join(ROOT, "installer", "windows", "Installer.cs"),
    buildInfo
  ], { stdio: "inherit" });

  // Primary form: a thin installer that reads the payload ZIP beside it. A second,
  // single-file form (payload appended) is built into `single-file/` for hosts
  // whose endpoint protection does not object to a self-extracting executable.
  const installer = path.join(out, INSTALLER_BASENAME);
  fs.rmSync(installer, { force: true });
  const stubBytes = fs.readFileSync(stub);
  fs.writeFileSync(installer, stubBytes);

  const singleFile = path.join(out, "single-file", INSTALLER_BASENAME);
  fs.mkdirSync(path.dirname(singleFile), { recursive: true });
  const payloadBytes = fs.readFileSync(payloadZip);
  fs.writeFileSync(singleFile, Buffer.concat([stubBytes, payloadBytes]));

  const release = {
    product: PRODUCT,
    displayName: DISPLAY_NAME,
    version: facts.version,
    channel: CHANNEL,
    candidateBranch: facts.candidateBranch,
    candidateCommit: facts.candidateCommit,
    mainBaseCommit: facts.mainBaseCommit,
    riLevel: facts.riLevel,
    rootTrustEpoch: facts.rootTrustEpoch,
    rootTrustSurfaceHash: facts.rootTrustSurfaceHash,
    executionAuthority: facts.executionAuthority,
    generatedAt: new Date().toISOString(),
    installLayout: {
      installerNeedsPayloadBesideIt: true,
      payloadFile: portableZip,
      singleFileAlternative: singleFile
    },
    artifacts: {
      installer: { file: installer, bytes: stubBytes.length, sha256: sha256(installer) },
      portableArchive: { file: portableZip, bytes: payloadBytes.length, sha256: sha256(portableZip) },
      buildManifest: { file: buildManifestPath, sha256: sha256(buildManifestPath) },
      singleFileInstaller: { file: singleFile, bytes: stubBytes.length + payloadBytes.length, sha256: sha256(singleFile) },
      portablePackageManifest: { file: portableManifest, sha256: facts.portableManifestHash }
    },
    portableStaging: staged,
    facts
  };
  const releasePath = path.join(out, "release-manifest.json");
  fs.writeFileSync(releasePath, JSON.stringify(release, null, 2));

  console.log(JSON.stringify({
    installer,
    installerSha256: release.artifacts.installer.sha256,
    installerBytes: release.artifacts.installer.bytes,
    portableArchive: portableZip,
    portableSha256: release.artifacts.portableArchive.sha256,
    singleFileInstaller: singleFile,
    singleFileSha256: release.artifacts.singleFileInstaller.sha256,
    buildManifest: buildManifestPath,
    buildManifestSha256: release.artifacts.buildManifest.sha256,
    releaseManifest: releasePath
  }, null, 2));
}

main();
