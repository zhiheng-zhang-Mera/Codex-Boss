import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { adapterFor, supportedAdapterIds } from "../electron/adapters/registry";
import { prepareScript, probeScript, sendScript, verifyPromptScript } from "../electron/adapters/page-scripts";
import type { Provider } from "../src/shared/contracts";

function provider(id: string, isCustom = false): Provider {
  return { id, name: id, url: "https://example.test", accent: "#fff", windowOpen: false, isCustom };
}

describe("versioned visible adapters", () => {
  it("generates syntactically valid JavaScript for every adapter", () => {
    for (const id of supportedAdapterIds()) {
      const d = adapterFor(provider(id))!;
      for (const script of [prepareScript(d, "hello\n世界"), verifyPromptScript(d, "hello\n世界"), sendScript(d), probeScript(d)]) {
        expect(() => new vm.Script(script)).not.toThrow();
      }
    }
  });

  it("verifies Grok's real editor instead of its visible auxiliary textarea", () => {
    class Textarea { value = "\n"; getClientRects() { return [{}]; } }
    const auxiliary = new Textarea();
    const editor = { innerText: "连接测试成功", getClientRects: () => [{}] };
    const document = { querySelector: (selector: string) => selector.startsWith("div") ? editor : auxiliary };
    const result = vm.runInNewContext(verifyPromptScript(adapterFor(provider("grok"))!, "连接测试成功"), {
      document, HTMLTextAreaElement: Textarea, HTMLInputElement: class {}
    });
    expect(result.ok).toBe(true);
  });

  it("captures nonempty short replies without accepting an empty response", () => {
    const node = { innerText: "连接测试成功", getClientRects: () => [{}] };
    const document = { body: { innerText: "" }, querySelector: () => null, querySelectorAll: () => [node] };
    const context = { document, location: { href: "https://grok.com/" }, Node: { DOCUMENT_POSITION_FOLLOWING: 4 } };
    const script = probeScript(adapterFor(provider("grok"))!);
    expect(vm.runInNewContext(script, context).latestResponse).toBe("连接测试成功");
    node.innerText = " ";
    expect(vm.runInNewContext(script, context).latestResponse).toBe("");
  });

  it("supports the required built-in web AIs including Grok and fails closed for custom URLs", () => {
    expect(supportedAdapterIds()).toEqual(expect.arrayContaining(["chatgpt", "gemini", "claude", "deepseek", "qwen", "kimi", "grok"]));
    expect(adapterFor(provider("chatgpt"))?.version).toMatch(/^chatgpt-web\//);
    expect(adapterFor(provider("grok"))).toEqual(expect.objectContaining({ providerId: "grok", sendLabels: expect.arrayContaining(["submit"]) }));
    expect(adapterFor(provider("custom-x", true))).toBeNull();
  });

  it("serializes prompt text without allowing a script-closing injection", () => {
    const definition = adapterFor(provider("chatgpt"));
    expect(definition).not.toBeNull();
    const script = prepareScript(definition!, "hello </script><script>bad()</script>");
    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script>");
  });

  it("uses provider-configured send labels and a scoped submit fallback", () => {
    const definition = adapterFor(provider("grok"));
    expect(definition).not.toBeNull();
    const script = sendScript(definition!);
    expect(script).toContain("d.sendLabels.some");
    expect(script).toContain("getAttribute('type') === 'submit'");
    expect(script).toContain("composer-submit-button");
    expect(script).toContain("attempt < 20");
    expect(prepareScript(definition!, "hello")).toContain("requestAnimationFrame");
    expect(prepareScript(definition!, "hello")).toContain("Promise.race");
    expect(verifyPromptScript(definition!, "hello")).toContain("value-not-applied");
    expect(verifyPromptScript(definition!, "hello")).toContain("\\u200B-\\u200D");
    expect(verifyPromptScript(definition!, "hello")).toContain("\\u00A0");
  });
});

it("verifies rich-editor paragraph boundaries without discarding indentation", () => {
  const text = (value: string) => ({ nodeType: 3, textContent: value });
  const p = (children: unknown[]) => ({ nodeName: "P", childNodes: children });
  const editor = { nodeName: "DIV", childNodes: [p([text("one")]), p([{ nodeName: "BR" }]), p([text("  two")])], innerText: "one\n\n\n\n  two", getClientRects: () => [{}] };
  const context = { document: { querySelector: () => editor }, HTMLTextAreaElement: class {}, HTMLInputElement: class {} };
  expect(vm.runInNewContext(verifyPromptScript(adapterFor(provider("chatgpt"))!, "one\n\n  two"), context).ok).toBe(true);
  expect(vm.runInNewContext(verifyPromptScript(adapterFor(provider("chatgpt"))!, "one\n\n two"), context).ok).toBe(false);
});
