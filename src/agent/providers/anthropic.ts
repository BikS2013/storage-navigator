import { ChatAnthropic } from "@langchain/anthropic";
import { ConfigurationError } from "../../config/agent-config.js";
import type { AgentConfig } from "../../config/agent-config.js";
import type { ProviderFactory } from "./types.js";

export const createAnthropicModel: ProviderFactory = (cfg: AgentConfig) => {
  const env = cfg.providerEnv;
  const apiKey = env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new ConfigurationError("ANTHROPIC_API_KEY", [
      "env:ANTHROPIC_API_KEY",
      String(cfg.envFilePath),
      String(cfg.configFilePath),
    ]);
  }
  const baseURL = cfg.baseUrl ?? env["ANTHROPIC_BASE_URL"];
  return new ChatAnthropic({
    model: cfg.model,
    temperature: cfg.temperature,
    apiKey,
    clientOptions: baseURL ? { baseURL } : undefined,
  });
};
