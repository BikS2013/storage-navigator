/**
 * Streaming seam for the TUI.
 *
 * The existing runInteractive uses graph.invoke() which is blocking and
 * returns the final state. The TUI needs token-by-token output, so we wrap
 * graph.streamEvents() (LangGraph v2 schema) into a normalised StreamEvent
 * generator. ESC-to-abort is propagated via the AbortSignal.
 *
 * One graph instance per session is reused across turns when a checkpointer
 * is supplied — this is what enables persistent conversation state via
 * MemorySaver while still streaming tokens.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AgentConfig } from "../config/agent-config.js";
import type { AgentStep } from "./run.js";
import { createAgentGraph } from "./graph.js";

export type StreamEvent =
  | { kind: "token"; text: string }
  | { kind: "tool_start"; tool: { name: string; args: unknown } }
  | { kind: "tool_end"; toolResult: { name: string; output: string } }
  | { kind: "step"; step: AgentStep }
  | { kind: "final"; finalAnswer: string }
  | { kind: "error"; errorMessage: string };

export interface StreamArgs {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  cfg: AgentConfig;
  prompt: string;
  threadId: string;
  signal?: AbortSignal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  checkpointer?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graph?: any; // optional pre-built graph (TUI keeps one across turns)
}

/**
 * Extract a string text fragment from a LangGraph chat-model stream chunk.
 * The chunk's `content` may be a plain string OR an array of content blocks
 * (Anthropic-style: { type: "text", text: "..." } | { type: "tool_use", ... }).
 */
function extractTokenText(chunk: unknown): string {
  if (chunk == null) return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = chunk as any;
  const content = c.content ?? c.text ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    let out = "";
    for (const block of content) {
      if (typeof block === "string") out += block;
      else if (block && typeof block === "object") {
        if (typeof block.text === "string") out += block.text;
        else if (block.type === "text" && typeof block.value === "string") out += block.value;
      }
    }
    return out;
  }
  return "";
}

export async function* streamAgentTurn(args: StreamArgs): AsyncGenerator<StreamEvent> {
  const graph =
    args.graph ??
    createAgentGraph({
      model: args.model,
      tools: args.tools,
      systemPrompt: args.systemPrompt,
      checkpointer: args.checkpointer,
    });

  const input = { messages: [{ role: "user", content: args.prompt }] };
  const config = {
    recursionLimit: args.cfg.maxSteps,
    configurable: { thread_id: args.threadId },
    version: "v2" as const,
    signal: args.signal,
  };

  let final = "";
  try {
    // graph.streamEvents returns an AsyncIterable of v2 events.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: AsyncIterable<any> = graph.streamEvents(input, config);
    for await (const ev of stream) {
      if (args.signal?.aborted) return;
      const evType = ev?.event as string | undefined;
      if (!evType) continue;

      if (evType === "on_chat_model_stream") {
        const chunk = ev?.data?.chunk;
        const text = extractTokenText(chunk);
        if (text.length > 0) {
          final += text;
          yield { kind: "token", text };
        }
      } else if (evType === "on_tool_start") {
        const name = (ev.name as string | undefined) ?? "tool";
        const toolArgs = ev?.data?.input ?? ev?.data ?? {};
        yield { kind: "tool_start", tool: { name, args: toolArgs } };
      } else if (evType === "on_tool_end") {
        const name = (ev.name as string | undefined) ?? "tool";
        const out = ev?.data?.output;
        const outStr =
          typeof out === "string"
            ? out
            : out == null
            ? ""
            : (() => {
                try { return JSON.stringify(out); }
                catch { return String(out); }
              })();
        yield { kind: "tool_end", toolResult: { name, output: outStr } };
      }
      // All other event types ignored (spec §4).
    }
    yield { kind: "final", finalAnswer: final };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (args.signal?.aborted || /AbortError|aborted/i.test(msg)) {
      return; // caller treats the absence of "final" + signal.aborted as interrupted
    }
    yield { kind: "error", errorMessage: msg };
  }
}
