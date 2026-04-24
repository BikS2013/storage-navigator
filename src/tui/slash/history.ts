import type { SlashCommand, SlashContext } from "./context.js";
import { DIM, BOLD, RESET, CYAN, GREEN } from "../ansi.js";

export const historyCommand: SlashCommand = {
  name: "/history",
  brief: "Show the current session's turns.",
  async run(ctx: SlashContext, _args: string[]): Promise<void> {
    if (ctx.messages.length === 0) {
      ctx.printSystem("No history yet.");
      return;
    }
    for (const m of ctx.messages) {
      const tag = m.role === "user" ? `${GREEN}You${RESET}` : `${BOLD}${CYAN}Agent${RESET}`;
      const text = m.text.length > 200 ? `${m.text.slice(0, 200)}${DIM}…${RESET}` : m.text;
      ctx.println(`${tag}: ${text}`);
    }
  },
};
