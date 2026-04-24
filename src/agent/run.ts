/**
 * Agent execution — one-shot and interactive modes.
 */
import * as readline from "readline";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AIMessage } from "@langchain/core/messages";
import type { AgentConfig } from "../config/agent-config.js";
import type { AgentLogger } from "./logging.js";
import { createAgentGraph } from "./graph.js";

export interface AgentStep {
  index: number;
  tool?: string;
  args?: unknown;
  result?: string;
  reasoning?: string;
}

export interface AgentUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export interface AgentMeta {
  maxSteps: number;
  stepsUsed: number;
  durationMs: number;
  terminatedBy: "final" | "maxSteps" | "error" | "interrupted";
}

export interface AgentResult {
  answer: string;
  provider: string;
  model: string;
  steps: AgentStep[];
  usage: AgentUsage;
  meta: AgentMeta;
}

// ── Step extraction ───────────────────────────────────────────────────────────

function extractStepsAndAnswer(
  messages: AIMessage[]
): { steps: AgentStep[]; answer: string; usage: AgentUsage } {
  const steps: AgentStep[] = [];
  let stepIndex = 0;
  let answer = "";
  const usage: AgentUsage = { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 };

  for (const msg of messages) {
    // Accumulate token usage from AIMessages
    const msgAny = msg as unknown as Record<string, unknown>;
    const meta = msgAny["response_metadata"] as Record<string, unknown> | undefined;
    const usageMeta = msgAny["usage_metadata"] as Record<string, unknown> | undefined;
    if (usageMeta) {
      usage.totalInputTokens += (usageMeta["input_tokens"] as number) ?? 0;
      usage.totalOutputTokens += (usageMeta["output_tokens"] as number) ?? 0;
      usage.totalTokens += (usageMeta["total_tokens"] as number) ?? 0;
    } else if (meta?.["tokenUsage"]) {
      const tu = meta["tokenUsage"] as Record<string, number>;
      usage.totalInputTokens += tu["promptTokens"] ?? 0;
      usage.totalOutputTokens += tu["completionTokens"] ?? 0;
      usage.totalTokens += tu["totalTokens"] ?? 0;
    }

    if (msg._getType?.() === "ai") {
      const toolCalls = msgAny["tool_calls"] as Array<{
        name: string;
        args: unknown;
        id?: string;
      }> | undefined;

      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          steps.push({ index: ++stepIndex, tool: tc.name, args: tc.args });
        }
      } else {
        // Final answer — no tool calls
        const content = msg.content;
        answer = typeof content === "string" ? content : JSON.stringify(content);
      }
    } else if (msg._getType?.() === "tool") {
      // Attach result to most recently opened step
      const lastStep = steps[steps.length - 1];
      if (lastStep) {
        lastStep.result = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      }
    }
  }

  return { steps, answer, usage };
}

// ── One-shot ──────────────────────────────────────────────────────────────────

export async function runOneShot(args: {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  cfg: AgentConfig;
  prompt: string;
  logger: AgentLogger;
}): Promise<AgentResult> {
  const { model, tools, systemPrompt, cfg, prompt, logger } = args;
  const startMs = Date.now();

  const promptDisplay = prompt.length > 2048
    ? `<${prompt.length}-char prompt>`
    : prompt;
  logger.info(`Starting one-shot run`, { provider: cfg.provider, model: cfg.model, promptLength: prompt.length });

  const graph = createAgentGraph({ model, tools, systemPrompt });

  let final: Record<string, unknown>;
  let terminatedBy: AgentMeta["terminatedBy"] = "final";

  try {
    final = await graph.invoke(
      { messages: [{ role: "user", content: prompt }] },
      { recursionLimit: cfg.maxSteps }
    ) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("RecursionLimit") || msg.includes("recursion limit")) {
      terminatedBy = "maxSteps";
      logger.warn("Max steps reached", { maxSteps: cfg.maxSteps });
      return {
        answer: `[Agent stopped: reached maximum step limit of ${cfg.maxSteps}]`,
        provider: cfg.provider,
        model: cfg.model,
        steps: [],
        usage: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 },
        meta: { maxSteps: cfg.maxSteps, stepsUsed: cfg.maxSteps, durationMs: Date.now() - startMs, terminatedBy },
      };
    }
    throw err;
  }

  const messages = (final["messages"] ?? []) as AIMessage[];
  const { steps, answer, usage } = extractStepsAndAnswer(messages);

  // Emit per-step trace if verbose
  for (const s of steps) {
    logger.step(s);
  }

  const durationMs = Date.now() - startMs;
  logger.info(`Run complete`, { steps: steps.length, durationMs, terminatedBy });

  return {
    answer,
    provider: cfg.provider,
    model: cfg.model,
    steps,
    usage,
    meta: {
      maxSteps: cfg.maxSteps,
      stepsUsed: steps.length,
      durationMs,
      terminatedBy,
    },
  };
}

// ── Interactive REPL ──────────────────────────────────────────────────────────

export async function runInteractive(args: {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  cfg: AgentConfig;
  logger: AgentLogger;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}): Promise<void> {
  const { model, tools, systemPrompt, cfg, logger } = args;
  const stdin = args.stdin ?? process.stdin;
  const stdout = args.stdout ?? process.stdout;

  const { MemorySaver } = await import("@langchain/langgraph");
  const checkpointer = new MemorySaver();

  let threadId = `storage-nav-${process.pid}-${Date.now()}`;
  let graph = createAgentGraph({ model, tools, systemPrompt, checkpointer });

  stdout.write("storage-nav agent (interactive mode). Type /exit to quit, /reset to start fresh.\n");
  stdout.write(`Provider: ${cfg.provider}  Model: ${cfg.model}  Mutations: ${cfg.allowMutations ? "enabled" : "disabled"}\n\n`);

  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: false });

  let running = true;

  process.on("SIGINT", () => {
    stdout.write("\n[Interrupted]\n");
    rl.close();
    process.exit(130);
  });

  const lineHandler = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed === "/exit" || trimmed === "exit") {
      stdout.write("Goodbye.\n");
      rl.close();
      running = false;
      return;
    }

    if (trimmed === "/reset") {
      threadId = `storage-nav-${process.pid}-${Date.now()}`;
      graph = createAgentGraph({ model, tools, systemPrompt, checkpointer });
      stdout.write("[Conversation reset. Starting fresh.]\n\n");
      return;
    }

    try {
      const result = await graph.invoke(
        { messages: [{ role: "user", content: trimmed }] },
        {
          recursionLimit: cfg.maxSteps,
          configurable: { thread_id: threadId },
        }
      ) as Record<string, unknown>;

      const messages = (result["messages"] ?? []) as AIMessage[];
      const { steps, answer } = extractStepsAndAnswer(messages);

      if (cfg.verbose) {
        for (const s of steps) logger.step(s);
      }

      if (answer) {
        stdout.write(`\n${answer}\n\n`);
      } else if (steps.length > 0) {
        stdout.write(`\n[Agent completed ${steps.length} step(s) with no final answer.]\n\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Error during interactive turn", { message: msg });
      stdout.write(`\n[Error: ${msg}]\n\n`);
    }
  };

  rl.on("line", (line) => {
    // Use void to acknowledge intentional floating promise in event handler
    void lineHandler(line);
  });

  await new Promise<void>((resolve) => {
    rl.on("close", () => resolve());
  });
}
