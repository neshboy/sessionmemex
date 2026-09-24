/** One searchable unit extracted from a transcript file. */
export interface ParsedMessage {
  /** 1-based line number in the source file, used for stable ordering and debugging. */
  lineNo: number;
  /** Original message uuid, when the format has one. */
  uuid?: string;
  /** Coarse speaker: "user" | "assistant" | "system" | "tool" ... (format-defined). */
  role: string;
  /** Content shape: "text" | "thinking" | "tool_use" | "tool_result" | "summary" ... */
  kind: string;
  /** Populated when kind === "tool_use" (or a tool_result we could attribute). */
  toolName?: string;
  /** ISO-8601 timestamp, when the format provides one. */
  timestamp?: string;
  /** Flattened, human-readable, searchable text. Never empty for an emitted message. */
  text: string;
}

/** One parsed transcript file (usually one "session"). */
export interface ParsedSession {
  /** Identifier of the parser/format that produced this, e.g. "claude-code-jsonl". */
  format: string;
  /** Session id from the transcript itself, if present. */
  sessionUuid?: string;
  /** A human-friendly title for the session, if the format provides or implies one. */
  title?: string;
  startedAt?: string;
  endedAt?: string;
  messages: ParsedMessage[];
}

/**
 * A pluggable transcript format parser. Implementations should be cheap to
 * sniff (no full parse) and tolerant of unknown/future fields in real data.
 */
export interface TranscriptParser {
  /** Stable identifier, stored on every indexed session as `format`. */
  id: string;
  /** Human-readable label for CLI output / README. */
  label: string;
  /**
   * Quick, best-effort detection based on a handful of raw lines from the
   * file (already filtered for blank lines). Should not throw on garbage
   * input -- return false instead.
   */
  sniff(sampleLines: string[]): boolean;
  /** Parse full file content (already read as a utf8 string) into a ParsedSession. */
  parse(rawContent: string, filePath: string): ParsedSession;
}
