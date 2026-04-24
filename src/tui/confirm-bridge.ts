/**
 * Bridge for routing destructive-tool confirmation prompts through the TUI
 * instead of opening a second readline interface (which would corrupt the
 * raw-mode session).
 *
 * The TUI installs a callback at startup; src/agent/tools/confirm.ts checks
 * for it and prefers it over the readline path.
 */
import type { ConfirmResult } from "../agent/tools/confirm.js";

export type AsyncConfirmFn = (summary: string) => Promise<ConfirmResult>;

let current: AsyncConfirmFn | null = null;

export function setTuiConfirm(fn: AsyncConfirmFn | null): void {
  current = fn;
}

export function getTuiConfirm(): AsyncConfirmFn | null {
  return current;
}
