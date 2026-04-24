/**
 * ANSI escape constants and cursor helpers used by the TUI rendering layer.
 * Inline literals only — no external colour/cursor library is allowed (spec §15).
 */

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const GREEN = "\x1b[32m";
export const CYAN = "\x1b[36m";
export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";
export const MAGENTA = "\x1b[35m";

export const CLEAR_LINE = "\r\x1b[2K";
export const SAVE_CURSOR = "\x1b[s";
export const RESTORE_CURSOR = "\x1b[u";

export function cursorUp(n = 1): string {
  return `\x1b[${n}A`;
}
export function cursorDown(n = 1): string {
  return `\x1b[${n}B`;
}
export function cursorRight(n = 1): string {
  return `\x1b[${n}C`;
}
export function cursorLeft(n = 1): string {
  return `\x1b[${n}D`;
}

/** Strip ANSI escapes from a string (used for column-width math). */
export function stripAnsi(s: string): string {
  // Matches CSI sequences (ESC [ ... letter) and the simple ESC<char> form.
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b./g, "");
}
