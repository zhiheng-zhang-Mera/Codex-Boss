import type { RuntimeAdapter, RuntimeCapability, RuntimeHealth, RuntimeId } from "../runtimes/runtime";
import { isRuntimeAvailable } from "../runtimes/runtime";

export class RuntimeRegistry {
  private readonly runtimes = new Map<RuntimeId, RuntimeAdapter>();
  private readonly health = new Map<RuntimeId, RuntimeHealth>();

  register(runtime: RuntimeAdapter): void {
    if (this.runtimes.has(runtime.id)) throw new Error(`Duplicate runtime: ${runtime.id}`);
    this.runtimes.set(runtime.id, runtime);
  }

  unregister(runtimeId: RuntimeId): boolean {
    this.health.delete(runtimeId);
    return this.runtimes.delete(runtimeId);
  }

  get(runtimeId: RuntimeId): RuntimeAdapter | undefined { return this.runtimes.get(runtimeId); }
  list(): RuntimeAdapter[] { return [...this.runtimes.values()]; }

  async refreshHealth(runtimeId?: RuntimeId): Promise<RuntimeHealth[]> {
    const targets = runtimeId ? [this.require(runtimeId)] : this.list();
    const settled = await Promise.allSettled(targets.map(async (runtime) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([runtime.healthCheck(), new Promise<RuntimeHealth>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Health probe timed out")), 15000); })]); }
      finally { if (timer) clearTimeout(timer); }
    }));
    return settled.map((item, index) => {
      const state: RuntimeHealth = item.status === "fulfilled" ? item.value : {
        runtimeId: targets[index].id,
        availability: "DOWN",
        message: String(item.reason),
        checkedAt: new Date().toISOString()
      };
      this.health.set(state.runtimeId, state);
      return state;
    });
  }

  getHealth(runtimeId: RuntimeId): RuntimeHealth | undefined { return this.health.get(runtimeId); }

  listAvailable(): RuntimeAdapter[] {
    return this.list().filter((runtime) => isRuntimeAvailable(this.health.get(runtime.id)?.availability ?? "DOWN"));
  }

  findByCapability(capability: RuntimeCapability): RuntimeAdapter[] {
    return this.list().filter((runtime) => runtime.capabilities.roles.includes(capability));
  }

  private require(runtimeId: RuntimeId): RuntimeAdapter {
    const runtime = this.get(runtimeId);
    if (!runtime) throw new Error(`Unknown runtime: ${runtimeId}`);
    return runtime;
  }
}
