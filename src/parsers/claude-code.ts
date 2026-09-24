import type { ParsedMessage, ParsedSession, TranscriptParser } from "./types";

/**
 * Parser for Claude Code's own session transcript format.
 *
 * Real files of this shape were inspected on-disk under
 * `~/.claude/projects/<project-hash>/<session-uuid>.jsonl` to build this
 * parser (read-only, format inspection only -- no transcript content from
 * that inspection is embedded here). Each line is a standalone JSON object.
 * Observed line `type`s include:
 *
 *   - "user"      { message: { role: "user", content: string | Block[] }, timestamp, sessionId, uuid, isMeta?, origin? }
 *   - "assistant" { message: { role: "assistant", content: Block[], model, usage }, timestamp, sessionId, uuid }
 *   - "attachment"          -- injected system-reminders / tool & skill listings / env info (plumbing, not conversation)
 *   - "queue-operation"     -- internal enqueue/dequeue bookkeeping
 *   - "file-history-snapshot" -- editor file-snapshot bookkeeping
 *   - "atis-latch"          -- internal bookkeeping, no useful text
 *   - "last-prompt"         -- redundant cache of the most recent human prompt text
 *   - "ai-title"            -- { aiTitle: string } a short human-readable session title
 *   - "summary"             -- { summary: string } seen in compacted/older sessions
 *
 * Content blocks inside `message.content` arrays include (at least):
 *   { type: "text", text }
 *   { type: "thinking", thinking, signature }
 *   { type: "tool_use", id, name, input }
 *   { type: "tool_result", tool_use_id, content, is_error }
 *
 * This parser is deliberately tolerant: unknown line types and unknown
 * block types are skipped rather than throwing, since the live format keeps
 * growing new attachment/bookkeeping variants.
 */

interface AnyRecord {
  [key: string]: unknown;
}

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Flatten a message.content value (string or block array) into text pieces. */
function flattenContentBlocks(content: unknown): Array<{ kind: string; toolName?: string; text: string }> {
  if (typeof content === "string") {
    return content.trim() ? [{ kind: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const out: Array<{ kind: string; toolName?: string; text: string }> = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const type = asString(block.type);
    if (type === "text") {
      const text = asString(block.text);
      if (text && text.trim()) out.push({ kind: "text", text });
    } else if (type === "thinking") {
      const text = asString(block.thinking);
      if (text && text.trim()) out.push({ kind: "thinking", text });
    } else if (type === "tool_use") {
      const name = asString(block.name) ?? "unknown_tool";
      let inputStr = "";
      try {
        inputStr = JSON.stringify(block.input ?? {});
      } catch {
        inputStr = String(block.input);
      }
      if (inputStr.length > 4000) inputStr = inputStr.slice(0, 4000) + "…";
      out.push({ kind: "tool_use", toolName: name, text: `${name} ${inputStr}`.trim() });
    } else if (type === "tool_result") {
      const text = stringifyToolResultContent(block.content);
      if (text.trim()) {
        const clipped = text.length > 4000 ? text.slice(0, 4000) + "…" : text;
        out.push({ kind: "tool_result", text: clipped });
      }
    }
    // Unknown block types (e.g. images, redacted_thinking) are skipped.
  }
  return out;
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export const claudeCodeParser: TranscriptParser = {
  id: "claude-code-jsonl",
  label: "Claude Code session transcript (JSONL)",

  sniff(sampleLines: string[]): boolean {
    for (const line of sampleLines) {
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(obj)) continue;
      const type = asString(obj.type);
      const hasSessionId = typeof obj.sessionId === "string";
      const looksLikeMessageEnvelope =
        (type === "user" || type === "assistant") &&
        isRecord(obj.message) &&
        (asString((obj.message as AnyRecord).role) === "user" ||
          asString((obj.message as AnyRecord).role) === "assistant");
      if (hasSessionId && (looksLikeMessageEnvelope || type === "ai-title" || type === "attachment")) {
        return true;
      }
    }
    return false;
  },

  parse(rawContent: string, _filePath: string): ParsedSession {
    const lines = rawContent.split("\n");
    const messages: ParsedMessage[] = [];
    let sessionUuid: string | undefined;
    let title: string | undefined;
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
        continue; // tolerate a corrupt/truncated trailing line
      }
      if (!isRecord(obj)) continue;

      const type = asString(obj.type);
      const ts = asString(obj.timestamp);
      if (typeof obj.sessionId === "string" && !sessionUuid) sessionUuid = obj.sessionId;
      if (ts) {
        if (!startedAt || ts < startedAt) startedAt = ts;
        if (!endedAt || ts > endedAt) endedAt = ts;
      }

      if (type === "ai-title") {
        const t = asString(obj.aiTitle);
        if (t) title = t;
        continue;
      }

      if (type === "summary") {
        const s = asString(obj.summary);
        if (s && s.trim()) {
          messages.push({ lineNo, role: "system", kind: "summary", timestamp: ts, text: s });
        }
        continue;
      }

      if (type !== "user" && type !== "assistant") {
        // attachment / queue-operation / file-history-snapshot / atis-latch /
        // last-prompt / anything future-and-unknown: plumbing, not conversation.
        continue;
      }

      const message = obj.message;
      if (!isRecord(message)) continue;
      const role = asString(message.role) ?? type;
      const uuid = asString(obj.uuid);
      const isMeta = obj.isMeta === true;

      // Skip synthetic/meta user turns (slash-command bodies, injected skill
      // text, etc.) -- they are prompt plumbing, not something a human typed
      // or the agent said, and they tend to be huge boilerplate blocks.
      if (isMeta) continue;

      const blocks = flattenContentBlocks(message.content);
      for (const b of blocks) {
        messages.push({
          lineNo,
          uuid,
          role,
          kind: b.kind,
          toolName: b.toolName,
          timestamp: ts,
          text: b.text,
        });
      }
    }

    return {
      format: claudeCodeParser.id,
      sessionUuid,
      title,
      startedAt,
      endedAt,
      messages,
    };
  },
};
