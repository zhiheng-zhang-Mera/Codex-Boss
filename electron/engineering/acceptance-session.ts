/**
 * Update-Plan/checkpoint-2.md §5.2/§5.3/§10.1 — the host side of the acceptance
 * session: it fixes the one commit the run is about, refuses certification on a
 * dirty working tree, and keeps the previous run's transient evidence out of the
 * namespace the root auditor reads.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  ACCEPTANCE_SESSION_SCHEMA_VERSION,
  canonicalJson,
  sessionProblems,
  type AcceptanceSession,
  type GateAttestation
} from "../../src/shared/acceptance-evidence";

/** Where every transient acceptance artifact lives, relative to the repository root. */
export const ACCEPTANCE_RELATIVE = path.join("artifacts", "acceptance");
export const SESSION_FILE = "session.json";
export const ATTESTATION_DIRECTORY = "attestations";
export const HISTORY_DIRECTORY = "history";
export const OWNER_LEDGER_FILE = "owner-interventions.json";

/** The acceptance artifacts directory for a repository root. */
export function acceptanceDirectory(root: string): string {
  return path.join(root, ACCEPTANCE_RELATIVE);
}

export function sessionPath(artifacts: string): string {
  return path.join(artifacts, SESSION_FILE);
}

export function attestationDirectory(artifacts: string): string {
  return path.join(artifacts, ATTESTATION_DIRECTORY);
}

export function attestationPath(artifacts: string, gate: string): string {
  return path.join(attestationDirectory(artifacts), `${gate}.json`);
}

export function reportPath(artifacts: string, reportFile: string): string {
  return path.join(artifacts, reportFile);
}

/** SHA-256 of a file's exact bytes, or "" when the file does not exist. */
export function sha256File(file: string): string {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
}

export function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function readSession(artifacts: string): AcceptanceSession | undefined {
  const parsed = readJsonFile(sessionPath(artifacts));
  if (parsed === undefined) return undefined;
  return sessionProblems(parsed).length === 0 ? parsed as AcceptanceSession : undefined;
}

/** The session as it is on disk, including why it is unusable when it is. */
export function inspectSession(artifacts: string): { session?: AcceptanceSession; problems: string[] } {
  const parsed = readJsonFile(sessionPath(artifacts));
  if (parsed === undefined) return { problems: ["SESSION_FILE_MISSING"] };
  const problems = sessionProblems(parsed);
  return problems.length ? { problems } : { session: parsed as AcceptanceSession, problems: [] };
}

export function readAttestation(artifacts: string, gate: string): unknown {
  return readJsonFile(attestationPath(artifacts, gate));
}

export function writeAttestation(artifacts: string, gate: string, attestation: GateAttestation): string {
  const target = attestationPath(artifacts, gate);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${canonicalJson(attestation)}\n`, "utf8");
  return target;
}

/* ------------------------------------------------------------------ *
 * Git identity
 * ------------------------------------------------------------------ */

function git(root: string, args: string[]): { ok: boolean; output: string } {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return { ok: false, output: `${result.error?.message ?? ""}${result.stderr ?? ""}`.trim() };
  }
  return { ok: true, output: String(result.stdout ?? "").trim() };
}

export function gitHead(root: string): string {
  const result = git(root, ["rev-parse", "HEAD"]);
  return result.ok ? result.output : "";
}

/** `git status --porcelain` output: empty means the working tree is clean. */
export function gitWorkingTreeStatus(root: string): string {
  const result = git(root, ["status", "--porcelain"]);
  return result.ok ? result.output : "UNKNOWN";
}

/* ------------------------------------------------------------------ *
 * §5.2/§5.3 starting a session
 * ------------------------------------------------------------------ */

export interface StartSessionOptions {
  root: string;
  artifacts?: string;
  /** §5.3: certification mode refuses a dirty tree. */
  certify?: boolean;
  /** §5.2.4: move the previous run's transient evidence into history first. */
  clean?: boolean;
  now?: () => Date;
  /** Test seams: they never change production behaviour when unset. */
  sessionId?: string;
  commit?: string;
  workingTreeStatus?: string;
}

export interface SessionStartOutcome {
  ok: boolean;
  reason?: string;
  session?: AcceptanceSession;
  sessionPath?: string;
  artifacts: string;
  history?: { label: string; moved: string[] };
}

/**
 * §5.2: fix the commit, mint the session id, and (optionally) quarantine the
 * previous run's evidence so a stale report cannot join this certification.
 */
export function startAcceptanceSession(options: StartSessionOptions): SessionStartOutcome {
  const artifacts = options.artifacts ?? acceptanceDirectory(options.root);
  const now = options.now ?? (() => new Date());
  const commit = options.commit ?? gitHead(options.root);
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    return { ok: false, artifacts, reason: `git rev-parse HEAD did not return a commit sha (got "${commit || "nothing"}")` };
  }
  const status = options.workingTreeStatus ?? gitWorkingTreeStatus(options.root);
  if (status === "UNKNOWN") {
    return { ok: false, artifacts, reason: "git status --porcelain could not be read, so the working tree cannot be certified clean" };
  }
  const workingTreeClean = status === "";
  if (options.certify === true && !workingTreeClean) {
    return {
      ok: false,
      artifacts,
      reason: `§5.3: certification refused on a dirty working tree —\n${status}`,
    };
  }

  let history: { label: string; moved: string[] } | undefined;
  if (options.clean === true) history = quarantineTransientEvidence(artifacts, now);

  const session: AcceptanceSession = {
    schemaVersion: ACCEPTANCE_SESSION_SCHEMA_VERSION,
    session_id: options.sessionId ?? `session-${now().toISOString().replace(/[:.]/g, "").replace("Z", "")}-${randomUUID().slice(0, 8)}`,
    commit_sha: commit,
    started_at: now().toISOString(),
    certification_mode: options.certify === true,
    working_tree_clean: workingTreeClean,
    working_tree_status: status
  };
  fs.mkdirSync(artifacts, { recursive: true });
  const target = sessionPath(artifacts);
  fs.writeFileSync(target, `${canonicalJson(session)}\n`, "utf8");
  return { ok: true, session, sessionPath: target, artifacts, ...(history ? { history } : {}) };
}

/**
 * §5.2.4: everything in the current acceptance namespace except the history
 * archive itself is moved into `history/<label>/`, so the root auditor can never
 * mix this session's evidence with a previous one.
 */
export function quarantineTransientEvidence(artifacts: string, now: () => Date = () => new Date()): { label: string; moved: string[] } {
  const historyRoot = path.join(artifacts, HISTORY_DIRECTORY);
  if (!fs.existsSync(artifacts)) return { label: "", moved: [] };
  const previous = readJsonFile(sessionPath(artifacts)) as { session_id?: unknown } | undefined;
  const label = typeof previous?.session_id === "string" && previous.session_id.trim() !== ""
    ? previous.session_id
    : `before-${now().toISOString().replace(/[:.]/g, "").replace("Z", "")}`;
  // The previous `session.json` is archived too: keeping the stale manifest next
  // to the new one is exactly the mixing §2.3 forbids.
  const entries = fs.readdirSync(artifacts).filter((name) => name !== HISTORY_DIRECTORY);
  if (!entries.length) return { label, moved: [] };
  const target = path.join(historyRoot, label);
  fs.mkdirSync(target, { recursive: true });
  for (const name of entries) {
    const from = path.join(artifacts, name);
    let to = path.join(target, name);
    let suffix = 1;
    while (fs.existsSync(to)) {
      suffix += 1;
      to = path.join(target, `${name}.${suffix}`);
    }
    fs.renameSync(from, to);
  }
  return { label, moved: entries };
}
