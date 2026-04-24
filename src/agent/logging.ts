/**
 * Agent logger with mandatory redaction.
 *
 * Every write to stderr or a log file passes through redactString().
 * Log files are created with mode 0600.
 */
import * as fs from "fs";
import { redactString } from "../util/redact.js";
import type { AgentStep } from "./run.js";

export interface AgentLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  step(s: AgentStep): void;
  close(): Promise<void>;
}

function formatLine(level: string, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${ts}] [${level}] ${msg}${metaStr}`;
}

export function createAgentLogger(
  cfg: { verbose: boolean },
  opts: { logFilePath?: string | null; quiet?: boolean }
): AgentLogger {
  let handle: fs.WriteStream | null = null;

  if (opts.logFilePath) {
    handle = fs.createWriteStream(opts.logFilePath, { flags: "a", mode: 0o600 });
  }

  function write(line: string): void {
    const safe = redactString(line);
    if (!opts.quiet) {
      process.stderr.write(safe + "\n");
    }
    if (handle) {
      handle.write(safe + "\n");
    }
  }

  function info(msg: string, meta?: Record<string, unknown>): void {
    write(formatLine("INFO", msg, meta));
  }

  function warn(msg: string, meta?: Record<string, unknown>): void {
    write(formatLine("WARN", msg, meta));
  }

  function error(msg: string, meta?: Record<string, unknown>): void {
    write(formatLine("ERROR", msg, meta));
  }

  function step(s: AgentStep): void {
    if (!cfg.verbose) return;
    const maxLen = 200;
    if (s.tool) {
      const argsStr = JSON.stringify(s.args ?? {}).slice(0, maxLen);
      write(formatLine("STEP", `[step ${s.index}] tool=${s.tool} args=${argsStr}`));
    }
    if (s.result !== undefined) {
      const resultStr = s.result.slice(0, maxLen);
      write(formatLine("STEP", `[step ${s.index}] result=${resultStr}`));
    }
    if (s.reasoning) {
      const reasonStr = s.reasoning.slice(0, maxLen);
      write(formatLine("STEP", `[step ${s.index}] reasoning=${reasonStr}`));
    }
  }

  async function close(): Promise<void> {
    if (handle) {
      await new Promise<void>((resolve, reject) => {
        handle!.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  return { info, warn, error, step, close };
}
