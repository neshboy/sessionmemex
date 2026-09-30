import type { DatabaseSync } from "node:sqlite";
import type { ParsedSession } from "../parsers/types";

export interface SessionRow {
  id: number;
  file_path: string;
  format: string;
  session_uuid: string | null;
  title: string | null;
  started_at: string | null;
  ended_at: string | null;
  message_count: number;
  mtime_ms: number;
  size_bytes: number;
  content_hash: string;
  indexed_at: string;
}

export function findSessionByPath(db: DatabaseSync, filePath: string): SessionRow | undefined {
  const row = db.prepare(`SELECT * FROM sessions WHERE file_path = ?`).get(filePath) as
    | SessionRow
    | undefined;
  return row;
}

/** List the id + file_path of every indexed session, for reconciling against files still on disk. */
export function listSessionFilePaths(db: DatabaseSync): Array<{ id: number; file_path: string }> {
  return db.prepare(`SELECT id, file_path FROM sessions`).all() as Array<{
    id: number;
    file_path: string;
  }>;
}

/** Remove a session and all of its messages (FTS rows included). Caller manages the transaction. */
export function deleteSession(db: DatabaseSync, sessionId: number): void {
  db.prepare(
    `DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE session_id = ?)`,
  ).run(sessionId);
  db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

/** Update just the bookkeeping columns (used when content is unchanged but mtime moved). */
export function touchSession(
  db: DatabaseSync,
  sessionId: number,
  mtimeMs: number,
  sizeBytes: number,
  indexedAt: string,
): void {
  db.prepare(
    `UPDATE sessions SET mtime_ms = ?, size_bytes = ?, indexed_at = ? WHERE id = ?`,
  ).run(mtimeMs, sizeBytes, indexedAt, sessionId);
}

/**
 * Insert a freshly parsed session and its messages (plus matching FTS rows).
 * Caller is responsible for having already deleted any prior row for this
 * file_path, and for wrapping this in a transaction alongside that delete.
 */
export function insertSession(
  db: DatabaseSync,
  filePath: string,
  parsed: ParsedSession,
  mtimeMs: number,
  sizeBytes: number,
  contentHash: string,
  indexedAt: string,
): { sessionId: number; messageCount: number } {
  const insertSessionStmt = db.prepare(`
    INSERT INTO sessions
      (file_path, format, session_uuid, title, started_at, ended_at, message_count, mtime_ms, size_bytes, content_hash, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = insertSessionStmt.run(
    filePath,
    parsed.format,
    parsed.sessionUuid ?? null,
    parsed.title ?? null,
    parsed.startedAt ?? null,
    parsed.endedAt ?? null,
    parsed.messages.length,
    mtimeMs,
    sizeBytes,
    contentHash,
    indexedAt,
  );
  const sessionId = Number(info.lastInsertRowid);

  const insertMessageStmt = db.prepare(`
    INSERT INTO messages (session_id, line_no, uuid, role, kind, tool_name, timestamp, text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFtsStmt = db.prepare(`INSERT INTO messages_fts (rowid, text) VALUES (?, ?)`);

  for (const m of parsed.messages) {
    const res = insertMessageStmt.run(
      sessionId,
      m.lineNo,
      m.uuid ?? null,
      m.role,
      m.kind,
      m.toolName ?? null,
      m.timestamp ?? null,
      m.text,
    );
    insertFtsStmt.run(Number(res.lastInsertRowid), m.text);
  }

  return { sessionId, messageCount: parsed.messages.length };
}

export interface Stats {
  sessionCount: number;
  messageCount: number;
  byKind: Array<{ kind: string; count: number }>;
  byFormat: Array<{ format: string; count: number }>;
  earliest: string | null;
  latest: string | null;
}

export function getStats(db: DatabaseSync): Stats {
  const sessionCount = (db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }).n;
  const messageCount = (db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as { n: number }).n;
  const byKind = db
    .prepare(`SELECT kind, COUNT(*) AS count FROM messages GROUP BY kind ORDER BY count DESC`)
    .all() as Array<{ kind: string; count: number }>;
  const byFormat = db
    .prepare(`SELECT format, COUNT(*) AS count FROM sessions GROUP BY format ORDER BY count DESC`)
    .all() as Array<{ format: string; count: number }>;
  const range = db
    .prepare(`SELECT MIN(started_at) AS earliest, MAX(ended_at) AS latest FROM sessions`)
    .get() as { earliest: string | null; latest: string | null };

  return {
    sessionCount,
    messageCount,
    byKind,
    byFormat,
    earliest: range.earliest,
    latest: range.latest,
  };
}
