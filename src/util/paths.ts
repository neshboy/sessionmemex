import * as os from "node:os";
import * as path from "node:path";

/**
 * Default location where Claude Code stores session transcripts:
 *   ~/.claude/projects/<project-hash>/*.jsonl
 */
export function defaultTranscriptsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/** Default location for the SessionMemex SQLite index. */
export function defaultDbPath(): string {
  return path.join(os.homedir(), ".sessionmemex", "index.db");
}

export function defaultDbDir(): string {
  return path.join(os.homedir(), ".sessionmemex");
}
