import type { RuntimeAdapter, RuntimeCapabilities, RuntimeHealth, RuntimeRequest, RuntimeResult } from "../runtime";

export interface ProviderRuntimeHooks {
  healthCheck(): Promise<RuntimeHealth>;
  execute(request: RuntimeRequest, signal?: AbortSignal): Promise<RuntimeResult>;
  cancel?(jobId: string): Promise<void>;
}

export class ProviderRuntimeAdapter implements RuntimeAdapter {
  readonly kind = "web" as const;
  readonly capabilities: RuntimeCapabilities;
  constructor(readonly id: string, private readonly hooks: ProviderRuntimeHooks, capabilities?: Partial<RuntimeCapabilities>) {
    if (!id.startsWith("web:")) throw new Error("Web runtime id must start with web:");
    this.capabilities = { roles: ["planning", "research", "review", "synthesis", "coding", "validation", "critique"], supportsCancellation: false, supportsStreaming: false, ...capabilities };
  }
  healthCheck(): Promise<RuntimeHealth> { return this.hooks.healthCheck(); }
  execute(request: RuntimeRequest, signal?: AbortSignal): Promise<RuntimeResult> { return this.hooks.execute(request, signal); }
  cancel(jobId: string): Promise<void> { return this.hooks.cancel?.(jobId) ?? Promise.resolve(); }
}
