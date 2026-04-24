import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';

let cached: TokenCredential | null = null;

export function getAzureCredential(): TokenCredential {
  if (!cached) {
    cached = new DefaultAzureCredential();
  }
  return cached;
}

/** Test-only reset hook. Do not call from production code. */
export function _resetAzureCredential(): void {
  cached = null;
}
