import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "../src/db/schema";
import { indexDirectory } from "../src/indexer";
import { search } from "../src/search";
import { copyFixtures, makeTempDir } from "./helpers";

describe("search", () => {
  let srcDir: string;
  let dbDir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    srcDir = makeTempDir("sessionmemex-src-");
    dbDir = makeTempDir("sessionmemex-db-");
    copyFixtures(["session-alpha.jsonl", "session-beta.jsonl", "session-unrelated.jsonl"], srcDir);
    db = openDb(path.join(dbDir, "index.db"));
    indexDirectory(db, srcDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it("finds the flaky-timer fix session for a relevant query", () => {
    const results = search(db, "flaky debounce timer");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.filePath.endsWith("session-alpha.jsonl"))).toBe(true);
  });

  it("finds the postgres connection-pool session for a relevant query", () => {
    const results = search(db, "connection pool exhausted");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.filePath.endsWith("session-beta.jsonl"))).toBe(true);
  });

  it("does not return the unrelated CSS-rename session for a postgres query", () => {
    const results = search(db, "postgres");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.filePath.endsWith("session-unrelated.jsonl"))).toBe(false);
  });

  it("finds the CSS-rename session for its own topic and nothing else", () => {
    const results = search(db, "brand-blue color-primary");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.filePath.endsWith("session-unrelated.jsonl"))).toBe(true);
  });

  it("returns no results for a query that matches nothing indexed", () => {
    const results = search(db, "xylophone-quantum-teapot-nonsense");
    expect(results).toHaveLength(0);
  });

  it("wraps the matched term in highlight markers in the snippet", () => {
    const results = search(db, "debounce");
    expect(results.length).toBeGreaterThan(0);
    // In non-TTY test runs, ansi.ts falls back to plain [[ ]] markers.
    expect(results[0].snippet).toMatch(/\[\[debounce\]\]/i);
  });

  it("ranks results so the best match for a query comes first", () => {
    const results = search(db, "fake timers");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filePath.endsWith("session-alpha.jsonl")).toBe(true);
  });
});
