/**
 * /allow-mutations — toggle cfg.allowMutations and rebuild the tool catalog.
 *
 * Surfaces a prominent warning banner because storage-nav can delete real
 * Azure blobs and revoke credentials.
 */
import type { SlashCommand, SlashContext } from "./context.js";
import { RED, BOLD, RESET, YELLOW } from "../ansi.js";

export const allowMutationsCommand: SlashCommand = {
  name: "/allow-mutations",
  brief: "Toggle mutation tools on/off (current session).",
  async run(ctx: SlashContext, _args: string[]): Promise<void> {
    const newValue = !ctx.cfg.allowMutations;
    ctx.cfg = Object.freeze({ ...ctx.cfg, allowMutations: newValue });
    ctx.rebuildToolCatalog();
    ctx.rebuildGraph();
    ctx.refreshBanner();
    if (newValue) {
      ctx.println(
        `${BOLD}${RED}┌─────────────────────────────────────────────────────────────┐${RESET}`
      );
      ctx.println(
        `${BOLD}${RED}│ MUTATIONS ENABLED — destructive tools (delete blob/folder, │${RESET}`
      );
      ctx.println(
        `${BOLD}${RED}│ unlink, remove storage/token) will run, gated by per-call  │${RESET}`
      );
      ctx.println(
        `${BOLD}${RED}│ confirmation prompts. Use /allow-mutations to disable.     │${RESET}`
      );
      ctx.println(
        `${BOLD}${RED}└─────────────────────────────────────────────────────────────┘${RESET}`
      );
      ctx.printSystem(`Tool catalog now has ${ctx.tools.length} tools (mutating + destructive included).`);
    } else {
      ctx.println(`${YELLOW}Mutations disabled. Read-only tools only (${ctx.tools.length} active).${RESET}`);
    }
  },
};
