import type { TranscriptParser } from "./types";
import { claudeCodeParser } from "./claude-code";
import { genericJsonlParser } from "./generic-jsonl";

/**
 * Ordered list of known parsers. More specific formats must come before
 * more permissive fallbacks -- adding a new format is just pushing another
 * TranscriptParser onto this array.
 */
export const PARSERS: TranscriptParser[] = [claudeCodeParser, genericJsonlParser];

/** Pick the first parser willing to claim this file, based on a sample of lines. */
export function detectParser(sampleLines: string[]): TranscriptParser | undefined {
  for (const parser of PARSERS) {
    try {
      if (parser.sniff(sampleLines)) return parser;
    } catch {
      // A misbehaving sniff() should not stop detection of other formats.
    }
  }
  return undefined;
}
