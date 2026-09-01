import { describe, expect, it } from "vitest";
import { adapterFor, supportedAdapterIds } from "../electron/adapters/registry";
import { prepareScript } from "../electron/adapters/page-scripts";
import type { Provider } from "../src/shared/contracts";

function provider(id: string, isCustom = false): Provider {
  return { id, name: id, url: "https://example.test", accent: "#fff", windowOpen: false, isCustom };
}

describe("versioned visible adapters", () => {
  it("supports the six required built-in web AIs and fails closed for custom URLs", () => {
    expect(supportedAdapterIds()).toEqual(expect.arrayContaining(["chatgpt", "gemini", "claude", "deepseek", "qwen", "kimi"]));
    expect(adapterFor(provider("chatgpt"))?.version).toMatch(/^chatgpt-web\//);
    expect(adapterFor(provider("custom-x", true))).toBeNull();
  });

  it("serializes prompt text without allowing a script-closing injection", () => {
    const definition = adapterFor(provider("chatgpt"));
    expect(definition).not.toBeNull();
    const script = prepareScript(definition!, "hello </script><script>bad()</script>");
    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script>");
  });
});
