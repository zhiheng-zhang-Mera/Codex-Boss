import { UnsupportedRuntime } from "../unsupported-runtime";
export class OpenAiRuntime extends UnsupportedRuntime { constructor() { super("api:openai", "api", ["planning", "research", "review", "synthesis", "coding", "validation", "critique"]); } }
