import { UnsupportedRuntime } from "../unsupported-runtime";
export class GeminiRuntime extends UnsupportedRuntime { constructor() { super("api:gemini", "api", ["planning", "research", "review", "synthesis", "coding", "validation", "critique"]); } }
