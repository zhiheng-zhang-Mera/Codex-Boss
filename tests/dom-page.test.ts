import { describe, expect, it } from "vitest";
import { DomPageBackend } from "../electron/computer/backends/dom-page";
import { SemanticRuntime } from "../electron/computer/semantic-runtime";

describe("DOM semantic tier (§8.2 dom-page)", () => {
  it("supports dom:-targeted mutations and reads, nothing else", () => {
    const backend = new DomPageBackend({ evaluate: async () => ({ ok: true }) });
    expect(backend.kind).toBe("dom");
    expect(backend.supports({ name: "click_control", target: 'dom:{"selector":"#send"}' })).toBe(true);
    expect(backend.supports({ name: "enter_text", target: 'dom:{"selector":"#input"}' })).toBe(true);
    expect(backend.supports({ name: "read_page", target: 'dom:{"selector":"*"}' })).toBe(true);
    expect(backend.supports({ name: "click_control", target: 'dom:{"selector":"#send","providerId":"chatgpt"}' })).toBe(true);
    expect(backend.supports({ name: "open_app", target: "notepad" })).toBe(false);
    expect(backend.supports({ name: "click_control", target: 'uia:{"processId":1}' })).toBe(false);
  });

  it("clicks a control and reports not-found as FAILED", async () => {
    const found = new DomPageBackend({ evaluate: async () => ({ ok: true }) });
    expect((await found.execute({ name: "click_control", target: 'dom:{"selector":"#send"}' }, new AbortController().signal)).status).toBe("SUCCESS");
    const missing = new DomPageBackend({ evaluate: async () => ({ ok: false, reason: "not-found" }) });
    expect((await missing.execute({ name: "click_control", target: 'dom:{"selector":"#send"}' }, new AbortController().signal)).status).toBe("FAILED");
  });

  it("reads and verifies page state through the runtime queue", async () => {
    const surface = { evaluate: async <T>(_script: string): Promise<T> => ({ ok: true, text: "saved: ok" }) as T };
    const runtime = new SemanticRuntime([new DomPageBackend(surface)]);
    const read = await runtime.execute({ name: "read_page", target: 'dom:{"selector":"body"}' });
    expect(read.status).toBe("SUCCESS");
    expect(read.evidence).toMatchObject({ text: "saved: ok" });
    const verify = await runtime.execute({ name: "verify_state", target: 'dom:{"selector":"body"}', expected: "saved: ok" });
    expect(verify.status).toBe("SUCCESS");
    const verifyFail = await runtime.execute({ name: "verify_state", target: 'dom:{"selector":"body"}', expected: "nope" });
    expect(verifyFail.status).toBe("FAILED");
  });

  it("executes click/enter/submit scripts with embedded selectors and values", async () => {
    const calls: Array<{ script: string; page?: unknown }> = [];
    const backend = new DomPageBackend({ evaluate: async (script, page) => { calls.push({ script, page }); return { ok: true }; } });
    await backend.execute({ name: "enter_text", target: 'dom:{"selector":"#prompt"}', value: 'a"b' }, new AbortController().signal);
    await backend.execute({ name: "submit", target: 'dom:{"selector":"#prompt"}' }, new AbortController().signal);
    expect(calls[0].script).toContain('"#prompt"');
    expect(calls[0].script).toContain('a\\"b'); // value safely JSON-escaped, cannot break out
    expect(calls[1].script).toContain("keydown");
    // No provider hint in the target → the surface is called without a page ref.
    expect(calls[0].page).toBeUndefined();
  });

  it("forwards a dom: providerId to the page surface", async () => {
    const pages: Array<{ providerId?: string } | undefined> = [];
    const backend = new DomPageBackend({ evaluate: async (_script, page) => { pages.push(page); return { ok: true }; } });
    await backend.execute({ name: "click_control", target: 'dom:{"selector":"#send","providerId":"chatgpt"}' }, new AbortController().signal);
    await backend.execute({ name: "read_page", target: 'dom:{"selector":"body","providerId":"gemini"}' }, new AbortController().signal);
    expect(pages[0]).toEqual({ providerId: "chatgpt" });
    expect(pages[1]).toEqual({ providerId: "gemini" });
  });

  it("rejects malformed dom: provider ids and keeps provider-less targets valid", async () => {
    const backend = new DomPageBackend({ evaluate: async () => ({ ok: true }) });
    const parse = async (target: string) => (await backend.execute({ name: "click_control", target }, new AbortController().signal)).status;
    await expect(parse('dom:{"selector":"#send","providerId":"../escape"}')).rejects.toThrow(/providerId/);
    await expect(parse('dom:{"selector":"#send","providerId":"ok_1"}')).resolves.toBe("SUCCESS");
  });
});
