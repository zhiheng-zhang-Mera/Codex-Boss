import { describe, expect, it } from "vitest";
import { adapterFor, supportedAdapterIds } from "../../electron/adapters/registry";

const providerFor = (id: string) => ({ id, name: id, url: "https://example.invalid/", isCustom: false }) as never;

describe("provider adapter registry (live direction 3)", () => {
  it("adds an explicit Microsoft Copilot adapter with its visible input + honest enter send", () => {
    const copilot = adapterFor(providerFor("copilot"))!;
    expect(copilot).toBeTruthy();
    expect(copilot.inputSelectors).toContain("textarea#userInput");
    expect(copilot.sendMode).toBe("enter");
    expect(copilot.version).toContain("2026-09");
  });

  it("falls back to a generic default adapter for built-ins without a hand-tuned one", () => {
    for (const id of ["mistral", "perplexity", "doubao"]) {
      const definition = adapterFor(providerFor(id));
      expect(definition).toBeTruthy();
      expect(definition!.sendMode).toBe("enter");
      expect(definition!.version).toContain("generic");
    }
  });

  it("keeps hand-tuned senders as click mode by default", () => {
    expect(adapterFor(providerFor("chatgpt"))!.sendMode).toBeUndefined();
    expect(adapterFor(providerFor("grok"))!.sendMode).toBeUndefined();
    expect(supportedAdapterIds()).toContain("copilot");
  });
});
