import path from "node:path";
import { runAllowedCommand, type AllowedCommand, type CommandEvidence } from "../engineering/command-runner";
import { candidateEnvironment, isOwnerAdministrationTarget } from "../credential-boundary/credential-boundary";
import { assertNoCredentialLeak } from "../credential-boundary/sanitized-environment";
import type { RootClassification, RootDecision, RootOperation } from "../../src/shared/root-authority/contracts";
import type { RootAuthority } from "./root-authority";

/**
 * Autonomous Evolution execution profile (Update-Plan/Isolation-Finalization.md
 * §5, §10, §14 RT-05/RT-06/RT-24, §17).
 *
 * This is NOT the general Computer-Use / arbitrary-automation profile. It is a
 * strictly smaller capability set granted to a Candidate worker, expressed as
 * data so it can be asserted in acceptance evidence rather than described in a
 * prompt. The worker has no shell channel at all: everything it may run is a
 * direct executable with host-chosen arguments, the same discipline
 * `engineering/command-runner.ts` already applies, now with a sanitized
 * environment and a recorded Root decision on every classification.
 *
 * The important asymmetry: anything not on the allow-list is DENY, including
 * things that look harmless. Adding a capability is a deliberate edit to a Root
 * Surface, not a side effect of a permissive default.
 */

/** Capabilities an autonomous worker may exercise inside its Candidate. */
export type EvolutionWorkerAction =
  // allowed (§10 允许)
  | "workspace.read"
  | "workspace.write"
  | "patch.apply"
  | "test.run"
  | "build.run"
  | "typecheck.run"
  | "lint.run"
  | "git.status"
  | "git.diff"
  | "git.branch.read"
  | "evidence.write"
  | "reviewer.role"
  // forbidden (§10 禁止 worker 直接执行)
  | "shell.arbitrary"
  | "git.push"
  | "git.push.main"
  | "git.checkout.main"
  | "git.switch.main"
  | "git.reset.hard"
  | "gh.api"
  | "gh.api.admin"
  | "http.owner.token"
  | "powershell.arbitrary"
  | "credential.dump"
  | "home.secret.scan"
  | "browser.owner.admin"
  | "stable.process.kill"
  | "stable.runtime.write"
  | "remote.side.effect";

export const EVOLUTION_WORKER_ALLOWED: readonly EvolutionWorkerAction[] = [
  "workspace.read",
  "workspace.write",
  "patch.apply",
  "test.run",
  "build.run",
  "typecheck.run",
  "lint.run",
  "git.status",
  "git.diff",
  "git.branch.read",
  "evidence.write",
  "reviewer.role"
];

export const EVOLUTION_WORKER_DENIED: readonly EvolutionWorkerAction[] = [
  "shell.arbitrary",
  "git.push",
  "git.push.main",
  "git.checkout.main",
  "git.switch.main",
  "git.reset.hard",
  "gh.api",
  "gh.api.admin",
  "http.owner.token",
  "powershell.arbitrary",
  "credential.dump",
  "home.secret.scan",
  "browser.owner.admin",
  "stable.process.kill",
  "stable.runtime.write",
  "remote.side.effect"
];

export function isEvolutionWorkerAction(value: unknown): value is EvolutionWorkerAction {
  return typeof value === "string" && (EVOLUTION_WORKER_ALLOWED as readonly string[]).concat(EVOLUTION_WORKER_DENIED as readonly string[]).includes(value);
}

/** Root operation attributed to a denied worker action, for the audit ledger. */
const ACTION_ROOT_OPERATION: Readonly<Record<string, RootOperation>> = {
  "shell.arbitrary": "shell.arbitrary",
  "git.push": "main.direct.push",
  "git.push.main": "main.direct.push",
  "git.reset.hard": "main.direct.push",
  "git.checkout.main": "main.direct.push",
  "git.switch.main": "main.direct.push",
  "gh.api": "repository.administration",
  "gh.api.admin": "repository.administration",
  "http.owner.token": "owner.credential.use",
  "powershell.arbitrary": "shell.arbitrary",
  "credential.dump": "owner.credential.scan",
  "home.secret.scan": "owner.credential.scan",
  "browser.owner.admin": "ruleset.self.rewrite",
  "stable.process.kill": "stable.worktree.write",
  "stable.runtime.write": "stable.runtime.write",
  "remote.side.effect": "repository.administration"
};

/**
 * Classifies one worker action. The result is `ALLOW` only for the explicit
 * allow-list; everything else is `DENY` (there is no REQUIRE_OWNER branch here,
 * because a worker cannot "wait for the Owner" — it simply may not do it).
 */
export function classifyEvolutionWorkerAction(action: EvolutionWorkerAction): RootDecision {
  return EVOLUTION_WORKER_ALLOWED.includes(action) ? "ALLOW" : "DENY";
}

export interface EvolutionCommandRequest {
  /** Executable plus arguments the worker asked to run. */
  argv: readonly string[];
  /**
   * A raw shell string the worker tried to smuggle in. The profile has no shell
   * channel, so any non-empty value is an immediate denial (RT-05).
   */
  shell?: string;
}

export interface EvolutionCommandVerdict {
  decision: RootDecision;
  reason: string;
  /** The Root operation attributed to the denial, when denied. */
  operation?: RootOperation;
}

/** Git subcommands that only read repository state. */
const GIT_READ_ONLY_SUBCOMMANDS: readonly string[] = [
  "status", "diff", "log", "rev-parse", "show", "ls-files", "cat-file", "for-each-ref", "ls-tree", "symbolic-ref", "describe", "blame", "shortlog", "name-rev"
];

/**
 * Classifies a worker-supplied command request. Defense in depth on top of the
 * command runner's own allow-list: even if a future runner gained a passthrough
 * path, the profile refuses the shapes below.
 *
 * Note that no shell metacharacter scan is needed here: commands are executed
 * with `execFile` and an explicit argv, so there is no shell to interpret them.
 * The denial is structural (the executable/subcommand is not granted), not
 * lexical, which is why quoting tricks cannot defeat it.
 */
export function classifyEvolutionCommand(request: EvolutionCommandRequest): EvolutionCommandVerdict {
  if (request.shell && request.shell.trim()) {
    return { decision: "DENY", reason: `the evolution profile has no shell channel; refusing shell request`, operation: "shell.arbitrary" };
  }
  const argv = (request.argv ?? []).filter((item) => typeof item === "string");
  if (!argv.length || !argv[0].trim()) {
    return { decision: "DENY", reason: "empty command request", operation: "shell.arbitrary" };
  }
  const executable = path.basename(argv[0]).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
  const rest = argv.slice(1);

  if (["sh", "bash", "zsh", "dash", "cmd", "powershell", "pwsh", "wsl"].includes(executable)) {
    return { decision: "DENY", reason: `${executable} is a shell; the evolution profile denies arbitrary shells`, operation: "shell.arbitrary" };
  }
  if (["curl", "wget", "invoke-webrequest", "iwr", "ssh", "scp", "gh", "reg", "cmdkey", "vaultcmd", "net"].includes(executable)) {
    const operation: RootOperation = executable === "gh" ? "repository.administration" : executable === "reg" || executable === "cmdkey" || executable === "vaultcmd" ? "owner.credential.scan" : "repository.administration";
    return { decision: "DENY", reason: `${executable} is not available to the evolution profile`, operation };
  }

  if (executable === "node") {
    // Only the host's own toolchain entry points may run under node.
    const entry = rest[0] ?? "";
    if (!/(vitest|tsc|typescript|eslint|vite)/i.test(entry)) {
      return { decision: "DENY", reason: "node may only run a local build/test tool entry point", operation: "shell.arbitrary" };
    }
    if (rest.some((arg) => arg === "-e" || arg === "--eval" || arg === "-p" || arg === "--print")) {
      return { decision: "DENY", reason: "node eval flags are a shell channel", operation: "shell.arbitrary" };
    }
    return { decision: "ALLOW", reason: "local toolchain entry point" };
  }

  if (executable === "git") {
    const subcommand = (rest.find((arg) => !arg.startsWith("-")) ?? "").toLowerCase();
    if (subcommand === "push" || subcommand === "fetch" || subcommand === "pull" || subcommand === "remote" || subcommand === "clone") {
      return { decision: "DENY", reason: `git ${subcommand} is a remote side effect; only the host promotion adapter may reach the remote`, operation: "main.direct.push" };
    }
    if (subcommand === "reset" || subcommand === "checkout" || subcommand === "switch" || subcommand === "clean" || subcommand === "commit" || subcommand === "merge" || subcommand === "rebase" || subcommand === "config" || subcommand === "apply") {
      return { decision: "DENY", reason: `git ${subcommand} can mutate the Candidate's own history and is owned by the Stable host adapter`, operation: "main.direct.push" };
    }
    if (!GIT_READ_ONLY_SUBCOMMANDS.includes(subcommand)) {
      return { decision: "DENY", reason: `git ${subcommand || "(none)"} is not a read-only inspection subcommand`, operation: "shell.arbitrary" };
    }
    return { decision: "ALLOW", reason: `git ${subcommand} reads repository state only` };
  }

  // Unknown executables are denied. This is the fail-closed default.
  return { decision: "DENY", reason: `${executable} is not on the evolution profile allow-list`, operation: "shell.arbitrary" };
}

/** A structural description of the profile, emitted into acceptance evidence. */
export interface EvolutionProfileDescription {
  profile: "EVOLUTION";
  allowed: readonly EvolutionWorkerAction[];
  denied: readonly EvolutionWorkerAction[];
  allowedCommands: readonly AllowedCommand[];
  shellChannel: false;
  remoteSideEffects: "host-promotion-adapter-only";
}

export const EVOLUTION_PROFILE_DESCRIPTION: EvolutionProfileDescription = {
  profile: "EVOLUTION",
  allowed: EVOLUTION_WORKER_ALLOWED,
  denied: EVOLUTION_WORKER_DENIED,
  allowedCommands: ["test", "typecheck", "build", "lint"],
  shellChannel: false,
  remoteSideEffects: "host-promotion-adapter-only"
};

export interface EvolutionExecutionProfileOptions {
  /** Candidate workspace root. */
  root: string;
  authority: RootAuthority;
  environment?: NodeJS.ProcessEnv;
  /** Actor label recorded on decisions made through this profile. */
  actor?: string;
}

/**
 * Runtime handle for one Candidate. Holds the sanitized environment and funnels
 * every capability request through the Root Authority so the durable ledger sees
 * refusals as well as grants.
 */
export class EvolutionExecutionProfile {
  readonly root: string;
  private readonly authority: RootAuthority;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly actor: string;

  constructor(options: EvolutionExecutionProfileOptions) {
    this.root = path.resolve(options.root);
    this.authority = options.authority;
    this.actor = options.actor ?? "evolution-worker";
    this.environment = candidateEnvironment(options.environment ?? process.env);
    // Post-condition, not a promise: the environment handed to children is
    // verified credential-free before any child is spawned (RT-23).
    assertNoCredentialLeak(this.environment);
  }

  /** The sanitized child environment (toolchain preserved, authority removed). */
  childEnvironment(): NodeJS.ProcessEnv {
    return { ...this.environment };
  }

  /** Classifies a worker action and records the decision. */
  classifyAction(action: EvolutionWorkerAction, detail: string): RootClassification {
    const operation = ACTION_ROOT_OPERATION[action] ?? "candidate.workspace.read";
    return this.authority.classify({ operation, detail: `worker action ${action}: ${detail}`, actor: this.actor });
  }

  /**
   * Refuses a worker action that the profile does not grant. Signals that map to
   * a §4 DENY operation throw (`RootDeniedError`); nothing here returns a
   * success for a denied action.
   */
  assertActionAllowed(action: EvolutionWorkerAction, detail: string): RootClassification {
    if (classifyEvolutionWorkerAction(action) === "DENY") {
      const operation = ACTION_ROOT_OPERATION[action] ?? "shell.arbitrary";
      return this.authority.enforce({ operation, detail: `profile denies worker action ${action}: ${detail}`, actor: this.actor });
    }
    return this.authority.classify({ operation: "candidate.workspace.read", detail: `profile allows worker action ${action}: ${detail}`, actor: this.actor });
  }

  /** Classifies a raw command request; DENY is recorded and thrown. */
  assertCommandAllowed(request: EvolutionCommandRequest): EvolutionCommandVerdict {
    const verdict = classifyEvolutionCommand(request);
    if (verdict.decision === "DENY") {
      this.authority.enforce({ operation: verdict.operation ?? "shell.arbitrary", detail: `profile denies command ${request.argv.join(" ")}: ${verdict.reason}`, actor: this.actor });
    }
    return verdict;
  }

  /** RT-24: the evolution path never drives a browser at the Owner's admin UI. */
  assertNavigationAllowed(url: string): void {
    if (isOwnerAdministrationTarget(url)) {
      this.authority.enforce({ operation: "ruleset.self.rewrite", detail: `evolution profile refuses to navigate to an Owner administration target: ${url}`, actor: this.actor });
    }
  }

  /**
   * Runs one host-selected build/test command with the sanitized environment.
   * The command name is an `AllowedCommand`, never a worker string.
   */
  async runHostSelected(command: AllowedCommand, files: string[] = []): Promise<CommandEvidence> {
    const operation: RootOperation = command === "test" ? "candidate.test" : "candidate.build";
    this.authority.classify({ operation, detail: `host-selected ${command} with ${files.length} target file(s)`, actor: this.actor });
    return runAllowedCommand(this.root, command, files, { env: this.environment });
  }
}

/** True when the given path lies inside a Candidate workspace root. */
export function isInsideWorkspace(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
