import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExternalSessionLedger } from "../../electron/workspace/external-session-ledger";
import { automatePendingExternalArchives } from "../../electron/workspace/external-archive-automation";
import { createLiveExternalArchiveAttempt } from "../../electron/workspace/live-external-archive";
import type { ExternalSessionRecord } from "../../src/shared/external-session";

function ledgerAt(): ExternalSessionLedger {
  return new ExternalSessionLedger(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "boss-ext-")), "sessions.json"));
}

function seedPending(ledger: ExternalSessionLedger, ids: string[]) {
  for (const id of ids) {
    ledger.upsert({ taskId: id, providerId: "chatgpt", remoteConversationUrl: `https://chatgpt.example/c/${id}` });
    ledger.deferArchive(id, "chatgpt", "task finished; pending verification");
  }
}

describe("external archive automation (Overcomplete §11.3/§11.4)", () => {
  it("marks ARCHIVED only when the page-state attempt verifies; keeps the rest pending and never deletes", async () => {
    const ledger = ledgerAt();
    seedPending(ledger, ["t1", "t2", "t3"]);
    let calls = 0;
    const result = await automatePendingExternalArchives(ledger, async (record) => {
      calls++;
      return record.taskId === "t3" ? { archived: false, note: "rate limited" } : { archived: true, note: "verified archived" };
    }, { limit: 10 });
    expect(result.archived).toBe(2);
    expect(result.deferred).toBe(1);
    expect(result.remainingPending).toBe(1);
    expect(ledger.list().length).toBe(3); // never auto-deleted
    const archived = ledger.list().filter((record) => record.status === "ARCHIVED");
    expect(archived.map((record) => record.taskId).sort()).toEqual(["t1", "t2"]);
    expect(archived.every((record) => record.archived_at)).toBe(true);
    const pending = ledger.list().find((record) => record.taskId === "t3");
    expect(pending?.status).toBe("ARCHIVE_PENDING");
    expect(pending?.archiveNote).toContain("rate limited");
  });

  it("bounded limit processes oldest rows first and defers on a throwing attempt", async () => {
    const ledger = ledgerAt();
    seedPending(ledger, ["t1", "t2", "t3"]);
    const result = await automatePendingExternalArchives(ledger, async (record) => {
      if (record.taskId === "t1") throw new Error("page gone");
      return { archived: true, note: "ok" };
    }, { limit: 2 });
    // t1 errored (deferred), t2 archived; t3 not reached by the bound.
    expect(result.attempted).toBe(2);
    expect(result.archived).toBe(1);
    expect(ledger.pending().map((record) => record.taskId).sort()).toEqual(["t1", "t3"]);
  });
});

describe("live archive attempt gate (fail closed)", () => {
  it("defers when the provider window is closed or the account is auth-blocked", async () => {
    const attempt = createLiveExternalArchiveAttempt({
      windowOpen: () => false,
      accountMode: () => "READY"
    });
    const record = { taskId: "t", providerId: "chatgpt", status: "ARCHIVE_PENDING" as const, created_at: new Date(0).toISOString(), schemaVersion: 1 as const };
    const outcome = await attempt(record as unknown as ExternalSessionRecord);
    expect(outcome.archived).toBe(false);
    expect(outcome.note).toContain("window is closed");
    const auth = createLiveExternalArchiveAttempt({ windowOpen: () => true, accountMode: () => "AUTH_REQUIRED" });
    expect((await auth(record as unknown as ExternalSessionRecord)).note).toContain("AUTH_REQUIRED");
  });

  it("reports archived ONLY through the verified per-provider adapter; otherwise stays UNSUPPORTED/pending", async () => {
    const verified = createLiveExternalArchiveAttempt({ windowOpen: () => true, accountMode: () => "READY", performArchive: async () => ({ archived: true, note: "page shows conversation archived" }) });
    const record = { taskId: "t", providerId: "gemini", status: "ARCHIVE_PENDING" as const, created_at: new Date(0).toISOString(), schemaVersion: 1 as const };
    expect(await verified(record as unknown as ExternalSessionRecord)).toEqual({ archived: true, note: "page shows conversation archived" });
    const unsupported = createLiveExternalArchiveAttempt({ windowOpen: () => true, accountMode: () => "READY" });
    const outcome = await unsupported(record as unknown as ExternalSessionRecord);
    expect(outcome.archived).toBe(false);
    expect(outcome.note).toContain("UNSUPPORTED");
  });
});
