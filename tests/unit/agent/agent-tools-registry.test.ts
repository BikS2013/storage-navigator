import { describe, it, expect } from "vitest";
import { buildToolCatalog } from "../../../src/agent/tools/registry.js";
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

describe("buildToolCatalog", () => {
  it("returns only read-only tools when allowMutations is false", () => {
    const cfg = makeConfig({ allowMutations: false });
    const tools = buildToolCatalog(cfg);
    for (const t of tools) {
      expect(t.description).not.toContain("[MUTATING]");
    }
  });

  it("includes read-only tools regardless of allowMutations", () => {
    const cfgReadOnly = makeConfig({ allowMutations: false });
    const cfgWithMutations = makeConfig({ allowMutations: true });
    const readOnlyTools = buildToolCatalog(cfgReadOnly).map((t) => t.name);
    const mutatingTools = buildToolCatalog(cfgWithMutations).map((t) => t.name);
    for (const name of readOnlyTools) {
      expect(mutatingTools).toContain(name);
    }
  });

  it("includes more tools when allowMutations is true", () => {
    const readOnly = buildToolCatalog(makeConfig({ allowMutations: false }));
    const withMutations = buildToolCatalog(makeConfig({ allowMutations: true }));
    expect(withMutations.length).toBeGreaterThan(readOnly.length);
  });

  it("always includes list_blobs tool", () => {
    const tools = buildToolCatalog(makeConfig());
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_blobs");
  });

  it("always includes list_containers tool", () => {
    const tools = buildToolCatalog(makeConfig());
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_containers");
  });

  it("filters tools by toolsAllowlist", () => {
    const cfg = makeConfig({ toolsAllowlist: ["list_blobs", "view_blob"] });
    const tools = buildToolCatalog(cfg);
    expect(tools.length).toBe(2);
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_blobs");
    expect(names).toContain("view_blob");
  });

  it("mutation tools have [MUTATING] prefix in description", () => {
    const tools = buildToolCatalog(makeConfig({ allowMutations: true }));
    const mutating = tools.filter((t) => t.description.includes("[MUTATING]"));
    expect(mutating.length).toBeGreaterThan(0);
  });

  it("destructive tools have [DESTRUCTIVE] in description", () => {
    const tools = buildToolCatalog(makeConfig({ allowMutations: true }));
    const destructive = tools.filter((t) => t.description.includes("[DESTRUCTIVE]"));
    expect(destructive.length).toBeGreaterThan(0);
  });

  it("delete_blob is excluded without allowMutations", () => {
    const tools = buildToolCatalog(makeConfig({ allowMutations: false }));
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("delete_blob");
  });

  it("delete_blob is included with allowMutations", () => {
    const tools = buildToolCatalog(makeConfig({ allowMutations: true }));
    const names = tools.map((t) => t.name);
    expect(names).toContain("delete_blob");
  });

  it("all tool names are unique", () => {
    const tools = buildToolCatalog(makeConfig({ allowMutations: true }));
    const names = tools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});
