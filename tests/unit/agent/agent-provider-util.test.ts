import { describe, it, expect } from "vitest";
import { normalizeFoundryEndpoint } from "../../../src/agent/providers/util.js";

describe("normalizeFoundryEndpoint", () => {
  it("appends /anthropic to a clean base URL", () => {
    const result = normalizeFoundryEndpoint("https://my.services.ai.azure.com", "/anthropic");
    expect(result).toBe("https://my.services.ai.azure.com/anthropic");
  });

  it("strips trailing slash before appending suffix", () => {
    const result = normalizeFoundryEndpoint("https://my.services.ai.azure.com/", "/anthropic");
    expect(result).toBe("https://my.services.ai.azure.com/anthropic");
  });

  it("strips /models suffix before appending", () => {
    const result = normalizeFoundryEndpoint("https://my.services.ai.azure.com/models", "/anthropic");
    expect(result).toBe("https://my.services.ai.azure.com/anthropic");
  });

  it("handles /models with trailing slash", () => {
    const result = normalizeFoundryEndpoint("https://my.services.ai.azure.com/models/", "/openai/v1");
    expect(result).toBe("https://my.services.ai.azure.com/openai/v1");
  });

  it("strips /MODELS (case insensitive)", () => {
    const result = normalizeFoundryEndpoint("https://my.services.ai.azure.com/MODELS", "/anthropic");
    expect(result).toBe("https://my.services.ai.azure.com/anthropic");
  });

  it("handles leading/trailing whitespace in base", () => {
    const result = normalizeFoundryEndpoint("  https://my.services.ai.azure.com  ", "/openai/v1");
    expect(result).toBe("https://my.services.ai.azure.com/openai/v1");
  });

  it("appends /openai/v1 suffix", () => {
    const result = normalizeFoundryEndpoint("https://endpoint.azure.com", "/openai/v1");
    expect(result).toBe("https://endpoint.azure.com/openai/v1");
  });

  it("does not double-append suffix", () => {
    const base = "https://my.services.ai.azure.com";
    const result = normalizeFoundryEndpoint(base, "/anthropic");
    expect(result.split("/anthropic").length).toBe(2);
  });
});
