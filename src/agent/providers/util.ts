/**
 * Shared helpers for LLM provider factories.
 */

/**
 * Normalize an Azure AI Foundry base URL by stripping trailing slashes, removing
 * a trailing "/models" segment (if present), and appending the given path suffix.
 *
 * Azure Foundry endpoints sometimes arrive with a "/models" suffix or inconsistent
 * trailing slashes. This function ensures a canonical form before use.
 *
 * Examples:
 *   normalizeFoundryEndpoint("https://my.services.ai.azure.com/models", "/anthropic")
 *   => "https://my.services.ai.azure.com/anthropic"
 *
 *   normalizeFoundryEndpoint("https://my.services.ai.azure.com/", "/openai/v1")
 *   => "https://my.services.ai.azure.com/openai/v1"
 */
export function normalizeFoundryEndpoint(
  base: string,
  suffix: "/anthropic" | "/openai/v1"
): string {
  let b = base.trim().replace(/\/+$/, "");
  if (b.toLowerCase().endsWith("/models")) {
    b = b.slice(0, -"/models".length);
  }
  return b.replace(/\/+$/, "") + suffix;
}
