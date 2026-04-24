import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ConfigurationError } from "../../config/agent-config.js";
import type { AgentConfig, ProviderName } from "../../config/agent-config.js";
import type { ProviderFactory } from "./types.js";
import { createOpenaiModel } from "./openai.js";
import { createAnthropicModel } from "./anthropic.js";
import { createGeminiModel } from "./gemini.js";
import { createAzureOpenaiModel } from "./azure-openai.js";
import { createAzureAnthropicModel } from "./azure-anthropic.js";
import { createLocalOpenaiModel } from "./local-openai.js";

export const PROVIDERS: Readonly<Record<ProviderName, ProviderFactory>> = Object.freeze({
  openai: createOpenaiModel,
  anthropic: createAnthropicModel,
  gemini: createGeminiModel,
  "azure-openai": createAzureOpenaiModel,
  "azure-anthropic": createAzureAnthropicModel,
  "local-openai": createLocalOpenaiModel,
});

export function getProvider(name: string): ProviderFactory {
  const f = (PROVIDERS as Record<string, ProviderFactory>)[name];
  if (!f) {
    throw new ConfigurationError(
      "STORAGE_NAV_AGENT_PROVIDER",
      ["--provider", "env:STORAGE_NAV_AGENT_PROVIDER"],
      `Unknown provider: "${name}". Valid: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }
  return f;
}

export function buildModel(cfg: AgentConfig): BaseChatModel {
  const factory = getProvider(cfg.provider);
  return factory(cfg);
}
