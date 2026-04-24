import { AzureChatOpenAI } from "@langchain/openai";
import { ConfigurationError } from "../../config/agent-config.js";
import type { AgentConfig } from "../../config/agent-config.js";
import type { ProviderFactory } from "./types.js";

export const createAzureOpenaiModel: ProviderFactory = (cfg: AgentConfig) => {
  const env = cfg.providerEnv;

  const apiKey = env["AZURE_OPENAI_API_KEY"];
  if (!apiKey) {
    throw new ConfigurationError("AZURE_OPENAI_API_KEY", [
      "env:AZURE_OPENAI_API_KEY",
      String(cfg.envFilePath),
      String(cfg.configFilePath),
    ]);
  }

  const endpoint = env["AZURE_OPENAI_ENDPOINT"];
  if (!endpoint) {
    throw new ConfigurationError("AZURE_OPENAI_ENDPOINT", [
      "env:AZURE_OPENAI_ENDPOINT",
      String(cfg.envFilePath),
      String(cfg.configFilePath),
    ]);
  }

  // Model may be resolved from AZURE_OPENAI_DEPLOYMENT via provider fallback in agent-config
  const deployment = cfg.model;

  const apiVersion = env["AZURE_OPENAI_API_VERSION"] ?? "2024-10-21";

  return new AzureChatOpenAI({
    azureOpenAIApiKey: apiKey,
    azureOpenAIEndpoint: endpoint,
    azureOpenAIApiDeploymentName: deployment,
    azureOpenAIApiVersion: apiVersion,
    temperature: cfg.temperature,
  });
};
