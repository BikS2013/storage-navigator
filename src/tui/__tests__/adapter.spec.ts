/**
 * streamAgentTurn unit test — feed a fake graph emitting v2 events and assert
 * the StreamEvent sequence. This locks in the §4 event-mapping contract.
 */
import { describe, it, expect, vi } from "vitest";
import { streamAgentTurn, type StreamEvent } from "../../agent/stream.js";
import type { AgentConfig } from "../../config/agent-config.js";

function makeFakeGraph(events: unknown[]): { streamEvents: () => AsyncIterable<unknown> } {
  return {
    streamEvents() {
      return (async function* () {
        for (const e of events) yield e;
      })();
    },
  };
}

const baseCfg: AgentConfig = Object.freeze({
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

async function collect(args: Parameters<typeof streamAgentTurn>[0]): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of streamAgentTurn(args)) out.push(ev);
  return out;
}

describe("streamAgentTurn (spec §4 event contract)", () => {
  it("maps on_chat_model_stream → token, accumulates, emits final", async () => {
    const fake = makeFakeGraph([
      { event: "on_chat_model_stream", data: { chunk: { content: "hello " } } },
      { event: "on_chat_model_stream", data: { chunk: { content: "world" } } },
    ]);
    const events = await collect({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: {} as any,
      tools: [],
      systemPrompt: "",
      cfg: baseCfg,
      prompt: "hi",
      threadId: "t1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph: fake as any,
    });
    expect(events).toEqual([
      { kind: "token", text: "hello " },
      { kind: "token", text: "world" },
      { kind: "final", finalAnswer: "hello world" },
    ]);
  });

  it("maps on_tool_start and on_tool_end", async () => {
    const fake = makeFakeGraph([
      { event: "on_tool_start", name: "list_blobs", data: { input: { container: "x" } } },
      { event: "on_tool_end", name: "list_blobs", data: { output: '["a","b"]' } },
      { event: "on_chat_model_stream", data: { chunk: { content: "done" } } },
    ]);
    const events = await collect({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: {} as any,
      tools: [],
      systemPrompt: "",
      cfg: baseCfg,
      prompt: "list",
      threadId: "t2",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph: fake as any,
    });
    expect(events.map((e) => e.kind)).toEqual(["tool_start", "tool_end", "token", "final"]);
    expect((events[0] as { tool: { name: string } }).tool.name).toBe("list_blobs");
    expect((events[1] as { toolResult: { output: string } }).toolResult.output).toBe('["a","b"]');
  });

  it("yields error on graph exception", async () => {
    const fake = {
      streamEvents() {
        return (async function* () {
          yield { event: "on_chat_model_stream", data: { chunk: { content: "x" } } };
          throw new Error("model exploded");
        })();
      },
    };
    const events = await collect({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: {} as any,
      tools: [],
      systemPrompt: "",
      cfg: baseCfg,
      prompt: "p",
      threadId: "t3",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph: fake as any,
    });
    expect(events.map((e) => e.kind)).toEqual(["token", "error"]);
    expect((events[1] as { errorMessage: string }).errorMessage).toBe("model exploded");
  });

  it("returns silently when signal.aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fake = makeFakeGraph([
      { event: "on_chat_model_stream", data: { chunk: { content: "x" } } },
    ]);
    const events = await collect({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: {} as any,
      tools: [],
      systemPrompt: "",
      cfg: baseCfg,
      prompt: "p",
      threadId: "t4",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph: fake as any,
      signal: ctrl.signal,
    });
    // The first event triggers the aborted check and returns.
    expect(events).toEqual([]);
  });

  it("extracts text from Anthropic-style content blocks", async () => {
    const fake = makeFakeGraph([
      {
        event: "on_chat_model_stream",
        data: { chunk: { content: [{ type: "text", text: "block-text" }] } },
      },
    ]);
    const events = await collect({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: {} as any,
      tools: [],
      systemPrompt: "",
      cfg: baseCfg,
      prompt: "p",
      threadId: "t5",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph: fake as any,
    });
    expect(events).toEqual([
      { kind: "token", text: "block-text" },
      { kind: "final", finalAnswer: "block-text" },
    ]);
  });
});
