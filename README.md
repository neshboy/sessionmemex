# SessionMemex

**Your AI pair-programmer's memory shouldn't die with the terminal window.**

SessionMemex is a local-first, full-text search engine for the transcripts your
AI coding agent (Claude Code today, others soon) leaves behind. Every session
is full of hard-won debugging steps, root causes, and fixes -- and today that
knowledge is scrollback: gone the moment you close the tab, unsearchable even
if you kept the log file. SessionMemex indexes those transcripts into one
local SQLite database so you can grep, in seconds, "wait, didn't I already fix
a bug just like this three weeks ago?"

Nothing leaves your machine. There is no server, no account, no telemetry --
just a CLI, a parser, and a SQLite file on disk.

## Why

Heavy users of Claude Code / Cursor / Cline accumulate months of session
transcripts. Each one is a `.jsonl` file full of your actual prompts, the
agent's explanations, the exact shell commands that worked, and the tool
output that proved it. That is genuinely valuable institutional memory --
but it's split across hundreds of files, in a format meant for replay, not
search. SessionMemex turns that pile of logs into something you can query.

## Quick start

```bash
git clone <this-repo>
cd sessionmemex
npm install
npm run build

# Index your Claude Code transcripts (defaults to ~/.claude/projects)
node dist/cli.js index

# Search everything indexed so far
node dist/cli.js search "connection pool exhausted"

# How much is in the index?
node dist/cli.js stats
```

Once built, you can also link it as a global command:

```bash
npm link
sessionmemex index
sessionmemex search "flaky test"
```

### Example search output

```
$ sessionmemex search "connection pool exhausted"
3 match(es) for "connection pool exhausted":

Fix exhausted postgres connection pool  [assistant]  2026-01-10 14:00:10Z
  session-beta.jsonl
  …That should resolve the [[exhausted]] [[connection]] [[pool]] errors under load.

Fix exhausted postgres connection pool  [user]  2026-01-10 14:00:01Z
  session-beta.jsonl
  …[[connection]] slots are reserved' from postgres, the [[connection]] [[pool]] seems [[exhausted]] under…

Fix exhausted postgres connection pool  [assistant]  2026-01-10 14:00:07Z
  session-beta.jsonl
  …the [[connection]] [[pool]] on the postgres server itself gets [[exhausted]]. The real…
```

(Real output, from this repo's own test fixtures. In a real terminal the
`[[...]]` markers render as bold/highlighted ANSI text; plain brackets are
used automatically in non-TTY output -- like this README -- so the match
still stands out without escape codes.)

## Commands

| Command | What it does |
|---|---|
| `sessionmemex index [path]` | Incrementally indexes every `*.jsonl` transcript under `path` (default: `~/.claude/projects`). Unchanged files are skipped without being re-read. |
| `sessionmemex search <query...>` | Runs a real SQLite FTS5 `MATCH` query across every indexed message and prints ranked, highlighted snippets with source file and timestamp. |
| `sessionmemex stats` | Reports how many sessions/messages are indexed, by format and message kind, and the index's on-disk size. |

Both commands accept `--db <file>` to point at a specific index database
(default: `~/.sessionmemex/index.db`).

## How it works

- **Parsing.** SessionMemex ships a real parser for Claude Code's own
  transcript format, built by inspecting actual `*.jsonl` files under
  `~/.claude/projects/<project-hash>/` on a live machine (read-only
  inspection -- no session content is embedded in this repo). Each line is a
  standalone JSON object; the parser understands the `user` / `assistant`
  message envelopes (`text`, `thinking`, `tool_use`, `tool_result` content
  blocks), pulls the human-readable `ai-title` line as the session title, and
  skips pure plumbing (`attachment` system-reminders, `queue-operation`,
  `file-history-snapshot`, `isMeta` command bodies) that would otherwise
  drown real conversation in boilerplate.
- **Pluggable formats.** Parsers implement a small `TranscriptParser`
  interface (`sniff()` + `parse()`) registered in
  `src/parsers/registry.ts`. A second, permissive fallback parser
  (`generic-jsonl`) is included for flat `{role, content, timestamp}` JSONL
  logs, as a template for adding a real Cursor/Cline parser later once you
  have sample files to inspect.
- **Search index.** A real SQLite database (Node's built-in `node:sqlite`,
  no native module compilation required) with an FTS5 virtual table
  (`messages_fts`, Porter-stemmed, external-content over a normal
  `messages` table). Search uses `MATCH` + `bm25()` ranking and FTS5's
  `snippet()` for highlighted excerpts -- not a substring loop, so it stays
  fast as the index grows into the tens of thousands of messages.
- **Incremental indexing.** Every indexed file's mtime and size are stored
  alongside a SHA-256 content hash. A re-run first checks mtime+size (no
  file read at all if unchanged); if those differ it reads the file and
  compares the hash before deciding whether to actually re-parse, so a
  `touch` without a content change is nearly free too.

## Supported transcript formats today

- **Claude Code** (`~/.claude/projects/<project-hash>/*.jsonl`) -- fully
  supported, built against real transcripts.
- **Generic flat JSONL** (`{"role": ..., "content": ..., "timestamp": ...}`
  per line) -- basic fallback support, meant as a starting template.
- Cursor and Cline are not implemented yet (see Limitations).

## Development

```bash
npm install
npm run build     # compile TypeScript -> dist/
npm test          # run the vitest suite against synthetic fixtures
```

Tests use synthetic fixture transcripts under `tests/fixtures/` shaped like
the real Claude Code format (not real user data) to verify: indexing
populates the database correctly, incremental re-index skips unchanged files
and only re-parses files whose content actually changed, and search returns
the right session for a relevant query while not returning unrelated
sessions for an unrelated query.

## Limitations

- Only one real transcript format is implemented: Claude Code's JSONL. The
  generic fallback is intentionally simple and won't understand
  tool-call-shaped data it doesn't recognize.
- The Claude Code format is not officially documented/versioned -- it was
  reverse-engineered from real files on one machine at one point in time.
  Future Claude Code releases may add fields or line types this parser
  doesn't know about; unrecognized types are skipped rather than crashing,
  but that also means new kinds of useful content could silently go
  unindexed until the parser is updated.
- `thinking` blocks are indexed as-is; some Claude Code sessions store
  redacted or empty thinking content, which is simply skipped (nothing to
  search).
- Search query syntax is intentionally simple: whitespace-separated terms
  are ANDed together (or wrap the whole query in `"quotes"` for one literal
  phrase). Full FTS5 query syntax (`OR`, `NEAR`, column filters, `*` prefix)
  is not exposed.
- No live/incremental "watch" mode -- `index` is a batch command you re-run
  periodically. It is safe to re-run at any time, including while other
  Claude Code sessions are active elsewhere, since it never writes to
  transcript files, only reads them.
- No web UI, no daemon, no cross-machine sync -- single-user, single-machine
  CLI by design for v1.
- Requires Node.js >= 22.5 for the built-in `node:sqlite` module.

## License

MIT, see [LICENSE](./LICENSE).
