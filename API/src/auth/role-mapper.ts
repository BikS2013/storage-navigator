export type AppRole = 'Reader' | 'Writer' | 'Admin';

export function mapRoles(
  claimValue: unknown,
  roleMap: Record<string, AppRole>
): Set<AppRole> {
  const values: string[] = Array.isArray(claimValue)
    ? claimValue.filter((v): v is string => typeof v === 'string')
    : typeof claimValue === 'string'
    ? [claimValue]
    : [];
  const out = new Set<AppRole>();
  for (const v of values) {
    const mapped = roleMap[v];
    if (mapped) out.add(mapped);
  }
  return out;
}

export function impliesRole(have: Set<AppRole>, need: AppRole): boolean {
  if (have.has('Admin')) return true;
  if (need === 'Reader') return have.has('Reader') || have.has('Writer');
  if (need === 'Writer') return have.has('Writer');
  return false;
}
