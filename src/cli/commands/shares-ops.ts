import { readFileSync } from 'node:fs';
import { resolveStorageBackend, type StorageOpts } from './shared.js';

export async function listShares(opts: StorageOpts & { account?: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  const r = await backend.listShares();
  for (const s of r.items) console.log(`  ${s.name}${s.quotaGiB ? ` (quota: ${s.quotaGiB} GiB)` : ''}`);
}

export async function createShare(opts: StorageOpts & { account?: string; name: string; quota?: number }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  await backend.createShare(opts.name, opts.quota);
  console.log(`Share "${opts.name}" created.`);
}

export async function deleteShareCmd(opts: StorageOpts & { account?: string; name: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  await backend.deleteShare(opts.name);
  console.log(`Share "${opts.name}" deleted.`);
}

export async function listDir(opts: StorageOpts & { account?: string; share: string; path?: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  const r = await backend.listDir(opts.share, opts.path ?? '');
  for (const f of r.items) console.log(`  ${f.isDirectory ? '[D]' : '   '} ${f.name}${f.size !== undefined ? ` (${f.size} bytes)` : ''}`);
}

export async function viewFile(opts: StorageOpts & { account?: string; share: string; file: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  const r = await backend.readFile(opts.share, opts.file);
  for await (const chunk of r.stream) process.stdout.write(chunk);
  process.stdout.write('\n');
}

export async function uploadFileCmd(opts: StorageOpts & { account?: string; share: string; file: string; source?: string; content?: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  let body: Buffer;
  if (opts.source) body = readFileSync(opts.source);
  else if (opts.content !== undefined) body = Buffer.from(opts.content, 'utf8');
  else throw new Error('Provide --source <path> or --content <text>');
  await backend.uploadFile(opts.share, opts.file, body, body.length);
  console.log(`Uploaded ${opts.file} (${body.length} bytes).`);
}

export async function renameFileCmd(opts: StorageOpts & { account?: string; share: string; file: string; newName: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  await backend.renameFile(opts.share, opts.file, opts.newName);
  console.log(`Renamed ${opts.file} → ${opts.newName}.`);
}

export async function deleteFileCmd(opts: StorageOpts & { account?: string; share: string; file: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  await backend.deleteFile(opts.share, opts.file);
  console.log(`Deleted ${opts.file}.`);
}

export async function deleteFileFolderCmd(opts: StorageOpts & { account?: string; share: string; path: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  const n = await backend.deleteFileFolder(opts.share, opts.path);
  console.log(`Deleted ${n} files under ${opts.path}.`);
}
