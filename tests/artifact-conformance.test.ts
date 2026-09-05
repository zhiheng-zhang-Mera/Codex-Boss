import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "../electron/store";
import { buildEvidenceBundle } from "../electron/evidence-engine";
import type { BossTask, CouncilSession, RawArtifact } from "../src/shared/contracts";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-artifact-")); dirs.push(dir); return dir; }
function hash(content: string) { return createHash("sha256").update(content, "utf8").digest("hex"); }

describe("artifact schema conformance", () => {
  it("records contentHash, producer, version and classification at capture", () => {
    const dir = root();
    const file = path.join(dir, "state.json");
    const store = new StateStore(file);
    const task = store.createTask("t", "question", ["chatgpt"], "direct", "chat");
    const run = store.runsForTask(task.id)[0];
    const artifact = store.captureArtifact(run.id, "provider answer", "https://chatgpt.com/c/x");
    expect(artifact.version).toBe(1);
    expect(artifact.contentHash).toBe(hash(artifact.content));
    expect(artifact.producer).toBe("web:chatgpt");
    expect(artifact.classification).toBe("INTERNAL");
    expect(artifact.untrusted).toBe(true);
    // Stored artifact keeps conformance fields across restart.
    const restored = new StateStore(file).snapshot().artifacts.find((item) => item.id === artifact.id)!;
    expect(restored.contentHash).toBe(artifact.contentHash);
    expect(restored.producer).toBe("web:chatgpt");
  });

  it("marks local native artifacts with the local:native producer", () => {
    const store = new StateStore(path.join(root(), "state.json"));
    const task = store.createTask("t", "read file README.md", ["native:tools"], "direct", "chat");
    const run = store.runsForTask(task.id)[0];
    const artifact = store.captureArtifact(run.id, "file contents", "local:native");
    expect(artifact.producer).toBe("local:native");
  });
});

describe("evidence trust and verify content hash", () => {
  const task: BossTask = { id: "task", title: "verify", prompt: "question", providerIds: ["chatgpt"], status: "completed", mode: "direct", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  const council: CouncilSession | undefined = undefined;

  it("uses the artifact's stored content hash in the manifest", () => {
    const artifact: RawArtifact = { id: "a", taskId: task.id, runId: "run-a", providerId: "chatgpt", kind: "response", content: "answer", capturedAt: task.createdAt, sourceUrl: "https://example.test", untrusted: true, version: 1, contentHash: hash("answer"), producer: "web:chatgpt", classification: "INTERNAL" };
    const bundle = buildEvidenceBundle(task, [artifact], council);
    expect(bundle.manifest[0].sha256).toBe(hash("answer"));
  });

  it("fails closed when stored content hash no longer matches the content", () => {
    const artifact: RawArtifact = { id: "a", taskId: task.id, runId: "run-a", providerId: "chatgpt", kind: "response", content: "answer", capturedAt: task.createdAt, sourceUrl: "https://example.test", untrusted: true, contentHash: hash("tampered") };
    expect(() => buildEvidenceBundle(task, [artifact], council)).toThrow(/content hash mismatch/);
  });

  it("still accepts legacy artifacts without conformance fields by computing the hash", () => {
    const artifact: RawArtifact = { id: "a", taskId: task.id, runId: "run-a", providerId: "chatgpt", kind: "response", content: "answer", capturedAt: task.createdAt, sourceUrl: "https://example.test", untrusted: true };
    const bundle = buildEvidenceBundle(task, [artifact], council);
    expect(bundle.manifest[0].sha256).toBe(hash("answer"));
  });
});
