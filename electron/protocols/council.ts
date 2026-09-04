import type { ProtocolDefinition } from "./protocol";
export const councilProtocol: ProtocolDefinition = { id: "council", steps: [{ id: "independent-proposal", role: "planner", requireAll: true }, { id: "anonymous-peer-review", role: "reviewer", requireAll: true }, { id: "synthesis", role: "synthesizer", requireAll: true }, { id: "evidence-validation", role: "validator", requireAll: true }] };
