import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "../src/db/schema";
import { indexDirectory } from "../src/indexer";
import { getStats } from "../src/db/store";
import { copyFixtures, makeTempDir } from "./helpers";

describe("incremental re-indexing", () => {
  let srcDir: string;
  let dbDir: string;
  let dbPath: string;
  let db: DatabaseSync;
  let alphaPath: string;

  beforeEach(() => {
    srcDir = makeTempDir("sessionmemex-src-");
    dbDir = makeTempDir("sessionmemex-db-");
    dbPath = path.join(dbDir, "index.db");
    copyFixtures(["session-alpha.jsonl", "session-beta.jsonl", "session-unrelated.jsonl"], srcDir);
    alphaPath = path.join(srcDir, "session-alpha.jsonl");
    db = openDb(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it("does not re-parse unchanged files on a second run", () => {
    const first = indexDirectory(db, srcDir);
    expect(first.indexed).toBe(3);

    const second = indexDirectory(db, srcDir);
    expect(second.indexed).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(3);
    expect(second.totalMessages).toBe(0);

    // message count in the DB must be stable, not doubled.
    const stats = getStats(db);
    expect(stats.sessionCount).toBe(3);
  });

  it("only re-parses the file whose content actually changed", () => {
    indexDirectory(db, srcDir);
    const before = getStats(db);

    // Append a new exchange to session-alpha only.
    const extra =
      '\n{"parentUuid":"asst6","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Also added a regression comment explaining the fake-timer fix."}]},"uuid":"asst7x","timestamp":"2026-01-05T09:00:12.000Z","sessionId":"aaaaaaaa-0000-4000-8000-000000000001"}\n';
    fs.appendFileSync(alphaPath, extra);
    // Force a distinct mtime in case the filesystem's clock resolution is coarse.
    const bumped = new Date(Date.now() + 5000);
    fs.utimesSync(alphaPath, bumped, bumped);

    const second = indexDirectory(db, srcDir);
    expect(second.indexed).toBe(0);
    expect(second.updated).toBe(1);
    expect(second.unchanged).toBe(2);

    const after = getStats(db);
    expect(after.sessionCount).toBe(before.sessionCount);
    expect(after.messageCount).toBeGreaterThan(before.messageCount);

    const alphaRow = db
      .prepare(`SELECT message_count FROM sessions WHERE file_path = ?`)
      .get(alphaPath) as { message_count: number };
    // Re-parsed session should reflect the new message, not have stale duplicates
    // from the old parse still lying around.
    const actualCount = db
      .prepare(`SELECT COUNT(*) AS n FROM messages WHERE session_id = (SELECT id FROM sessions WHERE file_path = ?)`)
      .get(alphaPath) as { n: number };
    expect(actualCount.n).toBe(alphaRow.message_count);
  });

  it("treats a mtime-only touch (identical content) as a cheap bookkeeping update, not a re-parse", () => {
    indexDirectory(db, srcDir);
    const before = db.prepare(`SELECT * FROM sessions WHERE file_path = ?`).get(alphaPath) as {
      id: number;
      mtime_ms: number;
      content_hash: string;
    };

    // Rewrite the exact same bytes, which changes mtime but not the hash.
    const content = fs.readFileSync(alphaPath, "utf8");
    fs.writeFileSync(alphaPath, content);
    const bumped = new Date(Date.now() + 9000);
    fs.utimesSync(alphaPath, bumped, bumped);

    const summary = indexDirectory(db, srcDir);
    expect(summary.touched).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.indexed).toBe(0);

    const after = db.prepare(`SELECT * FROM sessions WHERE file_path = ?`).get(alphaPath) as {
      id: number;
      mtime_ms: number;
      content_hash: string;
    };
    expect(after.id).toBe(before.id);
    expect(after.content_hash).toBe(before.content_hash);
    expect(after.mtime_ms).not.toBe(before.mtime_ms);
  });
});
