import type { SlashCommand, SlashContext } from "./context.js";

export const lastCommand: SlashCommand = {
  name: "/last",
  brief: "Re-display the most recent assistant answer.",
  async run(ctx: SlashContext, _args: string[]): Promise<void> {
    if (!ctx.lastAgentText) {
      ctx.printSystem("No assistant response yet.");
      return;
    }
    ctx.println(ctx.lastAgentText);
  },
};
