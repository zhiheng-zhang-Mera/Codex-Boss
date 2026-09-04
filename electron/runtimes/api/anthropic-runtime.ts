import { UnsupportedRuntime } from "../unsupported-runtime";
export class AnthropicRuntime extends UnsupportedRuntime { constructor() { super("api:anthropic", "api", ["planning", "research", "review", "synthesis", "coding", "validation", "critique"]); } }
