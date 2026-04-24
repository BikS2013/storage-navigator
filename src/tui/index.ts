/**
 * storage-nav agent TUI — raw-mode terminal UI on top of the LangGraph ReAct
 * agent in src/agent/graph.ts. Implements spec §2 / §5 / §6 / §7 / §8.
 *
 * Mounted from src/cli/commands/agent.ts when --interactive AND stdin.isTTY.
 * For piped/non-TTY interactive use the existing line-based runInteractive
 * fallback is preserved.
 */
import * as fs from "node:fs";
import { performance } from "node:perf_hooks";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";

import type { AgentConfig } from "../config/agent-config.js";
import { buildModel } from "../agent/providers/registry.js";
import { buildToolCatalog } from "../agent/tools/registry.js";
import { createAgentGraph } from "../agent/graph.js";
import { streamAgentTurn } from "../agent/stream.js";
import type { AgentLogger } from "../agent/logging.js";

import { readInput, PROMPT, CONT_PROMPT } from "./reader.js";
import { createSpinner } from "./spinner.js";
import {
  RESET, BOLD, DIM, GREEN, CYAN, YELLOW, RED, MAGENTA,
} from "./ansi.js";
import { setTuiConfirm } from "./confirm-bridge.js";
import type { ConfirmResult } from "../agent/tools/confirm.js";
import { buildSystemPromptWithMemory } from "./system-prompt-with-memory.js";

import type { SlashCommand, SlashContext, LocalMessage } from "./slash/context.js";
import { tokenize } from "./slash/context.js";
import { helpCommand } from "./slash/help.js";
import { quitCommand } from "./slash/quit.js";
import { newCommand } from "./slash/new.js";
import { historyCommand } from "./slash/history.js";
import { lastCommand } from "./slash/last.js";
import { copyCommand } from "./slash/copy.js";
import { memoryCommand } from "./slash/memory.js";
import { modelCommand } from "./slash/model.js";
import { providerCommand } from "./slash/provider.js";
import { toolsCommand } from "./slash/tools.js";
import { allowMutationsCommand } from "./slash/allow-mutations.js";

// ── Slash registry ───────────────────────────────────────────────────────────

const COMMANDS: SlashCommand[] = [
  helpCommand, quitCommand, newCommand, historyCommand, lastCommand, copyCommand,
  memoryCommand, modelCommand, providerCommand, toolsCommand, allowMutationsCommand,
];

function findCommand(name: string): SlashCommand | undefined {
  for (const c of COMMANDS) {
    if (c.name === name) return c;
    if (c.aliases?.includes(name)) return c;
  }
  return undefined;
}

// ── Banner ───────────────────────────────────────────────────────────────────

function renderBanner(cfg: AgentConfig, threadId: string, toolCount: number, logFile: string): string {
  const lines: string[] = [];
  lines.push(`${BOLD}${MAGENTA}storage-nav · agent · TUI${RESET}`);
  lines.push(`${DIM}Provider: ${cfg.provider}   Model: ${cfg.model}${RESET}`);
  lines.push(`${DIM}Tools: ${toolCount}   Mutations: ${cfg.allowMutations ? `${YELLOW}ENABLED${DIM}` : "disabled"}${RESET}`);
  lines.push(`${DIM}Session: ${threadId.slice(0, 24)}…${RESET}`);
  lines.push(`${DIM}Log: ${logFile}${RESET}`);
  lines.push(`${DIM}Commands: /help /quit /new /history /last /copy /memory /model /provider /tools /allow-mutations${RESET}`);
  lines.push(`${DIM}Shift+Enter or Ctrl+J for newline, Enter to send. ESC aborts an in-flight turn.${RESET}`);
  return lines.join("\n");
}

// ── Entry point ──────────────────────────────────────────────────────────────

export interface RunTuiArgs {
  initialCfg: AgentConfig;
  initialModel: BaseChatModel;
  initialTools: StructuredToolInterface[];
  initialSystemPromptBase: string;
  logger: AgentLogger;
  logFilePath: string;
}

export async function runTui(args: RunTuiArgs): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("storage-nav agent TUI requires a TTY. Pipe input is not supported.");
  }

  // ── State (mutable session) ─────────────────────────────────────────
  let cfg = args.initialCfg;
  let model = args.initialModel;
  let tools = args.initialTools;
  const systemPromptBase = args.initialSystemPromptBase;
  let threadId = makeThreadId();
  const messages: LocalMessage[] = [];
  const inputHistory: string[] = [];
  let lastAgentText = "";

  // Build initial graph + checkpointer (per spec, MemorySaver scoped to session).
  // We dynamic-import MemorySaver to match the existing src/agent/run.ts pattern.
  const { MemorySaver } = await import("@langchain/langgraph");
  let checkpointer = new MemorySaver();
  function buildSystemPromptNow(): string { return buildSystemPromptWithMemory(systemPromptBase); }
  let graph = createAgentGraph({ model, tools, systemPrompt: buildSystemPromptNow(), checkpointer });

  // Print helpers
  const out = process.stdout;
  function printSystem(msg: string): void {
    out.write(`${DIM}${YELLOW}[system]${RESET} ${DIM}${msg}${RESET}\n`);
  }
  function println(msg = ""): void {
    out.write(`${msg}\n`);
  }
  let bannerPrinted = false;
  function printBanner(): void {
    out.write(renderBanner(cfg, threadId, tools.length, args.logFilePath));
    out.write("\n");
    bannerPrinted = true;
  }

  // Slash context
  const ctx: SlashContext = {
    get cfg() { return cfg; },
    set cfg(v: AgentConfig) { cfg = v; },
    get model() { return model; },
    set model(v: BaseChatModel) { model = v; },
    get tools() { return tools; },
    set tools(v: StructuredToolInterface[]) { tools = v; },
    systemPromptBase,
    get threadId() { return threadId; },
    set threadId(v: string) { threadId = v; },
    messages,
    inputHistory,
    get lastAgentText() { return lastAgentText; },
    set lastAgentText(v: string) { lastAgentText = v; },
    get graph() { return graph; },
    set graph(v: unknown) { graph = v as typeof graph; },
    get checkpointer() { return checkpointer; },
    set checkpointer(v: unknown) { checkpointer = v as typeof checkpointer; },
    logFilePath: args.logFilePath,
    printSystem,
    println,
    resetSession: () => {
      threadId = makeThreadId();
      messages.length = 0;
      lastAgentText = "";
      checkpointer = new MemorySaver();
      graph = createAgentGraph({ model, tools, systemPrompt: buildSystemPromptNow(), checkpointer });
    },
    rebuildModel: (newCfg: AgentConfig) => {
      cfg = newCfg;
      model = buildModel(cfg);
      graph = createAgentGraph({ model, tools, systemPrompt: buildSystemPromptNow(), checkpointer });
    },
    rebuildToolCatalog: () => {
      tools = buildToolCatalog(cfg);
      graph = createAgentGraph({ model, tools, systemPrompt: buildSystemPromptNow(), checkpointer });
    },
    rebuildGraph: () => {
      graph = createAgentGraph({ model, tools, systemPrompt: buildSystemPromptNow(), checkpointer });
    },
    refreshBanner: () => {
      // Re-print one-line summary (don't redraw the whole banner — would
      // overwrite the previous transcript above the prompt).
      printSystem(`Provider=${cfg.provider}  Model=${cfg.model}  Tools=${tools.length}  Mutations=${cfg.allowMutations ? "on" : "off"}`);
    },
    exit: (code: number) => {
      cleanupTerminal();
      try { args.logger.close(); } catch { /* ignore */ }
      process.exit(code);
    },
  };

  // Install confirmation bridge so destructive tools prompt through the TUI.
  setTuiConfirm(async (summary: string): Promise<ConfirmResult> => {
    return await tuiConfirm(summary);
  });

  // Global handlers
  installSignalHandlers(() => ctx.exit(130));
  installResizeHandler();
  installUnhandledRejectionRecovery(args.logger);

  function cleanupTerminal(): void {
    try { process.stdin.setRawMode?.(false); } catch { /* ignore */ }
    try { process.stdin.pause(); } catch { /* ignore */ }
    setTuiConfirm(null);
  }

  process.on("exit", () => {
    try { process.stdin.setRawMode?.(false); } catch { /* ignore */ }
  });

  printBanner();

  // ── Confirmation modal ──────────────────────────────────────────────
  async function tuiConfirm(summary: string): Promise<ConfirmResult> {
    out.write(`\n${BOLD}${RED}[CONFIRM]${RESET} ${summary}\n${DIM}Type y/yes to proceed, anything else to cancel.${RESET}\n`);
    let answer = "";
    try {
      answer = await readInput({
        prompt: `${RED}confirm>${RESET} `,
        continuationPrompt: `${RED} ..>${RESET} `,
        inputHistory: [],
      });
    } catch (err) {
      const msg = (err as Error).message;
      return { confirmed: false, message: `Confirmation cancelled (${msg}).` };
    }
    const a = answer.trim().toLowerCase();
    const ok = a === "y" || a === "yes";
    return { confirmed: ok, message: ok ? "User confirmed." : "User declined. Operation cancelled." };
  }

  // ── REPL loop ───────────────────────────────────────────────────────
  for (;;) {
    let line: string;
    try {
      line = await readInput({ prompt: PROMPT, continuationPrompt: CONT_PROMPT, inputHistory });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "EOF") {
        println("");
        ctx.exit(0);
        return;
      }
      if (msg === "SIGINT") {
        // Single Ctrl+C while at the prompt: cancel current input and re-loop.
        out.write("\n");
        continue;
      }
      throw err;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== trimmed) {
      inputHistory.push(trimmed);
    }

    if (trimmed.startsWith("/")) {
      const tokens = tokenize(trimmed);
      const cmdName = tokens[0]!;
      const cmd = findCommand(cmdName);
      if (!cmd) {
        printSystem(`Unknown command "${cmdName}". Try /help.`);
        continue;
      }
      try {
        await cmd.run(ctx, tokens.slice(1));
      } catch (err) {
        printSystem(`/${cmd.name} failed: ${(err as Error).message}`);
      }
      if (!bannerPrinted) printBanner(); // safety
      continue;
    }

    // ── Agent turn ──────────────────────────────────────────────────
    messages.push({ role: "user", text: trimmed, timestamp: Date.now() });
    const turnStart = performance.now();
    const spinner = createSpinner("Thinking...");
    spinner.start();

    const abort = new AbortController();
    const escListener = (chunk: Buffer): void => {
      for (const b of chunk) {
        if (b === 0x1b /* ESC */ || b === 0x03 /* Ctrl+C */) {
          abort.abort();
          return;
        }
      }
    };
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", escListener);

    let agentText = "";
    let headerPrinted = false;
    let interrupted = false;
    function printHeaderOnce(trailingSpace = true): void {
      if (headerPrinted) return;
      headerPrinted = true;
      out.write(`${BOLD}${CYAN}Agent${RESET}${trailingSpace ? " " : ""}`);
    }

    try {
      for await (const ev of streamAgentTurn({
        model, tools, systemPrompt: buildSystemPromptNow(),
        cfg, prompt: trimmed, threadId, signal: abort.signal,
        checkpointer, graph,
      })) {
        if (abort.signal.aborted) { interrupted = true; break; }
        if (ev.kind === "token") {
          spinner.stop();
          printHeaderOnce(true);
          out.write(ev.text);
          agentText += ev.text;
        } else if (ev.kind === "tool_start") {
          spinner.stop();
          printHeaderOnce(false);
          out.write(`\n  ${DIM}↳ calling ${ev.tool.name}(...)${RESET}`);
        } else if (ev.kind === "tool_end") {
          out.write(` ${GREEN}✓${RESET}`);
          spinner.setLabel("Processing tool result...");
          spinner.start();
        } else if (ev.kind === "error") {
          spinner.stop();
          out.write(`\n${RED}[error] ${ev.errorMessage}${RESET}\n`);
        } else if (ev.kind === "final") {
          // accumulated text is final
        }
      }
    } catch (err) {
      spinner.stop();
      out.write(`\n${RED}[error] ${(err as Error).message}${RESET}\n`);
      args.logger.error("Agent turn failed", { message: (err as Error).message });
    } finally {
      spinner.stop();
      process.stdin.off("data", escListener);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      const ms = Math.round(performance.now() - turnStart);
      args.logger.info("Turn complete", { durationMs: ms, interrupted, chars: agentText.length });
    }

    if (interrupted) {
      out.write(`\n${YELLOW}[interrupted]${RESET}\n`);
    } else {
      out.write("\n");
    }
    if (agentText) {
      lastAgentText = agentText;
      messages.push({ role: "agent", text: agentText, timestamp: Date.now() });
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function makeThreadId(): string {
  return `storage-nav-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function installSignalHandlers(onExit: () => void): void {
  let lastSigint = 0;
  process.on("SIGINT", () => {
    const now = Date.now();
    if (now - lastSigint < 1500) {
      onExit();
      return;
    }
    lastSigint = now;
    // The reader handles single Ctrl+C internally; we only act on a quick
    // double-press while the reader is detached (between turns).
  });
  process.on("SIGTERM", () => onExit());
}

function installResizeHandler(): void {
  process.stdout.on?.("resize", () => {
    // We don't redraw a transcript, so all we need is to make sure the
    // current line redraw uses the new width. The reader recomputes on
    // every keystroke so this is a no-op today, but the listener avoids
    // Node treating SIGWINCH as fatal when no listeners are attached.
  });
}

function installUnhandledRejectionRecovery(logger: AgentLogger): void {
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (
      /Error reading from the stream/i.test(msg) ||
      /GoogleGenerativeAI/i.test(msg) ||
      /AbortError/i.test(msg)
    ) {
      logger.warn("Recovered unhandled rejection", { message: msg });
      return;
    }
    logger.error("Unhandled rejection", { message: msg });
    process.stderr.write(`\nFatal: ${msg}\n`);
    process.exit(1);
  });
}

// ── External wrapper used by src/cli/commands/agent.ts ───────────────────────

export interface MountTuiArgs {
  cfg: AgentConfig;
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  logger: AgentLogger;
  logFilePath: string;
}

export async function mountTui(args: MountTuiArgs): Promise<void> {
  // Quick sanity write so the user sees we've taken over (helps when the
  // banner is delayed by graph init).
  if (!fs.existsSync(args.logFilePath)) {
    try { fs.appendFileSync(args.logFilePath, "", { mode: 0o600 }); } catch { /* ignore */ }
  }
  await runTui({
    initialCfg: args.cfg,
    initialModel: args.model,
    initialTools: args.tools,
    initialSystemPromptBase: args.systemPrompt,
    logger: args.logger,
    logFilePath: args.logFilePath,
  });
}
