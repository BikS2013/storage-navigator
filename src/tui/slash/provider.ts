/**
 * /provider — switch the active provider in-session.
 *
 * Re-loads ~/.tool-agents/storage-nav/.env (Policy B file-wins, override:true),
 * then re-runs loadAgentConfig with the new provider, then buildModel. If the
 * new provider's required env vars are missing, ConfigurationError is reported.
 */
import * as os from "node:os";
import * as path from "node:path";
import type { SlashCommand, SlashContext } from "./context.js";
import { buildModel } from "../../agent/providers/registry.js";
import { loadAgentConfig, ConfigurationError } from "../../config/agent-config.js";

const DEFAULT_ENV_FILE = path.join(os.homedir(), ".tool-agents", "storage-nav", ".env");
const VALID = ["openai", "anthropic", "gemini", "azure-openai", "azure-anthropic", "local-openai"];

export const providerCommand: SlashCommand = {
  name: "/provider",
  brief: "Switch the active provider (re-loads .env).",
  async run(ctx: SlashContext, args: string[]): Promise<void> {
    if (args.length === 0) {
      ctx.printSystem(
        `Current provider: ${ctx.cfg.provider}. Valid: ${VALID.join(", ")}. Usage: /provider <name>`
      );
      return;
    }
    const newProvider = args[0]!;
    if (!VALID.includes(newProvider)) {
      ctx.printSystem(`Unknown provider "${newProvider}". Valid: ${VALID.join(", ")}.`);
      return;
    }

    // Re-load .env file-wins so the user can edit ~/.tool-agents/storage-nav/.env
    // before the switch and have the new keys picked up.
    try {
      const dotenv = await import("dotenv");
      dotenv.config({ path: ctx.cfg.envFilePath ?? DEFAULT_ENV_FILE, override: true });
    } catch {
      // dotenv missing or .env not present — proceed and rely on shell env.
    }

    let newCfg;
    try {
      newCfg = loadAgentConfig({
        provider: newProvider,
        envFile: ctx.cfg.envFilePath ?? undefined,
        configFile: ctx.cfg.configFilePath ?? undefined,
        interactive: true,
        // Carry forward in-session toggles
        allowMutations: ctx.cfg.allowMutations,
      });
    } catch (err) {
      if (err instanceof ConfigurationError) {
        ctx.printSystem(`Cannot switch to provider "${newProvider}": ${err.message}`);
      } else {
        ctx.printSystem(`Cannot switch to provider "${newProvider}": ${(err as Error).message}`);
      }
      return;
    }

    let newModelHandle;
    try {
      newModelHandle = buildModel(newCfg);
    } catch (err) {
      ctx.printSystem(`Provider "${newProvider}" failed to build model: ${(err as Error).message}`);
      return;
    }

    ctx.cfg = newCfg;
    ctx.model = newModelHandle;
    ctx.rebuildGraph();
    ctx.refreshBanner();
    ctx.printSystem(`Active provider is now "${newProvider}" (model: ${newCfg.model}).`);
  },
};
