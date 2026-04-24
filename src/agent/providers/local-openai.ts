import { ChatOpenAI } from "@langchain/openai";
import { ConfigurationError } from "../../config/agent-config.js";
import type { AgentConfig } from "../../config/agent-config.js";
import type { ProviderFactory } from "./types.js";

export const createLocalOpenaiModel: ProviderFactory = (cfg: AgentConfig) => {
  const env = cfg.providerEnv;

  // Accept OPENAI_BASE_URL, LOCAL_OPENAI_BASE_URL, or OLLAMA_HOST (in that priority order)
  const baseURL =
    cfg.baseUrl ??
    env["LOCAL_OPENAI_BASE_URL"] ??
    env["OPENAI_BASE_URL"] ??
    (env["OLLAMA_HOST"] ? `${env["OLLAMA_HOST"]}/v1` : undefined);

  if (!baseURL) {
    throw new ConfigurationError("LOCAL_OPENAI_BASE_URL", [
      "--base-url",
      "env:LOCAL_OPENAI_BASE_URL",
      "env:OPENAI_BASE_URL",
      "env:OLLAMA_HOST",
      String(cfg.envFilePath),
      String(cfg.configFilePath),
    ]);
  }

  // Many local servers accept any non-empty API key string
  const apiKey = env["OPENAI_API_KEY"] ?? "not-needed";

  return new ChatOpenAI({
    model: cfg.model,
    temperature: cfg.temperature,
    apiKey,
    configuration: { baseURL },
  });
};
