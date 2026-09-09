import path from "node:path";
import { readJson, writeJson, validId } from "./durable-json";
export type MemoryScope = "user" | "project" | "task" | "runtime";
export interface MemoryEntry { key: string; value: string; updatedAt: string; }
export class ScopedMemory {
  constructor(private readonly root: string) {}
  get(scope: MemoryScope, owner: string, key: string): MemoryEntry | undefined { return readJson<MemoryEntry>(this.file(scope, owner, key)); }
  put(scope: MemoryScope, owner: string, key: string, value: string): void {
    if (value.length > 50000) throw new Error("Memory entry exceeds context budget");
    writeJson(this.file(scope, owner, key), { key, value, updatedAt: new Date().toISOString() });
  }
  private file(scope: MemoryScope, owner: string, key: string): string {
    if (!["user", "project", "task", "runtime"].includes(scope)) throw new Error("Invalid memory scope");
    return path.join(this.root, scope, validId(owner), `${validId(key)}.json`);
  }
}
export type DegradedMode = "FULL" | "REDUCED" | "LIGHTWEIGHT" | "DETERMINISTIC" | "PAUSED";
export function degradedMode(capabilities: { workers: number; strong: boolean; cheap: boolean; native: boolean }): DegradedMode {
  if (capabilities.workers >= 2 && capabilities.strong) return "FULL";
  if (capabilities.strong) return "REDUCED";
  if (capabilities.cheap) return "LIGHTWEIGHT";
  return capabilities.native ? "DETERMINISTIC" : "PAUSED";
}
export interface BackendObservation { samples: number; passed: number; modelCalls: number; runtimeMs: number; }
export class ResourceController {
  private observations: Record<string, BackendObservation>;
  constructor(private readonly filePath?: string) { this.observations = filePath ? readJson<Record<string, BackendObservation>>(filePath) ?? {} : {}; }
  record(backend: string, passed: boolean, modelCalls: number, runtimeMs: number): void {
    if (![modelCalls, runtimeMs].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("Invalid usage evidence");
    const old = this.observations[backend] ?? { samples: 0, passed: 0, modelCalls: 0, runtimeMs: 0 };
    this.observations[backend] = { samples: old.samples + 1, passed: old.passed + Number(passed), modelCalls: old.modelCalls + modelCalls, runtimeMs: old.runtimeMs + runtimeMs };
    if (this.filePath) writeJson(this.filePath, this.observations);
  }
  score(backend: string): number {
    const record = this.observations[backend];
    if (!record || record.samples < 3) return 1;
    return (record.modelCalls + 1) / (record.passed + 1) + (record.samples - record.passed) / record.samples;
  }
}
