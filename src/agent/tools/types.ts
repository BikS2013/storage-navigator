import type { StructuredToolInterface } from "@langchain/core/tools";
import { ConfigurationError } from "../../config/agent-config.js";

/**
 * Routes errors thrown by command modules into either tool-result strings
 * (recoverable) or rethrows (fatal).
 *
 * - ConfigurationError (exit 3) → rethrow (agent can't fix missing config)
 * - All other errors → return as JSON error string so the model can self-correct
 */
export function handleToolError(err: unknown): string {
  if (err instanceof ConfigurationError) throw err;

  // Recoverable: return structured error text for the model to reason about
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code ?? "UNKNOWN";
  const httpStatus = (err as { httpStatus?: number }).httpStatus ?? null;

  return JSON.stringify({
    error: { code, message, httpStatus },
  });
}

export type ToolAdapterFactory = (
  cfg: import("../../config/agent-config.js").AgentConfig
) => StructuredToolInterface;
