/**
 * Agent-side confirmation for destructive tool operations.
 *
 * When the agent wants to invoke a [DESTRUCTIVE] tool, it first calls this
 * function to print a summary and prompt the user for y/yes. On refusal,
 * returns a structured "user declined" result that the agent can reason about.
 *
 * This replaces the CLI-level promptYesNo for agent-invoked commands so that
 * the readline interaction is clean and the agent sees a structured response.
 */
import * as readline from "readline";

export interface ConfirmResult {
  confirmed: boolean;
  message: string;
}

/**
 * Prompt the user to confirm a destructive operation.
 * Returns { confirmed: true } when the user types y/yes, { confirmed: false } otherwise.
 *
 * When the TUI is active it installs a bridge callback (see
 * src/tui/confirm-bridge.ts) that handles the prompt inside the existing
 * raw-mode session. Outside the TUI we fall back to the readline path below.
 */
export async function confirmDestructive(summary: string): Promise<ConfirmResult> {
  // Lazy-import the bridge so non-TUI callers (one-shot mode) don't pay the
  // import cost or pull in TUI dependencies.
  try {
    const { getTuiConfirm } = await import("../../tui/confirm-bridge.js");
    const tuiFn = getTuiConfirm();
    if (tuiFn) return tuiFn(summary);
  } catch {
    // Bridge module not present (older build) — fall through to readline.
  }

  process.stdout.write(`\n[AGENT CONFIRMATION REQUIRED]\n${summary}\n\nType 'yes' or 'y' to proceed, anything else to cancel: `);

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    let answered = false;

    rl.on("line", (line) => {
      if (answered) return;
      answered = true;
      rl.close();
      const answer = line.trim().toLowerCase();
      const confirmed = answer === "y" || answer === "yes";
      resolve({
        confirmed,
        message: confirmed ? "User confirmed." : "User declined. Operation cancelled.",
      });
    });

    rl.on("close", () => {
      if (!answered) {
        answered = true;
        resolve({ confirmed: false, message: "Input closed. Operation cancelled." });
      }
    });
  });
}
