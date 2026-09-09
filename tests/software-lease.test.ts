import { describe, expect, it } from "vitest";
import { resourceProfile, sessionAllows } from "../src/shared/software-session";
import { SoftwareLeaseRegistry } from "../electron/computer/software-lease";

const now = 1_000_000;

describe("software session ownership", () => {
  it("derives the resource profile from the action", () => {
    expect(resourceProfile("read_page").mode).toBe("shared-read");
    expect(resourceProfile("verify_state").mode).toBe("shared-read");
    expect(resourceProfile("click_control").mode).toBe("exclusive");
    expect(resourceProfile("submit").mode).toBe("exclusive");
  });

  it("session access rules: shared-read coexists, exclusive blocks reads", () => {
    const shared = { session_id: "s", owner_task: "t1", target: "win", mode: "shared-read" as const, lease_until: now + 1000 };
    expect(sessionAllows(shared, "shared-read", now)).toBe(true);
    expect(sessionAllows(shared, "exclusive", now)).toBe(false);
    const exclusive = { session_id: "s", owner_task: "t1", target: "win", mode: "exclusive" as const, lease_until: now + 1000 };
    expect(sessionAllows(exclusive, "shared-read", now)).toBe(false);
    expect(sessionAllows(exclusive, "exclusive", now)).toBe(false);
    expect(sessionAllows({ ...exclusive, lease_until: now - 1 }, "exclusive", now)).toBe(true); // expired
  });
});

describe("software lease registry", () => {
  it("grants exclusive mutation to one task and blocks another", () => {
    const registry = new SoftwareLeaseRegistry();
    expect(registry.canAccess("notepad", "exclusive", now)).toBe(true);
    registry.acquire({ owner_task: "taskA", target: "notepad", mode: "exclusive", leaseMs: 60000 }, now);
    expect(registry.canAccess("notepad", "exclusive", now)).toBe(false);
    expect(registry.canAccess("notepad", "shared-read", now)).toBe(false);
    expect(() => registry.acquire({ owner_task: "taskB", target: "notepad", mode: "shared-read" }, now)).toThrow(/exclusive by taskA/);
    registry.release("notepad", "taskA");
    expect(registry.canAccess("notepad", "exclusive", now)).toBe(true);
  });

  it("allows concurrent shared reads but blocks mutation while any read is held", () => {
    const registry = new SoftwareLeaseRegistry();
    registry.acquire({ owner_task: "reader1", target: "browser", mode: "shared-read", leaseMs: 60000 }, now);
    expect(registry.canAccess("browser", "shared-read", now)).toBe(true); // another read is fine
    registry.acquire({ owner_task: "reader2", target: "browser", mode: "shared-read" }, now);
    expect(() => registry.acquire({ owner_task: "writer", target: "browser", mode: "exclusive" }, now)).toThrow(/shared-read by reader/);
  });

  it("frees an expired lease automatically", () => {
    const registry = new SoftwareLeaseRegistry();
    registry.acquire({ owner_task: "taskA", target: "win", mode: "exclusive", leaseMs: 1000 }, now);
    expect(registry.held("win", now + 5000)).toBeUndefined();
    expect(registry.canAccess("win", "exclusive", now + 5000)).toBe(true);
  });

  it("only the owning task may release a lease", () => {
    const registry = new SoftwareLeaseRegistry();
    registry.acquire({ owner_task: "taskA", target: "win", mode: "exclusive" }, now);
    registry.release("win", "intruder");
    expect(registry.canAccess("win", "exclusive", now)).toBe(false);
    registry.release("win", "taskA");
    expect(registry.canAccess("win", "exclusive", now)).toBe(true);
  });
});
