/**
 * Mutable session context shared across slash commands.
 *
 * The TUI entry point owns this object; commands mutate it through helper
 * methods on the context (e.g. resetSession, rebuildToolCatalog) so the loop
 * in index.ts doesn't need to know each command's internals.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AgentConfig } from "../../config/agent-config.js";

export interface LocalMessage {
  role: "user" | "agent";
  text: string;
  timestamp: number;
}

export interface SlashContext {
  // ── Mutable session state ────────────────────────────────────────────
  cfg: AgentConfig;
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPromptBase: string;
  threadId: string;
  messages: LocalMessage[];
  inputHistory: string[];
  lastAgentText: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graph: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  checkpointer: any;
  logFilePath: string;

  // ── Mutators provided by the entry point ─────────────────────────────
  printSystem(msg: string): void;
  println(msg?: string): void;
  resetSession(): void;
  rebuildModel(newCfg: AgentConfig): void;
  rebuildToolCatalog(): void;
  rebuildGraph(): void;
  refreshBanner(): void;
  exit(code: number): void;
}

export interface SlashCommand {
  name: string;
  aliases?: string[];
  brief: string;
  run(ctx: SlashContext, args: string[]): Promise<void>;
}

/**
 * Tokenise a slash-command line into a name and args array.
 * Supports double-quoted values for /memory add and /model-style flags.
 */
export function tokenize(line: string): string[] {
  const matches = line.match(/(?:[^\s"]+|"[^"]*")/g) ?? [];
  return matches.map((t) => (t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t));
}
