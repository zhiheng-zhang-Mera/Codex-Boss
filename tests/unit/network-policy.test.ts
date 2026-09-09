import { describe, expect, it } from "vitest";
import { fallbackAfterFailure, probeNetwork, resolveRoute } from "../../src/shared/network-policy";

describe("R-501/R-502 network + proxy policy", () => {
  it("probe reports which egress routes are actually observed", () => {
    const probe = probeNetwork({ nodeId: "desktop", directReachableProviders: ["chatgpt"], userProxyConfigured: true });
    expect(probe.capabilities.find((item) => item.id === "direct")?.available).toBe(true);
    expect(probe.capabilities.find((item) => item.id === "user-proxy")?.available).toBe(true);
    expect(probe.capabilities.find((item) => item.id === "regional-proxy")?.available).toBe(false);
    expect(probe.priority[0]).toBe("direct");
  });

  it("direct is used when available and not proxy-required; proxies only when needed", () => {
    const probe = probeNetwork({ nodeId: "desktop", directReachableProviders: ["chatgpt"], userProxyConfigured: true });
    expect(resolveRoute(probe, "chatgpt", false).route).toBe("DIRECT");
    expect(resolveRoute(probe, "chatgpt", true).route).toBe("USER_PROXY"); // direct skipped when proxy required
    const noDirect = probeNetwork({ nodeId: "desktop", directReachableProviders: [], userProxyConfigured: true });
    expect(resolveRoute(noDirect, "qwen", false).route).toBe("USER_PROXY");
  });

  it("no egress ⇒ DEGRADE_PROVIDER, never Boss-down; fallback ladder never repeats", () => {
    const none = probeNetwork({ nodeId: "desktop", directReachableProviders: [] });
    expect(resolveRoute(none, "qwen", false).route).toBe("DEGRADE_PROVIDER");

    const probe = probeNetwork({ nodeId: "desktop", directReachableProviders: ["chatgpt"], userProxyConfigured: true });
    expect(fallbackAfterFailure("DIRECT", probe).route).toBe("USER_PROXY");
    expect(fallbackAfterFailure("USER_PROXY", probe).route).toBe("DEGRADE_PROVIDER"); // exhausted
    expect(fallbackAfterFailure("DEGRADE_PROVIDER", probe).route).toBe("DEGRADE_PROVIDER");
  });
});
