import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StateStore } from "../electron/store";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("StateStore persistence", () => {
  it("falls back to copy-replace when Windows rejects the atomic rename", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-store-"));
    temporaryDirectories.push(directory);
    const statePath = path.join(directory, "state.json");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    });

    const store = new StateStore(statePath);
    store.createTask("test", "evidence", ["chatgpt"]);

    expect(JSON.parse(fs.readFileSync(statePath, "utf8")).tasks[0].title).toBe("test");
    expect(fs.existsSync(`${statePath}.tmp`)).toBe(false);
  });
});
