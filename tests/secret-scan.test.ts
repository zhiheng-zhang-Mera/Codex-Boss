import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isTainted, redactSecrets, scanSecrets } from "../src/shared/secret-scan";
import { TelemetryStore } from "../electron/telemetry/telemetry-store";
import { attachTelemetryRecorder } from "../electron/telemetry/telemetry-recorder";
import { DomainEventBus } from "../electron/commander/event-bus";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-secretscan-")); dirs.push(dir); return dir; }

describe("secret scanner", () => {
  it("detects api keys, bearer tokens, aws keys, github tokens and private keys", () => {
    const text = [
      "sk-abcdefghijklmnopqrstuvwx1234567890",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret.payload",
      "aws AKIAIOSFODNN7EXAMPLE",
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
      "token=c2VjcmV0dmFsdWV3aXRobWFueWNoYXJz"
    ].join("\n");
    const matches = scanSecrets(text);
    const shapes = new Set(matches.map((match) => match.shape));
    expect(shapes.has("api-key-sk")).toBe(true);
    expect(shapes.has("bearer-token")).toBe(true);
    expect(shapes.has("aws-access-key")).toBe(true);
    expect(shapes.has("github-token")).toBe(true);
    expect(shapes.has("private-key")).toBe(true);
    expect(shapes.has("generic-long-token")).toBe(true);
  });

  it("leaves plain prose untainted", () => {
    expect(isTainted("quota exceeded after 3 attempts on api:x")).toBe(false);
    expect(scanSecrets("request timed out")).toEqual([]);
  });
});

describe("log sanitizer", () => {
  it("redacts every probable secret and is idempotent", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwx1234567890";
    const message = `provider refused key ${secret} with rate limit; Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret.payload`;
    const cleaned = redactSecrets(message);
    expect(cleaned).not.toContain(secret);
    expect(cleaned).toMatch(/\[REDACTED:api-key\]/);
    expect(cleaned).toMatch(/\[REDACTED:bearer-token\]/);
    expect(isTainted(cleaned)).toBe(false); // no residual secret
    expect(redactSecrets(cleaned)).toBe(cleaned); // idempotent
  });

  it("keeps normal failure reasons intact", () => {
    expect(redactSecrets("quota exceeded; retry after 60s")).toBe("quota exceeded; retry after 60s");
  });
});

describe("secret-tainted telemetry (AP30 seed)", () => {
  it("sanitizes worker failure reasons before they reach the Performance DB", () => {
    const bus = new DomainEventBus();
    const store = new TelemetryStore(path.join(root(), "telemetry.json"));
    attachTelemetryRecorder(bus, store);
    const leak = "runtime rejected sk-abcdefghijklmnopqrstuvwx1234567890";
    bus.publish({ type: "WORKER_FAILED", taskId: "t1", jobId: "j1", runtimeId: "api:x", message: leak });
    const [record] = store.list();
    expect(record.reason).toContain("[REDACTED:api-key]");
    expect(record.reason).not.toContain("sk-abcdefghijklmnopqrstuvwx1234567890");
  });

  it("keeps clean reasons untouched through the recorder", () => {
    const bus = new DomainEventBus();
    const store = new TelemetryStore(path.join(root(), "telemetry.json"));
    attachTelemetryRecorder(bus, store);
    bus.publish({ type: "WORKER_FAILED", taskId: "t2", jobId: "j2", runtimeId: "api:bad", message: "boom" });
    expect(store.list()[0].reason).toBe("boom");
  });
});
