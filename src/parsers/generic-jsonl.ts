import type { ParsedMessage, ParsedSession, TranscriptParser } from "./types";

/**
 * Fallback parser for "plain" JSONL/JSON transcripts that don't match the
 * Claude Code envelope: one JSON object per line with a flat
 * `{ role, content|text, timestamp? }` shape. This is a common shape for
 * hand-rolled logs and is intended as a template for adding real parsers
 * for other tools (Cursor, Cline, ...) later -- swap the sniff/parse bodies
 * for the real format once you have sample files to inspect.
 *
 * Always tried last by the registry, since it is intentionally permissive.
 */

interface AnyRecord {
  [key: string]: unknown;
}

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractText(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const parts = v
      .map((c) => {
        if (typeof c === "string") return c;
        if (isRecord(c) && typeof c.text === "string") return c.text;
        return "";
      })
      .filter(Boolean);
    return parts.length ? parts.join("\n") : undefined;
  }
  return undefined;
}

export const genericJsonlParser: TranscriptParser = {
  id: "generic-jsonl",
  label: "Generic flat JSONL transcript (role/content per line)",

  sniff(sampleLines: string[]): boolean {
    let sawCandidate = false;
    for (const line of sampleLines) {
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(obj)) continue;
      const role = obj.role;
      const text = obj.content ?? obj.text ?? obj.message;
      if (typeof role === "string" && (typeof text === "string" || Array.isArray(text))) {
        sawCandidate = true;
      }
    }
    return sawCandidate;
  },

  parse(rawContent: string, _filePath: string): ParsedSession {
    const lines = rawContent.split("\n");
    const messages: ParsedMessage[] = [];
    let startedAt: string | undefined;
    let endedAt: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw || !raw.trim()) continue;
      const lineNo = i + 1;
      let obj: unknown;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isRecord(obj)) continue;

      const role = typeof obj.role === "string" ? obj.role : "unknown";
      const text = extractText(obj.content ?? obj.text ?? obj.message);
      const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
      if (ts) {
        if (!startedAt || ts < startedAt) startedAt = ts;
        if (!endedAt || ts > endedAt) endedAt = ts;
      }
      if (!text || !text.trim()) continue;

      messages.push({ lineNo, role, kind: "text", timestamp: ts, text });
    }

    return {
      format: genericJsonlParser.id,
      startedAt,
      endedAt,
      messages,
    };
  },
};
