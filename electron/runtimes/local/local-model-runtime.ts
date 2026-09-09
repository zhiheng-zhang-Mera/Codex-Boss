import { UnsupportedRuntime } from "../unsupported-runtime";
export class LocalModelRuntime extends UnsupportedRuntime { constructor(modelId = "unconfigured") { super(`local:${modelId}`, "local"); } }
