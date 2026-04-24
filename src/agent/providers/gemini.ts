import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ConfigurationError } from "../../config/agent-config.js";
import type { AgentConfig } from "../../config/agent-config.js";
import type { ProviderFactory } from "./types.js";

export const createGeminiModel: ProviderFactory = (cfg: AgentConfig) => {
  const env = cfg.providerEnv;
  // Accept both GOOGLE_API_KEY and GEMINI_API_KEY (alias)
  const apiKey = env["GOOGLE_API_KEY"] ?? env["GEMINI_API_KEY"];
  if (!apiKey) {
    throw new ConfigurationError("GOOGLE_API_KEY", [
      "env:GOOGLE_API_KEY",
      "env:GEMINI_API_KEY",
      String(cfg.envFilePath),
      String(cfg.configFilePath),
    ]);
  }
  return new ChatGoogleGenerativeAI({
    model: cfg.model,
    temperature: cfg.temperature,
    apiKey,
  });
};
