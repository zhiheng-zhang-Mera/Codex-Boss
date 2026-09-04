import type { RoleId } from "../commander/role-router";

export interface ProtocolStep { id: string; role: RoleId; requireAll: boolean; }
export interface ProtocolDefinition { id: string; steps: readonly ProtocolStep[]; }
