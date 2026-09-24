import * as fs from "node:fs";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { detectParser } from "./parsers/registry";
import { findSessionByPath, insertSession, deleteSession, touchSession } from "./db/store";
import { sha256 } from "./util/hash";

export interface IndexOptions {
  /** Called for each file as it's decided/processed, for CLI progress output. */
  onFile?: (event: FileEvent) => void;
}

export type FileEventStatus = "indexed" | "updated" | "unchanged" | "touched" | "unsupported" | "error";

export interface FileEvent {
  filePath: string;
  status: FileEventStatus;
  messageCount?: number;
  error?: string;
}

export interface IndexSummary {
  scanned: number;
  indexed: number;
  updated: number;
  unchanged: number;
  touched: number;
  unsupported: number;
  errors: number;
  totalMessages: number;
}

const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);

function walkJsonlFiles(root: string): string[] {
  const results: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory, skip
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        stack.push(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(path.join(dir, entry.name));
      }
    }
  }
  return results.sort();
}

/**
 * Index (incrementally) every *.jsonl transcript file under `rootDir` into `db`.
 * Files whose mtime+size match what's already stored are skipped without
 * being read; files whose content hash matches a prior index are left as-is
 * (only bookkeeping columns are refreshed) so a mtime-only touch doesn't
 * trigger a needless re-parse.
 */
export function indexDirectory(db: DatabaseSync, rootDir: string, opts: IndexOptions = {}): IndexSummary {
  const summary: IndexSummary = {
    scanned: 0,
    indexed: 0,
    updated: 0,
    unchanged: 0,
    touched: 0,
    unsupported: 0,
    errors: 0,
    totalMessages: 0,
  };

  if (!fs.existsSync(rootDir)) {
    return summary;
  }

  const files = walkJsonlFiles(rootDir);

  for (const filePath of files) {
    summary.scanned++;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      summary.errors++;
      opts.onFile?.({ filePath, status: "error", error: String(err) });
      continue;
    }

    const existing = findSessionByPath(db, filePath);
    const indexedAt = new Date().toISOString();

    if (existing && existing.mtime_ms === stat.mtimeMs && existing.size_bytes === stat.size) {
      summary.unchanged++;
      opts.onFile?.({ filePath, status: "unchanged" });
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      summary.errors++;
      opts.onFile?.({ filePath, status: "error", error: String(err) });
      continue;
    }

    const hash = sha256(content);

    if (existing && existing.content_hash === hash) {
      // Content identical (e.g. file was touched/copied) -- just refresh bookkeeping.
      touchSession(db, existing.id, stat.mtimeMs, stat.size, indexedAt);
      summary.touched++;
      opts.onFile?.({ filePath, status: "touched" });
      continue;
    }

    const sampleLines = content.split("\n").filter((l) => l.trim()).slice(0, 20);
    const parser = detectParser(sampleLines);
    if (!parser) {
      summary.unsupported++;
      opts.onFile?.({ filePath, status: "unsupported" });
      continue;
    }

    let parsed;
    try {
      parsed = parser.parse(content, filePath);
    } catch (err) {
      summary.errors++;
      opts.onFile?.({ filePath, status: "error", error: String(err) });
      continue;
    }

    db.exec("BEGIN");
    try {
      if (existing) {
        deleteSession(db, existing.id);
      }
      const { messageCount } = insertSession(
        db,
        filePath,
        parsed,
        stat.mtimeMs,
        stat.size,
        hash,
        indexedAt,
      );
      db.exec("COMMIT");
      summary.totalMessages += messageCount;
      if (existing) {
        summary.updated++;
        opts.onFile?.({ filePath, status: "updated", messageCount });
      } else {
        summary.indexed++;
        opts.onFile?.({ filePath, status: "indexed", messageCount });
      }
    } catch (err) {
      db.exec("ROLLBACK");
      summary.errors++;
      opts.onFile?.({ filePath, status: "error", error: String(err) });
    }
  }

  return summary;
}
