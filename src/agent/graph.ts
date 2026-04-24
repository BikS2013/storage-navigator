/**
 * LangGraph ReAct agent graph construction.
 *
 * Uses createAgent from the top-level langchain package (LangChain v1 API).
 * Do NOT use createReactAgent from @langchain/langgraph/prebuilt — that is
 * the deprecated LangGraph v0 API.
 */
import { createAgent } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { MemorySaver } from "@langchain/langgraph";

export interface CreateAgentGraphArgs {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  checkpointer?: MemorySaver;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAgentGraph(args: CreateAgentGraphArgs): any {
  return createAgent({
    model: args.model,
    tools: args.tools,
    systemPrompt: args.systemPrompt,
    checkpointer: args.checkpointer,
  });
}
