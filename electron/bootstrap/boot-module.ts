/**
 * Boot module contract (convergence book, Phase F).
 *
 * `main.ts` used to be the project's implicit service locator: every subsystem
 * reached into module-scope bindings that only the composition root could see, so
 * no part of the bootstrap could be reasoned about, tested or disposed on its own.
 *
 * A boot module is the smallest step away from that: a plain factory that owns one
 * cohesive slice, receives everything it needs as an argument, registers what it
 * owns, and can report its own health and shut itself down. Deliberately NOT a
 * container, a provider registry or a service locator — the book forbids that, and
 * a factory is enough.
 */

interface ModuleHealth {
  module: string;
  status: "READY" | "DEGRADED";
  detail: string;
}

export interface BootModule<T> {
  /** What the module built; the composition root is the only holder. */
  service: T;
  /** One line an operator can read, computed from the module's own state. */
  health(): ModuleHealth;
  /** Releases whatever the module acquired. Idempotent. */
  dispose(): Promise<void> | void;
}

/**
 * The `ipcMain.handle` surface a module is allowed to use.
 *
 * Typed structurally so a boot module never imports Electron: the composition root
 * passes the real registrar in, and a test can pass a recorder.
 */
export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
}

/**
 * Logs every module's health once, at boot.
 *
 * This is what makes `health()` load-bearing rather than decorative: a module that
 * registered nothing, or registered half of what it owns, says so in the startup
 * log instead of failing later in a way nobody can trace.
 */
export function reportBootHealth(modules: ReadonlyArray<BootModule<unknown>>): ModuleHealth[] {
  const health = modules.map((module) => module.health());
  for (const entry of health) console.log(`[boot] ${entry.module} ${entry.status} — ${entry.detail}`);
  return health;
}

/** Disposes modules in reverse boot order; never throws. */
export async function disposeBootModules(modules: ReadonlyArray<BootModule<unknown>>): Promise<void> {
  for (const module of [...modules].reverse()) {
    try {
      await module.dispose();
    } catch (error) {
      console.error(`[boot] ${module.health().module} dispose failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
