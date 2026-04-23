import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;          // epoch ms
  scope?: string;
  idToken?: string;
};

type StoreFile = Record<string, TokenSet>;

export class TokenStore {
  private readonly file: string;

  constructor() {
    const dir = process.env.STORAGE_NAVIGATOR_DIR ?? join(homedir(), '.storage-navigator');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, 'oidc-tokens.json');
  }

  private read(): StoreFile {
    if (!existsSync(this.file)) return {};
    return JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
  }

  private write(data: StoreFile): void {
    if (!existsSync(dirname(this.file))) mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(this.file, JSON.stringify(data, null, 2), { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(this.file, 0o600);
  }

  async save(name: string, tokens: TokenSet): Promise<void> {
    const data = this.read();
    data[name] = tokens;
    this.write(data);
  }

  async load(name: string): Promise<TokenSet | null> {
    const data = this.read();
    return data[name] ?? null;
  }

  async delete(name: string): Promise<void> {
    const data = this.read();
    delete data[name];
    this.write(data);
  }
}
