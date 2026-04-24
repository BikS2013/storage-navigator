/**
 * Persistent memory store — folder-based per the project request.
 *
 * Layout: ~/.tool-agents/storage-nav/memory/<name>.md
 *   - Directory mode 0700, file mode 0600.
 *   - Each file's content (markdown or plain text) is appended to the system
 *     prompt as a `## Persistent memory` section so the model sees it on every
 *     turn (see system-prompt-with-memory.ts).
 *
 * The memory directory location is overridable via STORAGE_NAV_AGENT_MEMORY_DIR
 * (used by tests against a tmp dir).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface MemoryEntry {
  name: string;
  content: string;
  filePath: string;
}

export function getMemoryDir(): string {
  return (
    process.env["STORAGE_NAV_AGENT_MEMORY_DIR"] ??
    path.join(os.homedir(), ".tool-agents", "storage-nav", "memory")
  );
}

export function ensureMemoryDir(): string {
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

function isValidName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";
}

function nameToFile(dir: string, name: string): string {
  if (!isValidName(name)) {
    throw new Error(`Invalid memory name "${name}". Allowed: letters, digits, dot, underscore, hyphen.`);
  }
  return path.join(dir, name.endsWith(".md") ? name : `${name}.md`);
}

function fileToName(file: string): string {
  return file.endsWith(".md") ? file.slice(0, -3) : file;
}

export function listMemoryEntries(): MemoryEntry[] {
  const dir = ensureMemoryDir();
  const out: MemoryEntry[] = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (!stat.isFile()) continue;
    if (!f.endsWith(".md") && !f.endsWith(".txt")) continue;
    out.push({
      name: fileToName(f),
      content: fs.readFileSync(full, "utf-8"),
      filePath: full,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getMemoryEntry(name: string): MemoryEntry | null {
  const dir = ensureMemoryDir();
  const file = nameToFile(dir, name);
  if (!fs.existsSync(file)) return null;
  return { name: fileToName(path.basename(file)), content: fs.readFileSync(file, "utf-8"), filePath: file };
}

export function addMemoryEntry(name: string, content: string): MemoryEntry {
  const dir = ensureMemoryDir();
  const file = nameToFile(dir, name);
  if (fs.existsSync(file)) {
    throw new Error(`Memory entry "${name}" already exists. Use /memory edit ${name} to modify.`);
  }
  fs.writeFileSync(file, content, { mode: 0o600 });
  return { name: fileToName(path.basename(file)), content, filePath: file };
}

export function updateMemoryEntry(name: string, content: string): MemoryEntry {
  const dir = ensureMemoryDir();
  const file = nameToFile(dir, name);
  fs.writeFileSync(file, content, { mode: 0o600 });
  return { name: fileToName(path.basename(file)), content, filePath: file };
}

export function removeMemoryEntry(name: string): boolean {
  const dir = ensureMemoryDir();
  const file = nameToFile(dir, name);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function clearMemory(): number {
  const entries = listMemoryEntries();
  for (const e of entries) fs.unlinkSync(e.filePath);
  return entries.length;
}
