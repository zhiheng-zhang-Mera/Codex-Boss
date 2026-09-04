import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "./runtime";
import { compileIntent } from "../../src/shared/task-ir";
import { executeNative } from "../engineering/native-tools";
import type { ProviderApiClient } from "../provider-api";
export class NativeRuntime implements RuntimeAdapter {
  readonly id = "local:native"; readonly kind = "local" as const;
  readonly capabilities = { roles: ["validation", "research"] as const, consumesModel: false, supportsCancellation: false, supportsStreaming: false };
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
  constructor(private readonly providerId: string, private readonly client: ProviderApiClient) { this.id = `api:${providerId}`; }
  async healthCheck() {
    try { this.client.validate(this.providerId); return { runtimeId: this.id, availability: "AVAILABLE" as const, message: "Configured API transport", checkedAt: new Date().toISOString() }; }
    catch (error) { return { runtimeId: this.id, availability: "AUTH_REQUIRED" as const, message: String(error), checkedAt: new Date().toISOString() }; }
  }
  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    const answer = await this.client.complete(this.providerId, [request.context, request.prompt].filter(Boolean).join("\n\n"));
    return { runtimeId: this.id, jobId: request.jobId, status: "SUCCESS", content: answer.content };
  }
}
