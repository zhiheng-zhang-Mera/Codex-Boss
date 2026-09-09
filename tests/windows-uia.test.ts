import { expect, it } from "vitest";
import { parseUiaTarget, WindowsUiaBackend } from "../electron/computer/backends/windows-uia";
it("requires a bounded exact process selector and rejects injected launch arguments", () => {
  expect(parseUiaTarget('uia:{"processId":123,"automationId":"editor"}')).toEqual({ processId: 123, automationId: "editor" });
  expect(() => parseUiaTarget('uia:{"processId":0}')).toThrow();
  expect(() => parseUiaTarget('uia:{"processId":123,"command":"anything"}')).toThrow();
  expect(new WindowsUiaBackend({}, "win32").supports({ name: "open_app", target: "arbitrary.exe" })).toBe(false);
  expect(new WindowsUiaBackend({}, "linux").supports({ name: "find_control", target: 'uia:{"processId":123}' })).toBe(false);
});
