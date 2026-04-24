import type { SlashCommand, SlashContext } from "./context.js";
import { DIM, RESET, BOLD } from "../ansi.js";

export const helpCommand: SlashCommand = {
  name: "/help",
  brief: "Show all slash commands and keybindings.",
  async run(ctx: SlashContext, _args: string[]): Promise<void> {
    const lines: string[] = [];
    lines.push(`${BOLD}Slash commands:${RESET}`);
    lines.push("  /help                          Show this help.");
    lines.push("  /quit (alias /exit)            Exit the TUI.");
    lines.push("  /new                           Start a fresh thread (new MemorySaver state).");
    lines.push("  /history                       Show the current session's user↔agent turns.");
    lines.push("  /last                          Re-display the most recent assistant answer.");
    lines.push("  /copy                          Copy the last assistant answer to the clipboard.");
    lines.push("  /memory                        List persistent memory entries.");
    lines.push("  /memory show <name>            Show one entry's content.");
    lines.push("  /memory add <name> <content>   Add a new memory entry.");
    lines.push("  /memory remove <name>          Remove an entry.");
    lines.push("  /memory edit <name>            Open in $EDITOR.");
    lines.push("  /model <name>                  Switch the active model in-session.");
    lines.push("  /provider <name>               Switch the active provider in-session.");
    lines.push("  /tools                         List the active tool catalog.");
    lines.push("  /allow-mutations               Toggle mutation tools on/off.");
    lines.push("");
    lines.push(`${BOLD}Keybindings:${RESET}`);
    lines.push("  Enter                  Submit input.");
    lines.push("  Shift+Enter / Ctrl+J   Insert a newline.");
    lines.push("                         (Shift+Enter only works in terminals with kitty/CSI-u");
    lines.push("                          keyboard support; Ctrl+J is the universal fallback.)");
    lines.push("  ←/→  Home/End  Ctrl+A/E              Cursor motion.");
    lines.push("  Option+←/→  Ctrl+←/→  Alt+b/f        Word motion.");
    lines.push("  Backspace  Delete  Ctrl+W  Ctrl+U   Editing.");
    lines.push("  ↑/↓                                   Input history (when at edges of input).");
    lines.push("  ESC during execution                 Abort the in-flight model turn.");
    lines.push("  Ctrl+C during input                  Cancel current input.");
    lines.push("  Ctrl+C twice in a row                Exit the TUI.");
    lines.push("  Ctrl+D on empty input                Exit the TUI.");
    for (const l of lines) ctx.println(`${DIM}${l}${RESET}`);
  },
};
