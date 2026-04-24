import { ChatOpenAI } from "@langchain/openai";
import { ConfigurationError } from "../../config/agent-config.js";
import type { AgentConfig } from "../../config/agent-config.js";
import type { ProviderFactory } from "./types.js";

export const createOpenaiModel: ProviderFactory = (cfg: AgentConfig) => {
  const env = cfg.providerEnv;
  const apiKey = env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new ConfigurationError("OPENAI_API_KEY", [
      "--openai-api-key",
      "env:OPENAI_API_KEY",
      String(cfg.envFilePath),
      String(cfg.configFilePath),
    ]);
  }
  return new ChatOpenAI({
    model: cfg.model,
    temperature: cfg.temperature,
    apiKey,
    configuration: {
      baseURL: cfg.baseUrl ?? env["OPENAI_BASE_URL"],
      organization: env["OPENAI_ORG_ID"],
    },
  });
};
