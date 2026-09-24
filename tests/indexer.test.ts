import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "../src/db/schema";
import { indexDirectory } from "../src/indexer";
import { getStats } from "../src/db/store";
import { copyFixtures, makeTempDir } from "./helpers";

const ALL_FIXTURES = [
  "session-alpha.jsonl",
  "session-beta.jsonl",
  "session-unrelated.jsonl",
  "session-generic.jsonl",
];

describe("indexDirectory", () => {
  let srcDir: string;
  let dbDir: string;
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    srcDir = makeTempDir("sessionmemex-src-");
    dbDir = makeTempDir("sessionmemex-db-");
    dbPath = path.join(dbDir, "index.db");
    copyFixtures(ALL_FIXTURES, srcDir);
    db = openDb(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it("parses every fixture, including the generic fallback format, into sessions + messages", () => {
    const summary = indexDirectory(db, srcDir);

    expect(summary.scanned).toBe(4);
    expect(summary.indexed).toBe(4);
    expect(summary.updated).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.unsupported).toBe(0);
    expect(summary.totalMessages).toBeGreaterThan(0);

    const stats = getStats(db);
    expect(stats.sessionCount).toBe(4);
    expect(stats.messageCount).toBe(summary.totalMessages);

    const byFormat = new Map(stats.byFormat.map((f) => [f.format, f.count]));
    expect(byFormat.get("claude-code-jsonl")).toBe(3);
    expect(byFormat.get("generic-jsonl")).toBe(1);
  });

  it("captures the ai-title line as the session's title", () => {
    indexDirectory(db, srcDir);
    const row = db
      .prepare(`SELECT title FROM sessions WHERE file_path LIKE ?`)
      .get("%session-alpha.jsonl") as { title: string };
    expect(row.title).toBe("Fix flaky debounce test with fake timers");
  });

  it("records tool_use messages with their tool name", () => {
    indexDirectory(db, srcDir);
    const rows = db
      .prepare(`SELECT tool_name, text FROM messages WHERE kind = 'tool_use' AND tool_name = 'Edit'`)
      .all() as Array<{ tool_name: string; text: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.text.includes("Edit"))).toBe(true);
  });

  it("excludes isMeta user turns and attachment plumbing from indexed messages", () => {
    indexDirectory(db, srcDir);
    const hit = db
      .prepare(`SELECT COUNT(*) AS n FROM messages WHERE text LIKE '%ignore-this-boilerplate-skill-text%'`)
      .get() as { n: number };
    expect(hit.n).toBe(0);
  });

  it("assigns the generic parser's format to a flat role/content JSONL file", () => {
    indexDirectory(db, srcDir);
    const row = db
      .prepare(`SELECT format FROM sessions WHERE file_path LIKE ?`)
      .get("%session-generic.jsonl") as { format: string };
    expect(row.format).toBe("generic-jsonl");
  });
});
