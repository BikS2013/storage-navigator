/**
 * Wrap a base system prompt with the user's persistent memory entries.
 *
 * When memory entries exist, append a `## Persistent memory` section listing
 * each entry's name and content. The TUI rebuilds this string on every turn
 * (cheap; no I/O caching) so /memory add takes effect immediately.
 */
import { listMemoryEntries } from "./memory.js";

export function buildSystemPromptWithMemory(basePrompt: string): string {
  const entries = listMemoryEntries();
  if (entries.length === 0) return basePrompt;
  const lines: string[] = [basePrompt.trimEnd(), "", "## Persistent memory", ""];
  lines.push(
    "The following are notes the user has stored across sessions. Take them",
    "into account but do NOT recite them back unless the user asks.",
    ""
  );
  for (const e of entries) {
    lines.push(`### ${e.name}`);
    lines.push(e.content.trimEnd());
    lines.push("");
  }
  return lines.join("\n");
}
