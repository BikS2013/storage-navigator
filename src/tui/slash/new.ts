import type { SlashCommand, SlashContext } from "./context.js";

export const newCommand: SlashCommand = {
  name: "/new",
  brief: "Start a fresh thread.",
  async run(ctx: SlashContext, _args: string[]): Promise<void> {
    ctx.resetSession();
    ctx.printSystem(`New thread started: ${ctx.threadId.slice(0, 16)}…`);
  },
};
