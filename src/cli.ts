#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { openDb } from "./db/schema";
import { indexDirectory } from "./indexer";
import { search } from "./search";
import { getStats } from "./db/store";
import { defaultDbPath, defaultTranscriptsDir } from "./util/paths";
import { bold, cyan, dim, green, red, yellow } from "./util/ansi";

const HELP = `${bold("SessionMemex")} -- local-first search over your AI coding-agent session transcripts.

Usage:
  sessionmemex index [path] [--db <file>]
      Index (incrementally) transcript files under <path>.
      Default path: ${defaultTranscriptsDir()}

  sessionmemex search <query...> [--limit <n>] [--db <file>]
      Full-text search (SQLite FTS5) over everything indexed so far.

  sessionmemex stats [--db <file>]
      Show how many sessions and messages are indexed.

  sessionmemex help
      Show this message.

Global:
  --db <file>   Path to the SQLite index database.
                Default: ${defaultDbPath()}
`;

function parseFlags(args: string[]): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "unknown time";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function cmdIndex(args: string[]): number {
  const { positionals, flags } = parseFlags(args);
  const rootDir = positionals[0] ?? defaultTranscriptsDir();
  const dbPath = flags.db ?? defaultDbPath();

  if (!fs.existsSync(rootDir)) {
    console.error(red(`Directory not found: ${rootDir}`));
    return 1;
  }

  console.log(`${dim("Indexing")} ${cyan(rootDir)} ${dim("->")} ${cyan(dbPath)}`);
  const db = openDb(dbPath);
  const start = Date.now();
  const summary = indexDirectory(db, rootDir, {
    onFile: (evt) => {
      if (evt.status === "indexed") console.log(`  ${green("+ indexed")}   ${evt.filePath} (${evt.messageCount} msgs)`);
      else if (evt.status === "updated") console.log(`  ${yellow("~ updated")}   ${evt.filePath} (${evt.messageCount} msgs)`);
      else if (evt.status === "unsupported") console.log(`  ${dim("? skipped")}   ${evt.filePath} (unrecognized format)`);
      else if (evt.status === "error") console.log(`  ${red("! error")}     ${evt.filePath}: ${evt.error}`);
      // "unchanged" / "touched" are intentionally quiet -- that's the whole point of incremental indexing.
    },
  });
  db.close();
  const elapsedMs = Date.now() - start;

  console.log("");
  console.log(bold("Done."));
  console.log(
    `  scanned: ${summary.scanned}  indexed: ${green(String(summary.indexed))}  updated: ${yellow(
      String(summary.updated),
    )}  unchanged: ${dim(String(summary.unchanged))}  unsupported: ${dim(String(summary.unsupported))}  errors: ${
      summary.errors ? red(String(summary.errors)) : "0"
    }`,
  );
  console.log(`  ${summary.totalMessages} new messages indexed in ${elapsedMs}ms`);
  return 0;
}

function cmdSearch(args: string[]): number {
  const { positionals, flags } = parseFlags(args);
  const query = positionals.join(" ").trim();
  const dbPath = flags.db ?? defaultDbPath();
  const limit = flags.limit ? parseInt(flags.limit, 10) : 20;

  if (!query) {
    console.error(red("Usage: sessionmemex search <query...>"));
    return 1;
  }
  if (!fs.existsSync(dbPath)) {
    console.error(red(`No index found at ${dbPath}. Run "sessionmemex index" first.`));
    return 1;
  }

  const db = openDb(dbPath);
  const results = search(db, query, limit);
  db.close();

  if (results.length === 0) {
    console.log(dim(`No matches for "${query}".`));
    return 0;
  }

  console.log(bold(`${results.length} match(es) for "${query}":\n`));
  for (const r of results) {
    const base = path.basename(r.filePath);
    const header = [
      r.title ? bold(r.title) : bold("(untitled session)"),
      dim(`[${r.role}${r.kind !== "text" ? "/" + r.kind : ""}${r.toolName ? ":" + r.toolName : ""}]`),
      dim(formatTimestamp(r.timestamp)),
    ].join("  ");
    console.log(header);
    console.log(dim(`  ${base}`));
    console.log(`  ${r.snippet.replace(/\n/g, " ")}`);
    console.log("");
  }
  return 0;
}

function cmdStats(args: string[]): number {
  const { flags } = parseFlags(args);
  const dbPath = flags.db ?? defaultDbPath();

  if (!fs.existsSync(dbPath)) {
    console.error(red(`No index found at ${dbPath}. Run "sessionmemex index" first.`));
    return 1;
  }

  const db = openDb(dbPath);
  const stats = getStats(db);
  db.close();

  const dbSize = fs.statSync(dbPath).size;

  console.log(bold("SessionMemex index stats"));
  console.log(`  database:        ${dbPath} (${fmtBytes(dbSize)})`);
  console.log(`  sessions:        ${stats.sessionCount}`);
  console.log(`  messages:        ${stats.messageCount}`);
  if (stats.earliest || stats.latest) {
    console.log(`  date range:      ${formatTimestamp(stats.earliest)}  to  ${formatTimestamp(stats.latest)}`);
  }
  if (stats.byFormat.length) {
    console.log(`  by format:       ${stats.byFormat.map((f) => `${f.format}=${f.count}`).join(", ")}`);
  }
  if (stats.byKind.length) {
    console.log(`  by message kind: ${stats.byKind.map((k) => `${k.kind}=${k.count}`).join(", ")}`);
  }
  return 0;
}

function main(): number {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "index":
      return cmdIndex(rest);
    case "search":
      return cmdSearch(rest);
    case "stats":
      return cmdStats(rest);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      return 0;
    default:
      console.error(red(`Unknown command: ${cmd}\n`));
      console.log(HELP);
      return 1;
  }
}

process.exit(main());
