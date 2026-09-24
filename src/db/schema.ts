import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path     TEXT UNIQUE NOT NULL,
  format        TEXT NOT NULL,
  session_uuid  TEXT,
  title         TEXT,
  started_at    TEXT,
  ended_at      TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  mtime_ms      INTEGER NOT NULL,
  size_bytes    INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,
  indexed_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  uuid        TEXT,
  role        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  tool_name   TEXT,
  timestamp   TEXT,
  text        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='id',
  tokenize='porter unicode61'
);
`;

/** Open (creating parent dir + schema if needed) the SessionMemex SQLite database. */
export function openDb(dbPath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(DDL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}
