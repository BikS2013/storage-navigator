import type { SlashCommand, SlashContext } from "./context.js";
import { copyToClipboard } from "../clipboard.js";

export const copyCommand: SlashCommand = {
  name: "/copy",
  brief: "Copy the last assistant answer to the system clipboard.",
  async run(ctx: SlashContext, _args: string[]): Promise<void> {
    if (!ctx.lastAgentText) {
      ctx.printSystem("Nothing to copy yet.");
      return;
    }
    try {
      await copyToClipboard(ctx.lastAgentText);
      ctx.printSystem(`Copied ${ctx.lastAgentText.length} chars to clipboard.`);
    } catch (err) {
      ctx.printSystem(`Could not copy: ${(err as Error).message}`);
    }
  },
};
