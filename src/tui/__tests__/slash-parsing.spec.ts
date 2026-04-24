/**
 * Slash-command parsing + dispatch tests.
 */
import { describe, it, expect, vi } from "vitest";
import { tokenize } from "../slash/context.js";
import { helpCommand } from "../slash/help.js";
import { lastCommand } from "../slash/last.js";
import { newCommand } from "../slash/new.js";
import { allowMutationsCommand } from "../slash/allow-mutations.js";
import type { SlashContext } from "../slash/context.js";
import type { AgentConfig } from "../../config/agent-config.js";

function makeCtx(overrides: Partial<SlashContext> = {}): SlashContext {
  const printed: string[] = [];
  const cfg: AgentConfig = Object.freeze({
    provider: "openai",
    model: "gpt-4o",
    temperature: 0,
    maxSteps: 5,
    perToolBudgetBytes: 16384,
    systemPrompt: null,
    systemPromptFile: null,
    toolsAllowlist: null,
    allowMutations: false,
    envFilePath: null,
    configFilePath: null,
    baseUrl: null,
    verbose: false,
    interactive: true,
    providerEnv: Object.freeze({}),
  }) as AgentConfig;
  const ctx: SlashContext = {
    cfg,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: {} as any,
    tools: [],
    systemPromptBase: "",
    threadId: "tid-test",
    messages: [],
    inputHistory: [],
    lastAgentText: "",
    graph: null,
    checkpointer: null,
    logFilePath: "/tmp/x.log",
    printSystem: (m: string) => printed.push(`[sys]${m}`),
    println: (m = "") => printed.push(m),
    resetSession: vi.fn(),
    rebuildModel: vi.fn(),
    rebuildToolCatalog: vi.fn(),
    rebuildGraph: vi.fn(),
    refreshBanner: vi.fn(),
    exit: vi.fn(),
    ...overrides,
  };
  // Stash printed lines for assertion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx as any)._printed = printed;
  return ctx;
}

describe("tokenize", () => {
  it("splits by whitespace", () => {
    expect(tokenize("/model gpt-4o")).toEqual(["/model", "gpt-4o"]);
  });
  it("respects double quotes", () => {
    expect(tokenize('/memory add note "this is a multi word value"')).toEqual([
      "/memory",
      "add",
      "note",
      "this is a multi word value",
    ]);
  });
  it("handles empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("/help", () => {
  it("prints commands and keybindings", async () => {
    const ctx = makeCtx();
    await helpCommand.run(ctx, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const printed = (ctx as any)._printed.join("\n");
    expect(printed).toContain("/quit");
    expect(printed).toContain("Shift+Enter");
    expect(printed).toContain("ESC during execution");
  });
});

describe("/last", () => {
  it("warns when no answer", async () => {
    const ctx = makeCtx();
    await lastCommand.run(ctx, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((ctx as any)._printed.join("\n")).toContain("No assistant response");
  });
  it("prints the stored answer", async () => {
    const ctx = makeCtx({ lastAgentText: "the previous answer" });
    await lastCommand.run(ctx, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((ctx as any)._printed.join("\n")).toContain("the previous answer");
  });
});

describe("/new", () => {
  it("calls resetSession", async () => {
    const ctx = makeCtx();
    await newCommand.run(ctx, []);
    expect(ctx.resetSession).toHaveBeenCalled();
  });
});

describe("/allow-mutations", () => {
  it("toggles cfg.allowMutations and rebuilds the catalog", async () => {
    const ctx = makeCtx();
    expect(ctx.cfg.allowMutations).toBe(false);
    await allowMutationsCommand.run(ctx, []);
    expect(ctx.cfg.allowMutations).toBe(true);
    expect(ctx.rebuildToolCatalog).toHaveBeenCalled();
    expect(ctx.rebuildGraph).toHaveBeenCalled();
    expect(ctx.refreshBanner).toHaveBeenCalled();
    // toggle again
    await allowMutationsCommand.run(ctx, []);
    expect(ctx.cfg.allowMutations).toBe(false);
  });
});
