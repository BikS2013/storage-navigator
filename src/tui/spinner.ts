/**
 * Animated braille spinner — spec §6.
 *
 * One active instance at a time. Frames rotate at 80 ms; the label is mutable
 * mid-spin so the streaming loop can switch from "Thinking..." to
 * "Processing tool result..." without restarting the timer.
 *
 * Each tick wraps the visible frame+label in CSI save/restore so the spinner
 * line never collides with token output. The render goes to the supplied
 * writable (defaults to process.stdout) so tests can intercept output.
 */
import { CLEAR_LINE, DIM, RESET, SAVE_CURSOR, RESTORE_CURSOR } from "./ansi.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const TICK_MS = 80;

export interface Spinner {
  setLabel(s: string): void;
  start(): void;
  stop(): void;
  isActive(): boolean;
}

export interface SpinnerOptions {
  out?: NodeJS.WritableStream;
  intervalMs?: number;
}

export function createSpinner(initialLabel: string, opts: SpinnerOptions = {}): Spinner {
  const out = opts.out ?? process.stdout;
  const intervalMs = opts.intervalMs ?? TICK_MS;
  let label = initialLabel;
  let frameIdx = 0;
  let timer: NodeJS.Timeout | null = null;

  function render(): void {
    const frame = FRAMES[frameIdx % FRAMES.length];
    out.write(`${SAVE_CURSOR}${CLEAR_LINE}${DIM}${frame} ${label}${RESET}${RESTORE_CURSOR}`);
    frameIdx++;
  }

  return {
    setLabel(s: string): void {
      label = s;
    },
    start(): void {
      if (timer !== null) return;
      frameIdx = 0;
      render(); // immediate first frame so user doesn't see a blank gap
      timer = setInterval(render, intervalMs);
      // Allow process to exit even with the timer alive (esp. on signal shutdowns).
      if (typeof timer.unref === "function") timer.unref();
    },
    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      // Erase whatever frame was rendered last so the next stdout write starts clean.
      out.write(CLEAR_LINE);
    },
    isActive(): boolean {
      return timer !== null;
    },
  };
}

export const SPINNER_FRAMES = FRAMES;
