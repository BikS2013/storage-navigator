import type { SlashCommand, SlashContext } from "./context.js";
import { DIM, RESET, YELLOW, RED, GREEN, BOLD } from "../ansi.js";

export const toolsCommand: SlashCommand = {
  name: "/tools",
  brief: "List the active tool catalog.",
  async run(ctx: SlashContext, _args: string[]): Promise<void> {
    if (ctx.tools.length === 0) {
      ctx.printSystem("No tools registered.");
      return;
    }
    ctx.println(`${BOLD}Active tools (${ctx.tools.length}):${RESET}`);
    for (const t of ctx.tools) {
      const desc = (t.description ?? "").trim();
      const isDestructive = desc.includes("[DESTRUCTIVE]");
      const isMutating = desc.includes("[MUTATING]");
      const tag = isDestructive ? `${RED}[DESTRUCTIVE]${RESET}` : isMutating ? `${YELLOW}[MUTATING]${RESET}` : `${GREEN}[read-only]${RESET}`;
      const oneLine = desc.replace(/\n+/g, " ").slice(0, 100);
      ctx.println(`  ${tag} ${t.name}  ${DIM}${oneLine}${RESET}`);
    }
    if (!ctx.cfg.allowMutations) {
      ctx.printSystem("Mutation tools are disabled. Toggle with /allow-mutations.");
    }
  },
};
