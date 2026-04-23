import { describe, it, expect, vi } from 'vitest';
import { AccountDiscovery, type ArmAdapter, type DiscoveredAccount } from '../../src/azure/account-discovery.js';

const A1: DiscoveredAccount = {
  name: 'acct1',
  subscriptionId: 'sub-a',
  resourceGroup: 'rg-a',
  blobEndpoint: 'https://acct1.blob.core.windows.net',
  fileEndpoint: 'https://acct1.file.core.windows.net',
};
const A2: DiscoveredAccount = {
  name: 'acct2',
  subscriptionId: 'sub-a',
  resourceGroup: 'rg-a',
  blobEndpoint: 'https://acct2.blob.core.windows.net',
  fileEndpoint: 'https://acct2.file.core.windows.net',
};

function makeAdapter(accounts: DiscoveredAccount[]): ArmAdapter {
  return {
    list: vi.fn().mockResolvedValue(accounts),
  };
}

describe('AccountDiscovery', () => {
  it('lists discovered accounts after refresh', async () => {
    const adapter = makeAdapter([A1, A2]);
    const d = new AccountDiscovery({ adapter, allowed: [], refreshMin: 60 });
    await d.refresh();
    const all = d.list();
    expect(all.map((a) => a.name).sort()).toEqual(['acct1', 'acct2']);
  });

  it('filters by allowlist', async () => {
    const adapter = makeAdapter([A1, A2]);
    const d = new AccountDiscovery({ adapter, allowed: ['acct2'], refreshMin: 60 });
    await d.refresh();
    expect(d.list().map((a) => a.name)).toEqual(['acct2']);
  });

  it('lookup returns the account', async () => {
    const adapter = makeAdapter([A1]);
    const d = new AccountDiscovery({ adapter, allowed: [], refreshMin: 60 });
    await d.refresh();
    expect(d.lookup('acct1')?.blobEndpoint).toContain('acct1.blob');
  });

  it('lookup returns null when missing', async () => {
    const adapter = makeAdapter([]);
    const d = new AccountDiscovery({ adapter, allowed: [], refreshMin: 60 });
    await d.refresh();
    expect(d.lookup('ghost')).toBeNull();
  });

  it('refresh re-invokes the adapter', async () => {
    const adapter = makeAdapter([A1]);
    const d = new AccountDiscovery({ adapter, allowed: [], refreshMin: 60 });
    await d.refresh();
    await d.refresh();
    expect(adapter.list).toHaveBeenCalledTimes(2);
  });
});
