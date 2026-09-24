/**
 * Minimal ANSI helpers so we don't need a color-library dependency.
 * Honors NO_COLOR (https://no-color.org/) and non-TTY output.
 */
const enabled = !process.env.NO_COLOR && Boolean(process.stdout && process.stdout.isTTY);

function wrap(code: string, reset = "\u001b[0m") {
  return (s: string) => (enabled ? `${code}${s}${reset}` : s);
}

export const bold = wrap("\u001b[1m");
export const dim = wrap("\u001b[2m");
export const green = wrap("\u001b[32m");
export const yellow = wrap("\u001b[33m");
export const cyan = wrap("\u001b[36m");
export const red = wrap("\u001b[31m");
export const magenta = wrap("\u001b[35m");

/** Highlight markers used inside FTS5 snippet() calls. */
export const HIGHLIGHT_START = enabled ? "\u001b[1;33m" : "[[";
export const HIGHLIGHT_END = enabled ? "\u001b[0m" : "]]";
