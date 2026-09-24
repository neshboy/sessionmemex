import type { DatabaseSync } from "node:sqlite";
import { HIGHLIGHT_START, HIGHLIGHT_END } from "./util/ansi";

export interface SearchResult {
  messageId: number;
  filePath: string;
  title: string | null;
  role: string;
  kind: string;
  toolName: string | null;
  timestamp: string | null;
  snippet: string;
  rank: number;
}

/**
 * Turn free-text user input into a safe FTS5 MATCH query: each whitespace
 * token is treated as a literal quoted term (so punctuation like `:` or `-`
 * inside a token can't be misread as FTS5 query syntax) and terms are
 * ANDed together. A single quoted phrase from the user (`"exact phrase"`)
 * is passed through as one literal phrase.
 */
export function buildMatchQuery(userQuery: string): string {
  const trimmed = userQuery.trim();
  if (!trimmed) return "";

  // Respect a single fully-quoted phrase from the user as-is.
  const phraseMatch = trimmed.match(/^"(.*)"$/);
  if (phraseMatch) {
    return `"${phraseMatch[1].replace(/"/g, '""')}"`;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
}

export function search(db: DatabaseSync, userQuery: string, limit = 20): SearchResult[] {
  const matchQuery = buildMatchQuery(userQuery);
  if (!matchQuery) return [];

  const stmt = db.prepare(`
    SELECT
      m.id AS messageId,
      s.file_path AS filePath,
      s.title AS title,
      m.role AS role,
      m.kind AS kind,
      m.tool_name AS toolName,
      m.timestamp AS timestamp,
      snippet(messages_fts, 0, ?, ?, '…', 12) AS snippet,
      bm25(messages_fts) AS rank
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    JOIN sessions s ON s.id = m.session_id
    WHERE messages_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  const rows = stmt.all(HIGHLIGHT_START, HIGHLIGHT_END, matchQuery, limit) as Array<{
    messageId: number;
    filePath: string;
    title: string | null;
    role: string;
    kind: string;
    toolName: string | null;
    timestamp: string | null;
    snippet: string;
    rank: number;
  }>;

  return rows.map((r) => ({ ...r }));
}
