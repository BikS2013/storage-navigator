/** Fetch with rate-limit retry handling */
export async function rateLimitedFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") || res.headers.get("x-ratelimit-reset");
    if (retryAfter) {
      const waitSec = retryAfter.match(/^\d+$/)
        ? Math.max(parseInt(retryAfter, 10) - Math.floor(Date.now() / 1000), 1)
        : parseInt(retryAfter, 10);
      const waitMs = Math.min(waitSec * 1000, 60000);
      console.log(`Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
      return rateLimitedFetch(url, headers);
    }
  }
  return res;
}

/** Process items in batches with concurrency limit */
export async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/** Infer content type from file extension */
export function inferContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const textTypes: Record<string, string> = {
    json: "application/json",
    md: "text/markdown",
    txt: "text/plain",
    html: "text/html",
    css: "text/css",
    xml: "application/xml",
    yaml: "text/yaml",
    yml: "text/yaml",
    ts: "text/plain",
    js: "text/plain",
    py: "text/plain",
    go: "text/plain",
    rs: "text/plain",
    java: "text/plain",
    sh: "text/plain",
    bat: "text/plain",
    csv: "text/csv",
    svg: "image/svg+xml",
  };
  return textTypes[ext] ?? "application/octet-stream";
}
