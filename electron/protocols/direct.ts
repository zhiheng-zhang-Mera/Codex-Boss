import type { ProtocolDefinition } from "./protocol";
export const directProtocol: ProtocolDefinition = { id: "direct", steps: [{ id: "response", role: "planner", requireAll: false }] };
