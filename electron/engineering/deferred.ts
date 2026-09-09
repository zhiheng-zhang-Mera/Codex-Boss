/**
 * Single home for the engineering graph-deferral error. Both EngineeringRuntime
 * and MicrotaskRuntime throw/classify deferred work with it; a duplicated class
 * per module would make `instanceof` checks fail across module boundaries
 * (a deferred microtask landing as FAILED instead of WAITING).
 */
export class GraphDeferred extends Error {}
