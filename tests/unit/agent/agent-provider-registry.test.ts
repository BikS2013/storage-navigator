import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PROVIDERS, getProvider } from "../../../src/agent/providers/registry.js";
import { ConfigurationError } from "../../../src/config/agent-config.js";
import { ChatOpenAI, AzureChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { AgentConfig } from "../../../src/config/agent-config.js";

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return Object.freeze({
    provider: "openai",
    model: "gpt-4o",
    temperature: 0,
    maxSteps: 10,
    perToolBudgetBytes: 16384,
    systemPrompt: null,
    systemPromptFile: null,
    toolsAllowlist: null,
    allowMutations: false,
    envFilePath: "/tmp/.env",
    configFilePath: "/tmp/config.json",
    baseUrl: null,
    verbose: false,
    interactive: false,
    providerEnv: Object.freeze({}),
    ...overrides,
  } as AgentConfig);
}

describe("PROVIDERS registry", () => {
  it("has exactly 6 providers", () => {
    expect(Object.keys(PROVIDERS)).toHaveLength(6);
  });

  it("includes all required provider ids", () => {
    const ids = Object.keys(PROVIDERS);
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("gemini");
    expect(ids).toContain("azure-openai");
    expect(ids).toContain("azure-anthropic");
    expect(ids).toContain("local-openai");
  });
});

describe("getProvider", () => {
  it("returns factory for known provider", () => {
    const factory = getProvider("openai");
    expect(typeof factory).toBe("function");
  });

  it("throws ConfigurationError for unknown provider", () => {
    expect(() => getProvider("blorp")).toThrow(ConfigurationError);
  });
});

describe("openai provider factory", () => {
  it("constructs ChatOpenAI when OPENAI_API_KEY is present", () => {
    const cfg = makeConfig({
      provider: "openai",
      providerEnv: Object.freeze({ OPENAI_API_KEY: "sk-test" }),
    });
    const model = PROVIDERS["openai"](cfg);
    expect(model).toBeInstanceOf(ChatOpenAI);
  });

  it("throws ConfigurationError when OPENAI_API_KEY is missing", () => {
    const cfg = makeConfig({ provider: "openai", providerEnv: Object.freeze({}) });
    expect(() => PROVIDERS["openai"](cfg)).toThrow(ConfigurationError);
  });
});

describe("anthropic provider factory", () => {
  it("constructs ChatAnthropic when ANTHROPIC_API_KEY is present", () => {
    const cfg = makeConfig({
      provider: "anthropic",
      providerEnv: Object.freeze({ ANTHROPIC_API_KEY: "sk-ant-test" }),
    });
    const model = PROVIDERS["anthropic"](cfg);
    expect(model).toBeInstanceOf(ChatAnthropic);
  });

  it("throws ConfigurationError when ANTHROPIC_API_KEY is missing", () => {
    const cfg = makeConfig({ provider: "anthropic", providerEnv: Object.freeze({}) });
    expect(() => PROVIDERS["anthropic"](cfg)).toThrow(ConfigurationError);
  });
});

describe("gemini provider factory", () => {
  it("constructs ChatGoogleGenerativeAI when GOOGLE_API_KEY is present", () => {
    const cfg = makeConfig({
      provider: "gemini",
      providerEnv: Object.freeze({ GOOGLE_API_KEY: "g-test" }),
    });
    const model = PROVIDERS["gemini"](cfg);
    expect(model).toBeInstanceOf(ChatGoogleGenerativeAI);
  });

  it("accepts GEMINI_API_KEY as alias for GOOGLE_API_KEY", () => {
    const cfg = makeConfig({
      provider: "gemini",
      providerEnv: Object.freeze({ GEMINI_API_KEY: "g-test" }),
    });
    const model = PROVIDERS["gemini"](cfg);
    expect(model).toBeInstanceOf(ChatGoogleGenerativeAI);
  });

  it("throws ConfigurationError when both GOOGLE_API_KEY and GEMINI_API_KEY are missing", () => {
    const cfg = makeConfig({ provider: "gemini", providerEnv: Object.freeze({}) });
    expect(() => PROVIDERS["gemini"](cfg)).toThrow(ConfigurationError);
  });
});

describe("azure-openai provider factory", () => {
  it("constructs AzureChatOpenAI when all required vars present", () => {
    const cfg = makeConfig({
      provider: "azure-openai",
      model: "gpt-4o",
      providerEnv: Object.freeze({
        AZURE_OPENAI_API_KEY: "az-key",
        AZURE_OPENAI_ENDPOINT: "https://test.openai.azure.com/",
        AZURE_OPENAI_DEPLOYMENT: "gpt-4o",
      }),
    });
    const model = PROVIDERS["azure-openai"](cfg);
    expect(model).toBeInstanceOf(AzureChatOpenAI);
  });

  it("throws ConfigurationError when AZURE_OPENAI_API_KEY is missing", () => {
    const cfg = makeConfig({
      provider: "azure-openai",
      providerEnv: Object.freeze({ AZURE_OPENAI_ENDPOINT: "https://test.openai.azure.com/", AZURE_OPENAI_DEPLOYMENT: "gpt-4o" }),
    });
    expect(() => PROVIDERS["azure-openai"](cfg)).toThrow(ConfigurationError);
  });

  it("throws ConfigurationError when AZURE_OPENAI_ENDPOINT is missing", () => {
    const cfg = makeConfig({
      provider: "azure-openai",
      providerEnv: Object.freeze({ AZURE_OPENAI_API_KEY: "az-key", AZURE_OPENAI_DEPLOYMENT: "gpt-4o" }),
    });
    expect(() => PROVIDERS["azure-openai"](cfg)).toThrow(ConfigurationError);
  });
});

describe("azure-anthropic provider factory", () => {
  it("constructs ChatAnthropic when all required vars present", () => {
    const cfg = makeConfig({
      provider: "azure-anthropic",
      model: "claude-3-5-sonnet",
      providerEnv: Object.freeze({
        AZURE_AI_INFERENCE_KEY: "inf-key",
        AZURE_AI_INFERENCE_ENDPOINT: "https://my.services.ai.azure.com",
      }),
    });
    const model = PROVIDERS["azure-anthropic"](cfg);
    expect(model).toBeInstanceOf(ChatAnthropic);
  });

  it("throws ConfigurationError when AZURE_AI_INFERENCE_KEY is missing", () => {
    const cfg = makeConfig({
      provider: "azure-anthropic",
      providerEnv: Object.freeze({ AZURE_AI_INFERENCE_ENDPOINT: "https://my.services.ai.azure.com" }),
    });
    expect(() => PROVIDERS["azure-anthropic"](cfg)).toThrow(ConfigurationError);
  });

  it("throws ConfigurationError when AZURE_AI_INFERENCE_ENDPOINT is missing", () => {
    const cfg = makeConfig({
      provider: "azure-anthropic",
      providerEnv: Object.freeze({ AZURE_AI_INFERENCE_KEY: "inf-key" }),
    });
    expect(() => PROVIDERS["azure-anthropic"](cfg)).toThrow(ConfigurationError);
  });
});

describe("local-openai provider factory", () => {
  it("constructs ChatOpenAI with LOCAL_OPENAI_BASE_URL", () => {
    const cfg = makeConfig({
      provider: "local-openai",
      model: "llama3",
      providerEnv: Object.freeze({ LOCAL_OPENAI_BASE_URL: "http://localhost:11434/v1" }),
    });
    const model = PROVIDERS["local-openai"](cfg);
    expect(model).toBeInstanceOf(ChatOpenAI);
  });

  it("constructs ChatOpenAI with OLLAMA_HOST alias", () => {
    const cfg = makeConfig({
      provider: "local-openai",
      model: "llama3",
      providerEnv: Object.freeze({ OLLAMA_HOST: "http://localhost:11434" }),
    });
    const model = PROVIDERS["local-openai"](cfg);
    expect(model).toBeInstanceOf(ChatOpenAI);
  });

  it("uses not-needed as default api key when OPENAI_API_KEY not set", () => {
    const cfg = makeConfig({
      provider: "local-openai",
      model: "llama3",
      providerEnv: Object.freeze({ LOCAL_OPENAI_BASE_URL: "http://localhost:11434/v1" }),
    });
    const model = PROVIDERS["local-openai"](cfg) as ChatOpenAI;
    expect(model).toBeInstanceOf(ChatOpenAI);
  });

  it("throws ConfigurationError when no base URL env vars are set", () => {
    const cfg = makeConfig({
      provider: "local-openai",
      model: "llama3",
      providerEnv: Object.freeze({}),
    });
    expect(() => PROVIDERS["local-openai"](cfg)).toThrow(ConfigurationError);
  });
});
