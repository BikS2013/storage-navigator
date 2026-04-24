export type DiscoveryResult = (
  | { authEnabled: false }
  | { authEnabled: true; issuer: string; clientId: string; audience: string; scopes: string[] }
) & {
  staticAuthHeaderRequired: boolean;
  staticAuthHeaderName?: string;
};

export async function fetchDiscovery(baseUrl: string): Promise<DiscoveryResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/.well-known/storage-nav-config`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Discovery network error for ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Discovery HTTP ${res.status} for ${url}`);
  const body = await res.json() as Record<string, unknown>;

  const staticAuthHeaderRequired = body.staticAuthHeaderRequired === true;
  const staticAuthHeaderName = typeof body.staticAuthHeaderName === 'string'
    ? body.staticAuthHeaderName
    : undefined;
  if (staticAuthHeaderRequired && !staticAuthHeaderName) {
    throw new Error(`Discovery says staticAuthHeaderRequired:true but missing staticAuthHeaderName at ${url}`);
  }

  if (body.authEnabled === false) {
    return { authEnabled: false, staticAuthHeaderRequired, staticAuthHeaderName };
  }
  if (body.authEnabled === true) {
    const required = ['issuer', 'clientId', 'audience', 'scopes'];
    const missing = required.filter((k) => body[k] === undefined);
    if (missing.length) throw new Error(`Discovery missing required fields when authEnabled=true: ${missing.join(', ')}`);
    return {
      authEnabled: true,
      issuer: String(body.issuer),
      clientId: String(body.clientId),
      audience: String(body.audience),
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [],
      staticAuthHeaderRequired,
      staticAuthHeaderName,
    };
  }
  throw new Error(`Discovery response missing authEnabled flag at ${url}`);
}
