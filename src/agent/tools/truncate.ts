/**
 * Truncate a tool result to a maximum byte budget so large responses don't
 * overwhelm the model's context window.
 *
 * Rules:
 * - Arrays: drop tail entries, never reorder. Wrap with __truncated marker.
 * - Objects / strings: hard-truncate the serialized form. Wrap with __truncated marker.
 * - Output is always valid JSON.
 */
export function truncateToolResult(obj: unknown, maxBytes: number): string {
  const full = JSON.stringify(obj);
  if (Buffer.byteLength(full, "utf8") <= maxBytes) return full;

  if (Array.isArray(obj)) {
    const arr = [...obj];
    while (arr.length > 0) {
      arr.pop();
      const s = JSON.stringify({
        __truncated: true,
        kept: arr.length,
        original: (obj as unknown[]).length,
        items: arr,
      });
      if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
    }
    return JSON.stringify({ __truncated: true, kept: 0, original: (obj as unknown[]).length, items: [] });
  }

  // Object or string: hard-truncate the raw serialization
  const budget = Math.max(0, maxBytes - 64);
  const prefix = full.slice(0, budget);
  return JSON.stringify({ __truncated: true, raw: prefix + "…TRUNCATED" });
}
