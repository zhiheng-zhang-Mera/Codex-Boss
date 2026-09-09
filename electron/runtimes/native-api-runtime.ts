import { ProviderHttpError } from "../provider-api";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "./runtime";
import { compileIntent } from "../../src/shared/task-ir";
import { executeNative } from "../engineering/native-tools";
import type { ProviderApiClient } from "../provider-api";
export class NativeRuntime implements RuntimeAdapter {
  readonly id = "local:native"; readonly kind = "local" as const;
  readonly capabilities = { roles: ["validation", "research"] as const, consumesModel: false, supportsCancellation: false, supportsStreaming: false };
  readonly compatibility = { id: "local:native", kind: "native", windows: { adapter_api: { min: "1", max: "1" } } } as const;
  constructor(private readonly workspace: string) {}
  async healthCheck() { return { runtimeId: this.id, availability: "AVAILABLE" as const, message: "Native filesystem and git tools", checkedAt: new Date().toISOString() }; }
  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    const operation = compileIntent(request.prompt).steps[0].operation;
    if (!operation) return { runtimeId: this.id, jobId: request.jobId, status: "PERMANENT_FAILURE", failure: { code: "UNSUPPORTED", message: "No exact native operation", retryable: false } };
    const evidence = await executeNative(this.workspace, operation);
    return { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content: evidence.output || "Empty native result" };
  }
}
export class ApiRuntime implements RuntimeAdapter {
  readonly kind = "api" as const;
  readonly id: string;
  readonly capabilities = { roles: ["planning", "research", "review", "synthesis", "coding", "validation", "critique"] as const, supportsCancellation: false, supportsStreaming: false };
  readonly compatibility = { id: "api", kind: "api", windows: { adapter_api: { min: "1", max: "1" } } } as const;
  constructor(private readonly providerId: string, private readonly client: ProviderApiClient) { this.id = `api:${providerId}`; }
  async healthCheck() {
    try { this.client.validate(this.providerId); return { runtimeId: this.id, availability: "AVAILABLE" as const, message: "Configured API transport", checkedAt: new Date().toISOString() }; }
    catch (error) { return { runtimeId: this.id, availability: "AUTH_REQUIRED" as const, message: String(error), checkedAt: new Date().toISOString() }; }
  }
  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    try {
    const answer = await this.client.complete(this.providerId, [request.context, request.prompt].filter(Boolean).join("\n\n"));
    return { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content: answer.content };
    } catch (error) {
      const status = error instanceof ProviderHttpError ? error.status : 0;
      const code = status === 429 ? "RATE_LIMITED" : [401, 403].includes(status) ? "AUTH_REQUIRED" : "UNKNOWN";
      return { runtimeId: this.id, jobId: request.jobId, status: code === "AUTH_REQUIRED" ? "PERMANENT_FAILURE" : "RETRYABLE_FAILURE", failure: { code, message: String(error), retryable: code !== "AUTH_REQUIRED", retryAt: error instanceof ProviderHttpError ? error.retryAt : undefined } };
    }
  }
}
