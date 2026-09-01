import type { BossBridge } from "../shared/contracts";

declare global {
  interface Window { boss: BossBridge; }
}

export {};
