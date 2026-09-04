import type { RuntimeAdapter, RuntimeCapability, RuntimeHealth, RuntimeKind, RuntimeRequest, RuntimeResult } from "./runtime";

export class UnsupportedRuntime implements RuntimeAdapter {
  readonly capabilities;
  constructor(readonly id: string, readonly kind: RuntimeKind, roles: RuntimeCapability[] = []) { this.capabilities = { roles, supportsCancellation: false, supportsStreaming: false }; }
  async healthCheck(): Promise<RuntimeHealth> { return { runtimeId: this.id, availability: "UNSUPPORTED", message: "Runtime is configured but not implemented in v0.5", checkedAt: new Date().toISOString() }; }
  async execute(request: RuntimeRequest): Promise<RuntimeResult> { return { runtimeId: this.id, jobId: request.jobId, status: "PERMANENT_FAILURE", failure: { code: "UNSUPPORTED", message: "Runtime is not implemented", retryable: false } }; }
}
