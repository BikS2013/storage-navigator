/**
 * /model — switch the active model in-session.
 *
 * Re-runs buildModel(cfg) with the new model name. The provider stays the
 * same. Validation: providers fall through to their factory's normal env-var
 * checks; if they throw ConfigurationError we report it to the TUI.
 */
import type { SlashCommand, SlashContext } from "./context.js";
import { buildModel } from "../../agent/providers/registry.js";
import type { AgentConfig } from "../../config/agent-config.js";
import { ConfigurationError } from "../../config/agent-config.js";

export const modelCommand: SlashCommand = {
  name: "/model",
  brief: "Switch the active model (e.g. /model gpt-4o).",
  async run(ctx: SlashContext, args: string[]): Promise<void> {
    if (args.length === 0) {
      ctx.printSystem(`Current model: ${ctx.cfg.model} (provider: ${ctx.cfg.provider})`);
      return;
    }
    const newModel = args[0]!;
    const newCfg: AgentConfig = Object.freeze({ ...ctx.cfg, model: newModel }) as AgentConfig;
    try {
      const newModelHandle = buildModel(newCfg);
      ctx.cfg = newCfg;
      ctx.model = newModelHandle;
      ctx.rebuildGraph();
      ctx.refreshBanner();
      ctx.printSystem(`Active model is now "${newModel}".`);
    } catch (err) {
      if (err instanceof ConfigurationError) {
        ctx.printSystem(`Cannot switch to model "${newModel}": ${err.message}`);
      } else {
        ctx.printSystem(`Cannot switch to model "${newModel}": ${(err as Error).message}`);
      }
    }
  },
};
