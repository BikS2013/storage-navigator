export class SitePathError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SitePathError'; }
}

/**
 * Normalise a URL-path segment supplied by a client into a safe relative
 * blob/file path. Returns "" for the container/share root.
 *
 * Rejects (with SitePathError) any input that, after URL decoding and
 * separator normalisation, contains a `..` segment, a NUL byte, or a
 * backslash. The caller is expected to pass the value to the storage
 * backend verbatim after this returns.
 */
export function normaliseSitePath(raw: string): string {
  if (raw == null) return '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new SitePathError('invalid percent-encoding');
  }
  if (decoded.includes('\x00')) throw new SitePathError('NUL byte not allowed');
  if (decoded.includes('\\')) throw new SitePathError('backslash not allowed');
  const stripped = decoded.replace(/^\/+/, '');
  if (stripped === '') return '';
  const segments = stripped.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') throw new SitePathError(`forbidden segment: ${seg}`);
  }
  return stripped;
}
