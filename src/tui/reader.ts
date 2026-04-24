/**
 * Raw-mode multiline reader — the core input primitive of the TUI.
 *
 * Features (spec §2.1, §5):
 *  - Multiline input with Enter = submit and Shift+Enter / Ctrl+J = newline.
 *  - First-line and continuation prompts.
 *  - UTF-8 input via a stateful decoder (spec §5.2 / §18.2).
 *  - Full keybinding set: arrows, Home/End, word motion (Option/Ctrl/Cmd),
 *    Ctrl+A/E/U/K/W, Alt+Backspace, Delete, Cmd+Backspace.
 *  - Input history navigation on Up/Down at the edges of the current input.
 *  - Backspace at column 0 merges with the previous line.
 *  - Ctrl+C → reject "SIGINT", Ctrl+D on empty → reject "EOF".
 *  - Escape-sequence framing (spec §5.1 / §18.1) — frame by SHAPE, not by
 *    "first byte in 0x40–0x7E terminates", so arrow keys never echo as
 *    A/B/C/D, Home never echoes as H, and `\x1b[3~` never echoes as `3~`.
 *
 * The reader writes to its `out` and reads from its `input` stream so the
 * tests can drive it via a PassThrough with `isTTY = true` and a no-op
 * `setRawMode`.
 */
import { GREEN, RESET, CLEAR_LINE } from "./ansi.js";
import { createUtf8Decoder } from "./utf8.js";

interface RawTtyLike {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  resume?: () => unknown;
  pause?: () => unknown;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  off(event: "data", listener: (chunk: Buffer) => void): unknown;
}

export interface ReadInputOptions {
  prompt: string;
  continuationPrompt: string;
  inputHistory: string[];
  input?: RawTtyLike;
  out?: NodeJS.WritableStream;
}

// ── Pure helpers (extracted for testing) ─────────────────────────────────────

export function deleteWordBack(line: string, col: number): { line: string; col: number } {
  if (col === 0) return { line, col };
  let end = col;
  // Step back over trailing whitespace
  let i = end - 1;
  while (i >= 0 && /\s/.test(line[i]!)) i--;
  // Step back over the word
  while (i >= 0 && !/\s/.test(line[i]!)) i--;
  const start = i + 1;
  return { line: line.slice(0, start) + line.slice(end), col: start };
}

export function wordLeft(line: string, col: number): number {
  if (col === 0) return 0;
  let i = col - 1;
  while (i > 0 && /\s/.test(line[i]!)) i--;
  while (i > 0 && !/\s/.test(line[i - 1]!)) i--;
  return i;
}

export function wordRight(line: string, col: number): number {
  const n = line.length;
  if (col >= n) return n;
  let i = col;
  while (i < n && /\s/.test(line[i]!)) i++;
  while (i < n && !/\s/.test(line[i]!)) i++;
  return i;
}

// ── Escape-sequence framing (spec §5.1) ──────────────────────────────────────

/**
 * Decide whether the bytes accumulated since ESC form a complete sequence.
 * Returns null if we should keep buffering.
 *
 * Framing rules:
 *  - `\x1b[ … FINAL` (CSI): wait for a byte in 0x40–0x7E AFTER the `[` introducer.
 *    Minimum length 3.
 *  - `\x1bO<key>` (SS3): exactly 3 bytes.
 *  - `\x1b<char>` (any non-`[`, non-`O`): exactly 2 bytes.
 *  - lone `\x1b`: incomplete.
 */
export function escapeFramingDone(bytes: number[]): boolean {
  if (bytes.length < 2) return false; // lone ESC → keep waiting
  const second = bytes[1]!;
  if (second === 0x5b /* '[' */) {
    if (bytes.length < 3) return false;
    // Look for the first byte AFTER the `[` that falls in 0x40–0x7E.
    // Parameter / intermediate bytes are 0x30–0x3F and 0x20–0x2F respectively.
    for (let i = 2; i < bytes.length; i++) {
      const b = bytes[i]!;
      if (b >= 0x40 && b <= 0x7e) return true;
    }
    return false;
  }
  if (second === 0x4f /* 'O' */) {
    return bytes.length >= 3;
  }
  // ESC <char> form (Alt+b, Alt+f, Alt+Backspace, ESC + CR, ESC + LF, etc.)
  return bytes.length >= 2;
}

// ── Reader ───────────────────────────────────────────────────────────────────

/**
 * Read a single multiline input from the raw-mode stdin.
 * Resolves to the joined string on Enter; rejects on Ctrl+C ("SIGINT") or
 * Ctrl+D on empty buffer ("EOF").
 */
export function readInput(opts: ReadInputOptions): Promise<string> {
  const input = (opts.input ?? process.stdin) as RawTtyLike;
  const out = opts.out ?? process.stdout;
  const prompt = opts.prompt;
  const cont = opts.continuationPrompt;
  const history = opts.inputHistory;

  return new Promise<string>((resolve, reject) => {
    const lines: string[] = [""]; // current edit buffer, line-by-line
    let row = 0; // active line in `lines`
    let col = 0; // cursor column within lines[row]
    let historyIdx = history.length; // pointer; history.length means "current edit"
    let savedDraft = ""; // restored when user navigates back from history

    const escBuf: number[] = [];
    let inEsc = false;
    const decoder = createUtf8Decoder();

    function promptFor(r: number): string {
      return r === 0 ? prompt : cont;
    }

    function totalText(): string {
      return lines.join("\n");
    }

    function redrawAll(): void {
      // Move cursor to the first line of the current input, clear each line,
      // then redraw each line with its prompt and place the cursor.
      // Simpler approach: clear current line, print all lines separated by \n,
      // then carriage-return + cursor-up to position. This works as long as
      // the lines fit the terminal width (we don't track wrapping).
      // For multi-line inputs we move up `row` rows first so we overwrite
      // the previously rendered block.
      if (row > 0) {
        out.write(`\x1b[${row}A`);
      }
      for (let i = 0; i < lines.length; i++) {
        out.write(`${CLEAR_LINE}${promptFor(i)}${lines[i]}`);
        if (i < lines.length - 1) out.write("\n");
      }
      // Move cursor up to active row
      const linesBelow = lines.length - 1 - row;
      if (linesBelow > 0) out.write(`\x1b[${linesBelow}A`);
      // Move cursor to the right column on the active row
      const promptLen = visibleLength(promptFor(row));
      const target = promptLen + col;
      out.write(`\r\x1b[${target}C`);
    }

    function redrawCurrentLineOnly(): void {
      const promptLen = visibleLength(promptFor(row));
      out.write(`${CLEAR_LINE}${promptFor(row)}${lines[row]}`);
      const target = promptLen + col;
      out.write(`\r`);
      if (target > 0) out.write(`\x1b[${target}C`);
    }

    function replaceInput(newText: string): void {
      // Wipe rendered lines first
      if (row > 0) out.write(`\x1b[${row}A`);
      for (let i = 0; i < lines.length; i++) {
        out.write(CLEAR_LINE);
        if (i < lines.length - 1) out.write("\n");
      }
      if (lines.length > 1) out.write(`\x1b[${lines.length - 1}A`);
      // Replace and redraw
      const newLines = newText.split("\n");
      lines.length = 0;
      for (const l of newLines) lines.push(l);
      row = lines.length - 1;
      col = lines[row]!.length;
      redrawAll();
    }

    function insertChar(s: string): void {
      const cur = lines[row]!;
      lines[row] = cur.slice(0, col) + s + cur.slice(col);
      col += s.length;
      redrawCurrentLineOnly();
    }

    function insertNewline(): void {
      const cur = lines[row]!;
      const before = cur.slice(0, col);
      const after = cur.slice(col);
      lines[row] = before;
      lines.splice(row + 1, 0, after);
      row += 1;
      col = 0;
      // Print the newline and the continuation prompt; the rest of the input
      // (lines below) is overwritten by the redraw.
      redrawAll();
    }

    function handleBackspace(): void {
      if (col > 0) {
        const cur = lines[row]!;
        lines[row] = cur.slice(0, col - 1) + cur.slice(col);
        col -= 1;
        redrawCurrentLineOnly();
      } else if (row > 0) {
        // Merge with previous line
        const prev = lines[row - 1]!;
        const cur = lines[row]!;
        col = prev.length;
        lines[row - 1] = prev + cur;
        lines.splice(row, 1);
        row -= 1;
        redrawAll();
      }
    }

    function deleteAtCursor(): void {
      const cur = lines[row]!;
      if (col < cur.length) {
        lines[row] = cur.slice(0, col) + cur.slice(col + 1);
        redrawCurrentLineOnly();
      } else if (row < lines.length - 1) {
        lines[row] = cur + lines[row + 1]!;
        lines.splice(row + 1, 1);
        redrawAll();
      }
    }

    function killToEnd(): void {
      const cur = lines[row]!;
      lines[row] = cur.slice(0, col);
      redrawCurrentLineOnly();
    }

    function killToStart(): void {
      const cur = lines[row]!;
      lines[row] = cur.slice(col);
      col = 0;
      redrawCurrentLineOnly();
    }

    function killWordBack(): void {
      const cur = lines[row]!;
      const r = deleteWordBack(cur, col);
      lines[row] = r.line;
      col = r.col;
      redrawCurrentLineOnly();
    }

    function moveCol(newCol: number): void {
      const cur = lines[row]!;
      col = Math.max(0, Math.min(cur.length, newCol));
      const promptLen = visibleLength(promptFor(row));
      out.write(`\r`);
      if (promptLen + col > 0) out.write(`\x1b[${promptLen + col}C`);
    }

    function navHistoryBack(): void {
      if (history.length === 0) return;
      if (historyIdx === history.length) {
        savedDraft = totalText();
      }
      if (historyIdx === 0) return;
      historyIdx -= 1;
      replaceInput(history[historyIdx]!);
    }

    function navHistoryForward(): void {
      if (historyIdx >= history.length) return;
      historyIdx += 1;
      if (historyIdx === history.length) {
        replaceInput(savedDraft);
      } else {
        replaceInput(history[historyIdx]!);
      }
    }

    function arrowUp(): void {
      if (row > 0) {
        row -= 1;
        col = Math.min(col, lines[row]!.length);
        const promptLen = visibleLength(promptFor(row));
        // Move physical cursor up one row, then to the right column.
        out.write(`\x1b[A`);
        out.write(`\r`);
        if (promptLen + col > 0) out.write(`\x1b[${promptLen + col}C`);
      } else {
        navHistoryBack();
      }
    }

    function arrowDown(): void {
      if (row < lines.length - 1) {
        row += 1;
        col = Math.min(col, lines[row]!.length);
        const promptLen = visibleLength(promptFor(row));
        out.write(`\x1b[B`);
        out.write(`\r`);
        if (promptLen + col > 0) out.write(`\x1b[${promptLen + col}C`);
      } else {
        navHistoryForward();
      }
    }

    function dispatchEsc(seq: number[]): void {
      // Buffer is the bytes AFTER the leading ESC (we keep ESC at index 0).
      // Convert tail into a string for matching CSI/SS3 sequences.
      const tail = Buffer.from(seq.slice(1)).toString("latin1");

      // ── Shift+Enter variants ────────────────────────────────────────
      if (tail === "[13;2u" || tail === "OM" || tail === "\r" || tail === "\n" || tail === "[27;2;13~") {
        insertNewline();
        return;
      }

      // ── Arrows ──────────────────────────────────────────────────────
      if (tail === "[A") return arrowUp();
      if (tail === "[B") return arrowDown();
      if (tail === "[C") return moveCol(col + 1);
      if (tail === "[D") return moveCol(col - 1);

      // ── Home / End ──────────────────────────────────────────────────
      if (tail === "[H" || tail === "OH" || tail === "[1~") return moveCol(0);
      if (tail === "[F" || tail === "OF" || tail === "[4~") return moveCol(lines[row]!.length);

      // ── Word motion (Option/Ctrl + ←/→) ─────────────────────────────
      if (tail === "[1;3D" || tail === "[1;5D") return moveCol(wordLeft(lines[row]!, col));
      if (tail === "[1;3C" || tail === "[1;5C") return moveCol(wordRight(lines[row]!, col));

      // ── Cmd + ←/→ (line motion) ─────────────────────────────────────
      if (tail === "[1;9D" || tail === "[1;2H") return moveCol(0);
      if (tail === "[1;9C" || tail === "[1;2F") return moveCol(lines[row]!.length);

      // ── Delete key ──────────────────────────────────────────────────
      if (tail === "[3~") return deleteAtCursor();

      // ── Cmd+Backspace ───────────────────────────────────────────────
      if (tail === "[3;9~") return killToStart();

      // ── Alt+Backspace ───────────────────────────────────────────────
      if (tail === "\x7f") return killWordBack();

      // ── Alt+b / Alt+f ───────────────────────────────────────────────
      if (tail === "b") return moveCol(wordLeft(lines[row]!, col));
      if (tail === "f") return moveCol(wordRight(lines[row]!, col));

      // Unknown sequence — drop silently (NEVER fall through to insertChar)
    }

    function onData(chunk: Buffer): void {
      for (let i = 0; i < chunk.length; i++) {
        const b = chunk[i]!;

        // ── In-flight escape sequence ─────────────────────────────────
        if (inEsc) {
          escBuf.push(b);
          // Safety cap (spec §5.1)
          if (escBuf.length > 10) {
            escBuf.length = 0;
            inEsc = false;
            continue;
          }
          if (escapeFramingDone(escBuf)) {
            const seq = escBuf.slice();
            escBuf.length = 0;
            inEsc = false;
            dispatchEsc(seq);
          }
          continue;
        }

        // ── Control bytes ────────────────────────────────────────────
        if (b === 0x03) {
          cleanup();
          reject(new Error("SIGINT"));
          return;
        }
        if (b === 0x04) {
          if (totalText().length === 0) {
            cleanup();
            reject(new Error("EOF"));
            return;
          }
          continue;
        }
        if (b === 0x0d) {
          // Enter — submit
          out.write("\n");
          cleanup();
          resolve(totalText());
          return;
        }
        if (b === 0x0a) {
          // Ctrl+J — newline (universal Shift+Enter fallback)
          insertNewline();
          continue;
        }
        if (b === 0x7f || b === 0x08) {
          handleBackspace();
          continue;
        }
        if (b === 0x01) {
          moveCol(0);
          continue;
        }
        if (b === 0x05) {
          moveCol(lines[row]!.length);
          continue;
        }
        if (b === 0x0b) {
          killToEnd();
          continue;
        }
        if (b === 0x15) {
          killToStart();
          continue;
        }
        if (b === 0x17) {
          killWordBack();
          continue;
        }
        if (b === 0x1b) {
          escBuf.length = 0;
          escBuf.push(b);
          inEsc = true;
          continue;
        }
        // Other control bytes → ignore
        if (b < 0x20) {
          continue;
        }

        // ── Printable byte → UTF-8 decode ────────────────────────────
        const ch = decoder.write(b);
        if (ch.length > 0) insertChar(ch);
      }
    }

    function cleanup(): void {
      input.off("data", onData);
      if (input.setRawMode) {
        try { input.setRawMode(false); } catch { /* ignore */ }
      }
      if (input.pause) {
        try { input.pause(); } catch { /* ignore */ }
      }
    }

    if (input.setRawMode) {
      try { input.setRawMode(true); } catch { /* ignore */ }
    }
    if (input.resume) {
      try { input.resume(); } catch { /* ignore */ }
    }
    out.write(promptFor(0));
    input.on("data", onData);
  });
}

/**
 * Visible length of a prompt with ANSI escapes stripped.
 * (The reader uses this for cursor positioning math.)
 */
function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").length;
}

// Convenience prompts for the TUI entry point.
export const PROMPT = `${GREEN}You>${RESET} `;
export const CONT_PROMPT = `${GREEN} ..${RESET} `;
