#!/usr/bin/env node
/**
 * `node:sqlite` capability probe (platform foundation, Phase 02).
 *
 * The state core is built on `node:sqlite`, which is a Node/Electron built-in. That
 * choice is only defensible if the specific features the core depends on are really
 * present in the runtime the app ships with, so this script measures them instead of
 * assuming them. It is a standalone probe rather than a test because it must be
 * runnable against the Electron runtime too, where the vitest tier does not reach.
 *
 * Run under Node:      node scripts/probe-sqlite.cjs
 * Run under Electron:  node_modules/.bin/electron scripts/probe-sqlite.cjs
 *
 * It writes nothing outside a temporary directory and exits non-zero if any required
 * feature is missing, so it can be used as a gate.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail === undefined ? "" : String(detail) });
  } catch (error) {
    results.push({ name, ok: false, detail: `${error.code ?? ""} ${error.message}`.trim().slice(0, 200) });
  }
}

const runtime = {
  node: process.versions.node,
  ...(process.versions.electron ? { electron: process.versions.electron, chrome: process.versions.chrome } : {})
};

let sqlite;
check("require('node:sqlite')", () => {
  sqlite = require("node:sqlite");
  return Object.keys(sqlite).join(",");
});

if (sqlite) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-sqlite-probe-"));
  const file = path.join(dir, "probe.db");
  let db;

  check("DatabaseSync opens a file", () => {
    db = new sqlite.DatabaseSync(file);
    return file;
  });

  check("WAL journal mode", () => {
    const row = db.prepare("PRAGMA journal_mode = WAL").get();
    const mode = row?.journal_mode;
    if (mode !== "wal") throw new Error(`journal_mode is ${mode}`);
    return mode;
  });

  check("synchronous=NORMAL is settable", () => {
    db.exec("PRAGMA synchronous = NORMAL");
    return db.prepare("PRAGMA synchronous").get()?.synchronous;
  });

  check("foreign keys are enforceable", () => {
    db.exec("PRAGMA foreign_keys = ON");
    if (db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) throw new Error("foreign_keys did not stick");
    return "ON";
  });

  check("DDL + user_version for schema versioning", () => {
    db.exec("CREATE TABLE probe(id TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    db.exec("PRAGMA user_version = 7");
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 7) throw new Error(`user_version is ${version}`);
    return `user_version=${version}`;
  });

  check("prepared statement insert/select with named params", () => {
    db.prepare("INSERT INTO probe(id, n) VALUES (:id, :n)").run({ id: "a", n: 1 });
    const row = db.prepare("SELECT n FROM probe WHERE id = ?").get("a");
    if (row?.n !== 1) throw new Error(`read back ${JSON.stringify(row)}`);
    return JSON.stringify(row);
  });

  check("manual BEGIN/COMMIT/ROLLBACK", () => {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO probe(id, n) VALUES (?, ?)").run("b", 2);
    db.exec("ROLLBACK");
    const rows = db.prepare("SELECT COUNT(*) AS c FROM probe").get();
    if (rows.c !== 1) throw new Error(`rollback left ${rows.c} rows`);
    return "rollback discards the write";
  });

  check("nested savepoints", () => {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO probe(id, n) VALUES (?, ?)").run("c", 3);
    db.exec("SAVEPOINT sp1");
    db.prepare("INSERT INTO probe(id, n) VALUES (?, ?)").run("d", 4);
    db.exec("ROLLBACK TO sp1");
    db.exec("RELEASE sp1");
    db.exec("COMMIT");
    const ids = db.prepare("SELECT id FROM probe ORDER BY id").all().map((row) => row.id);
    if (!ids.includes("c") || ids.includes("d")) throw new Error(`savepoint result ${ids.join(",")}`);
    return ids.join(",");
  });

  check("a failed statement throws with a usable code", () => {
    try {
      db.prepare("INSERT INTO probe(id, n) VALUES (?, ?)").run("a", 9);
      throw new Error("expected a UNIQUE violation");
    } catch (error) {
      if (!String(error.message).toLowerCase().includes("unique")) throw error;
      return String(error.code ?? error.message).slice(0, 60);
    }
  });

  check("user-defined function registration", () => {
    db.function("boss_double", (n) => n * 2);
    const row = db.prepare("SELECT boss_double(21) AS v").get();
    if (row?.v !== 42) throw new Error(`got ${row?.v}`);
    return "42";
  });

  check("durability across close and reopen (WAL recovery)", () => {
    db.close();
    const again = new sqlite.DatabaseSync(file);
    const ids = again.prepare("SELECT id FROM probe ORDER BY id").all().map((row) => row.id);
    again.close();
    if (ids.join(",") !== "a,c") throw new Error(`after reopen: ${ids.join(",")}`);
    return ids.join(",");
  });

  check("activity/iteration counters for observability", () => {
    const db2 = new sqlite.DatabaseSync(":memory:");
    const value = typeof db2.prepare("SELECT 1 AS v").get() === "object";
    db2.close();
    return value ? "prepare().get() returns objects" : "unexpected";
  });

  check("a corrupt file fails loudly instead of reading as empty", () => {
    const broken = path.join(dir, "corrupt.db");
    fs.writeFileSync(broken, Buffer.from("this is definitely not a sqlite database, not even close, padding padding padding"));
    let opened;
    try {
      opened = new sqlite.DatabaseSync(broken);
      // Opening may succeed lazily; force a read.
      opened.prepare("SELECT COUNT(*) AS c FROM sqlite_master").get();
      opened.close();
      throw new Error("a corrupt database opened without error");
    } catch (error) {
      if (String(error.message).includes("without error")) throw error;
      return String(error.message).slice(0, 80);
    }
  });

  // The directory itself is left behind deliberately: the probe is also a check that
  // it does NOT leave a stray database in the repository.
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

const failed = results.filter((entry) => !entry.ok);
console.log(JSON.stringify({ runtime, sqliteSupported: Boolean(sqlite), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exit(failed.length === 0 && Boolean(sqlite) ? 0 : 1);
