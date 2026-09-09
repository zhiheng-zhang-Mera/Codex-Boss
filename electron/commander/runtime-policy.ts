import fs from "node:fs";
import type { RoleId } from "./role-router";

export interface RuntimePolicyRoute { preferred: string[]; fallback: boolean; }
export interface RuntimePolicy { maxParallel: number; roles: Record<RoleId, RuntimePolicyRoute>; }
const roleIds: RoleId[] = ["planner", "researcher", "reviewer", "synthesizer", "coder", "validator", "critic"];

export function loadRuntimePolicy(filePath: string): RuntimePolicy {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<RuntimePolicy>;
  if (!Number.isInteger(value.maxParallel) || value.maxParallel! < 1 || value.maxParallel! > 20) throw new Error("runtime-policy maxParallel must be 1-20");
  if (!value.roles || typeof value.roles !== "object") throw new Error("runtime-policy roles are required");
  for (const role of roleIds) {
    const route = value.roles[role];
    if (!route || !Array.isArray(route.preferred) || route.preferred.length === 0 || !route.preferred.every(validRuntimeId) || typeof route.fallback !== "boolean") throw new Error(`Invalid runtime policy for ${role}`);
    if (new Set(route.preferred).size !== route.preferred.length) throw new Error(`Duplicate runtime in ${role}`);
  }
  return value as RuntimePolicy;
}

function validRuntimeId(value: unknown): value is string { return typeof value === "string" && /^(web|codex|api|local):[^:]+$/.test(value); }
