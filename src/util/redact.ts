/**
 * Redaction utility for agent log output.
 *
 * Redacts patterns that commonly appear in log lines:
 * - Bearer / Basic auth tokens
 * - API key-shaped strings (long hex or base64url runs)
 * - SAS token query strings
 * - Account keys (64-char base64)
 */

const REDACT_PATTERNS: [RegExp, string][] = [
  // Bearer / Basic authorization headers
  [/(Authorization:\s*(?:Bearer|Basic)\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[REDACTED]"],
  // SAS token query parameters (sv=, sig=, se=, ...)
  [/((?:sv|sig|st|se|sp|spr|srt|ss)=)[^&\s"']+/gi, "$1[REDACTED]"],
  // Account keys — 64+ char base64 strings
  [/[A-Za-z0-9+/]{64,}={0,2}/g, "[REDACTED-KEY]"],
  // JWT structure (header.payload.signature)
  [/ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[REDACTED-JWT]"],
  // OpenAI-style API keys (sk-..., sk-proj-...)
  [/sk-(?:proj-)?[A-Za-z0-9\-_]{8,}/g, "[REDACTED-KEY]"],
  // Generic "key": "value" where value looks like a secret
  [/("(?:token|key|secret|password|apiKey|api_key|accountKey|sasToken)":\s*")[^"]{8,}(")/gi, '$1[REDACTED]$2'],
];

/**
 * Redact sensitive values from a log line string.
 * Returns the sanitized string; safe to write to stderr or log files.
 */
export function redactString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
