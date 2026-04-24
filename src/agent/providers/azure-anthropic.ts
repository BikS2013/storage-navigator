import { ChatAnthropic } from "@langchain/anthropic";
import { ConfigurationError } from "../../config/agent-config.js";
import type { AgentConfig } from "../../config/agent-config.js";
import type { ProviderFactory } from "./types.js";
import { normalizeFoundryEndpoint } from "./util.js";

export const createAzureAnthropicModel: ProviderFactory = (cfg: AgentConfig) => {
  const env = cfg.providerEnv;

  const apiKey = env["AZURE_AI_INFERENCE_KEY"];
  if (!apiKey) {
    throw new ConfigurationError("AZURE_AI_INFERENCE_KEY", [
      "env:AZURE_AI_INFERENCE_KEY",
      String(cfg.envFilePath),
      String(cfg.configFilePath),
    ]);
  }

  const rawEndpoint = env["AZURE_AI_INFERENCE_ENDPOINT"];
  if (!rawEndpoint) {
    throw new ConfigurationError("AZURE_AI_INFERENCE_ENDPOINT", [
      "env:AZURE_AI_INFERENCE_ENDPOINT",
      String(cfg.envFilePath),
      String(cfg.configFilePath),
    ]);
  }

  const baseURL = normalizeFoundryEndpoint(rawEndpoint, "/anthropic");

  return new ChatAnthropic({
    model: cfg.model,
    temperature: cfg.temperature,
    apiKey,
    clientOptions: { baseURL },
  });
};
