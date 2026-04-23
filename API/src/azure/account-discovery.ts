import { StorageManagementClient } from '@azure/arm-storage';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import type { TokenCredential } from '@azure/identity';

export type DiscoveredAccount = {
  name: string;
  subscriptionId: string;
  resourceGroup: string;
  blobEndpoint: string;
  fileEndpoint: string;
};

export type ArmAdapter = {
  list(): Promise<DiscoveredAccount[]>;
};

export type AccountDiscoveryOptions = {
  adapter: ArmAdapter;
  allowed: string[];
  refreshMin: number;
};

export class AccountDiscovery {
  private readonly adapter: ArmAdapter;
  private readonly allowed: Set<string>;
  private readonly refreshMs: number;
  private cache: Map<string, DiscoveredAccount> = new Map();
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: AccountDiscoveryOptions) {
    this.adapter = opts.adapter;
    this.allowed = new Set(opts.allowed);
    this.refreshMs = opts.refreshMin * 60 * 1000;
  }

  async refresh(): Promise<void> {
    const accounts = await this.adapter.list();
    const filtered = this.allowed.size === 0
      ? accounts
      : accounts.filter((a) => this.allowed.has(a.name));
    const next = new Map<string, DiscoveredAccount>();
    for (const a of filtered) next.set(a.name, a);
    this.cache = next;
  }

  list(): DiscoveredAccount[] {
    return [...this.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  lookup(name: string): DiscoveredAccount | null {
    return this.cache.get(name) ?? null;
  }

  startBackgroundRefresh(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch(() => undefined);
    }, this.refreshMs);
    // Don't keep the event loop alive solely for this timer.
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopBackgroundRefresh(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** Concrete adapter that scans subscriptions via ARM. */
export class ArmStorageAdapter implements ArmAdapter {
  constructor(
    private readonly credential: TokenCredential,
    private readonly subscriptions: string[]
  ) {}

  async list(): Promise<DiscoveredAccount[]> {
    const subs = this.subscriptions.length > 0
      ? this.subscriptions
      : await this.discoverSubscriptions();
    const out: DiscoveredAccount[] = [];
    for (const subscriptionId of subs) {
      const client = new StorageManagementClient(this.credential, subscriptionId);
      for await (const acct of client.storageAccounts.list()) {
        if (!acct.name || !acct.id) continue;
        const rg = parseResourceGroup(acct.id);
        if (!rg) continue;
        out.push({
          name: acct.name,
          subscriptionId,
          resourceGroup: rg,
          blobEndpoint: acct.primaryEndpoints?.blob ?? `https://${acct.name}.blob.core.windows.net`,
          fileEndpoint: acct.primaryEndpoints?.file ?? `https://${acct.name}.file.core.windows.net`,
        });
      }
    }
    return out;
  }

  private async discoverSubscriptions(): Promise<string[]> {
    const sc = new SubscriptionClient(this.credential);
    const ids: string[] = [];
    for await (const s of sc.subscriptions.list()) {
      if (s.subscriptionId) ids.push(s.subscriptionId);
    }
    return ids;
  }
}

function parseResourceGroup(id: string): string | null {
  // /subscriptions/{sub}/resourceGroups/{rg}/...
  const match = /\/resourceGroups\/([^/]+)\//.exec(id);
  return match?.[1] ?? null;
}
