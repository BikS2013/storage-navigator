import type { SlashCommand, SlashContext } from "./context.js";

export const quitCommand: SlashCommand = {
  name: "/quit",
  aliases: ["/exit"],
  brief: "Exit the TUI.",
  async run(ctx: SlashContext, _args: string[]): Promise<void> {
    ctx.println("Goodbye.");
    ctx.exit(0);
  },
};
