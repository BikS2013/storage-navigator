import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadAgentConfig, ConfigurationError } from "../../../src/config/agent-config.js";

describe("loadAgentConfig", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Clear all agent env vars before each test
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("STORAGE_NAV_AGENT_") || key.startsWith("AZURE_OPENAI") || key.startsWith("OPENAI") || key.startsWith("ANTHROPIC") || key.startsWith("GOOGLE")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  describe("provider resolution", () => {
    it("reads provider from CLI flag first", () => {
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-4o";
      process.env["AZURE_OPENAI_API_KEY"] = "test-key";
      process.env["AZURE_OPENAI_ENDPOINT"] = "https://test.openai.azure.com/";
      process.env["AZURE_OPENAI_DEPLOYMENT"] = "gpt-4o";
      const cfg = loadAgentConfig({ provider: "azure-openai", model: "gpt-4o", configFile: "/nonexistent/config.json" });
      expect(cfg.provider).toBe("azure-openai");
    });

    it("reads provider from STORAGE_NAV_AGENT_PROVIDER env var", () => {
      process.env["STORAGE_NAV_AGENT_PROVIDER"] = "openai";
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-4o";
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(cfg.provider).toBe("openai");
    });

    it("throws ConfigurationError when provider is missing", () => {
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-4o";
      expect(() => loadAgentConfig({ configFile: "/nonexistent/config.json" })).toThrow(ConfigurationError);
    });

    it("throws ConfigurationError for unknown provider", () => {
      process.env["STORAGE_NAV_AGENT_PROVIDER"] = "blorp";
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-4o";
      expect(() => loadAgentConfig({ configFile: "/nonexistent/config.json" })).toThrow(ConfigurationError);
    });

    it("validates all six providers are accepted", () => {
      const validProviders = ["openai", "anthropic", "gemini", "azure-openai", "azure-anthropic", "local-openai"] as const;
      for (const p of validProviders) {
        process.env["STORAGE_NAV_AGENT_PROVIDER"] = p;
        process.env["STORAGE_NAV_AGENT_MODEL"] = "test-model";
        const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
        expect(cfg.provider).toBe(p);
      }
    });
  });

  describe("model resolution", () => {
    it("CLI flag wins over env var", () => {
      process.env["STORAGE_NAV_AGENT_PROVIDER"] = "openai";
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-3.5";
      const cfg = loadAgentConfig({ model: "gpt-4o", configFile: "/nonexistent/config.json" });
      expect(cfg.model).toBe("gpt-4o");
    });

    it("falls back to AZURE_OPENAI_DEPLOYMENT for azure-openai when model not set", () => {
      process.env["STORAGE_NAV_AGENT_PROVIDER"] = "azure-openai";
      process.env["AZURE_OPENAI_DEPLOYMENT"] = "my-deployment";
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(cfg.model).toBe("my-deployment");
    });

    it("provider-specific env (AZURE_OPENAI_DEPLOYMENT) beats config.json model", async () => {
      // Regression: .env layer must outrank config.json layer (Policy A).
      const fs = await import("fs");
      const os = await import("os");
      const path = await import("path");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
      const tmpConfig = path.join(tmpDir, "config.json");
      fs.writeFileSync(
        tmpConfig,
        JSON.stringify({ schemaVersion: 1, provider: "azure-openai", model: "gpt-4o" })
      );
      try {
        process.env["STORAGE_NAV_AGENT_PROVIDER"] = "azure-openai";
        process.env["AZURE_OPENAI_DEPLOYMENT"] = "gpt-5.4";
        const cfg = loadAgentConfig({ configFile: tmpConfig });
        expect(cfg.model).toBe("gpt-5.4");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("STORAGE_NAV_AGENT_MODEL beats provider-specific env", () => {
      process.env["STORAGE_NAV_AGENT_PROVIDER"] = "azure-openai";
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-canonical";
      process.env["AZURE_OPENAI_DEPLOYMENT"] = "gpt-fallback";
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(cfg.model).toBe("gpt-canonical");
    });

    it("throws ConfigurationError when model is missing for openai", () => {
      process.env["STORAGE_NAV_AGENT_PROVIDER"] = "openai";
      expect(() => loadAgentConfig({ configFile: "/nonexistent/config.json" })).toThrow(ConfigurationError);
    });
  });

  describe("optional parameters", () => {
    beforeEach(() => {
      process.env["STORAGE_NAV_AGENT_PROVIDER"] = "openai";
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-4o";
    });

    it("defaults maxSteps to 20", () => {
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(cfg.maxSteps).toBe(20);
    });

    it("defaults temperature to 0", () => {
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(cfg.temperature).toBe(0);
    });

    it("defaults perToolBudgetBytes to 16384", () => {
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(cfg.perToolBudgetBytes).toBe(16384);
    });

    it("defaults allowMutations to false", () => {
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(cfg.allowMutations).toBe(false);
    });

    it("reads maxSteps from CLI flag", () => {
      const cfg = loadAgentConfig({ maxSteps: 5, configFile: "/nonexistent/config.json" });
      expect(cfg.maxSteps).toBe(5);
    });

    it("reads allowMutations from CLI flag", () => {
      const cfg = loadAgentConfig({ allowMutations: true, configFile: "/nonexistent/config.json" });
      expect(cfg.allowMutations).toBe(true);
    });

    it("parses tools CSV into allowlist", () => {
      const cfg = loadAgentConfig({ tools: "list_blobs,view_blob", configFile: "/nonexistent/config.json" });
      expect(cfg.toolsAllowlist).toEqual(["list_blobs", "view_blob"]);
    });

    it("sets toolsAllowlist to null when tools not specified", () => {
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(cfg.toolsAllowlist).toBeNull();
    });
  });

  describe("providerEnv snapshot", () => {
    it("captures openai env vars into providerEnv", () => {
      process.env["STORAGE_NAV_AGENT_PROVIDER"] = "openai";
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-4o";
      process.env["OPENAI_API_KEY"] = "test-key-123";
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(cfg.providerEnv["OPENAI_API_KEY"]).toBe("test-key-123");
    });

    it("does not include other providers' vars in snapshot", () => {
      process.env["STORAGE_NAV_AGENT_PROVIDER"] = "openai";
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-4o";
      process.env["OPENAI_API_KEY"] = "test-key";
      process.env["ANTHROPIC_API_KEY"] = "ant-key";
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(cfg.providerEnv["ANTHROPIC_API_KEY"]).toBeUndefined();
    });

    it("providerEnv is frozen", () => {
      process.env["STORAGE_NAV_AGENT_PROVIDER"] = "openai";
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-4o";
      const cfg = loadAgentConfig({ configFile: "/nonexistent/config.json" });
      expect(() => {
        (cfg.providerEnv as Record<string, string>)["NEW_KEY"] = "value";
      }).toThrow();
    });
  });

  describe("ConfigurationError shape", () => {
    it("includes checkedSources in error", () => {
      process.env["STORAGE_NAV_AGENT_MODEL"] = "gpt-4o";
      try {
        loadAgentConfig({ configFile: "/nonexistent/config.json" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        expect((err as ConfigurationError).checkedSources.length).toBeGreaterThan(0);
        expect((err as ConfigurationError).missingSetting).toBe("STORAGE_NAV_AGENT_PROVIDER");
      }
    });
  });
});
