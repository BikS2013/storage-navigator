const MAX_RATE_LIMIT_RETRIES = 5;

/** Fetch with rate-limit retry handling */
export async function rateLimitedFetch(url: string, headers: Record<string, string>, _retryCount: number = 0): Promise<Response> {
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    if (_retryCount >= MAX_RATE_LIMIT_RETRIES) {
      throw new Error(`Rate limited after ${MAX_RATE_LIMIT_RETRIES} retries: ${res.status} ${url}`);
    }

    // x-ratelimit-reset is a Unix epoch timestamp (GitHub); Retry-After is delta seconds (Azure DevOps/standard)
    const resetHeader = res.headers.get("x-ratelimit-reset");
    const retryAfterHeader = res.headers.get("Retry-After");

    let waitSec = 5; // default backoff
    if (resetHeader && resetHeader.match(/^\d+$/)) {
      // Unix epoch timestamp — compute seconds until that time
      waitSec = Math.max(parseInt(resetHeader, 10) - Math.floor(Date.now() / 1000), 1);
    } else if (retryAfterHeader && retryAfterHeader.match(/^\d+$/)) {
      // Delta seconds — use directly
      waitSec = Math.max(parseInt(retryAfterHeader, 10), 1);
    }

    const waitMs = Math.min(waitSec * 1000, 60000);
    console.log(`Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s (retry ${_retryCount + 1}/${MAX_RATE_LIMIT_RETRIES})...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return rateLimitedFetch(url, headers, _retryCount + 1);
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
