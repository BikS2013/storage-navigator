/**
 * Memory module tests — folder-based CRUD against an isolated tmp dir.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  listMemoryEntries,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  getMemoryEntry,
  clearMemory,
  ensureMemoryDir,
} from "../memory.js";
import { buildSystemPromptWithMemory } from "../system-prompt-with-memory.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tui-memory-"));
  process.env["STORAGE_NAV_AGENT_MEMORY_DIR"] = tmpDir;
});

afterEach(() => {
  delete process.env["STORAGE_NAV_AGENT_MEMORY_DIR"];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("memory module", () => {
  it("ensureMemoryDir creates the dir with mode 0700", () => {
    const dir = path.join(tmpDir, "nested");
    process.env["STORAGE_NAV_AGENT_MEMORY_DIR"] = dir;
    ensureMemoryDir();
    expect(fs.existsSync(dir)).toBe(true);
    if (process.platform !== "win32") {
      const mode = fs.statSync(dir).mode & 0o777;
      expect(mode & 0o077).toBe(0); // no group/other access
    }
  });

  it("addMemoryEntry writes file at mode 0600", () => {
    addMemoryEntry("preferences", "use markdown tables");
    const file = path.join(tmpDir, "preferences.md");
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== "win32") {
      const mode = fs.statSync(file).mode & 0o777;
      expect(mode & 0o077).toBe(0);
    }
    expect(fs.readFileSync(file, "utf-8")).toBe("use markdown tables");
  });

  it("addMemoryEntry refuses to overwrite existing entries", () => {
    addMemoryEntry("x", "first");
    expect(() => addMemoryEntry("x", "second")).toThrow(/already exists/);
  });

  it("updateMemoryEntry replaces content", () => {
    addMemoryEntry("x", "first");
    updateMemoryEntry("x", "second");
    const e = getMemoryEntry("x");
    expect(e?.content).toBe("second");
  });

  it("removeMemoryEntry deletes the file", () => {
    addMemoryEntry("y", "z");
    expect(removeMemoryEntry("y")).toBe(true);
    expect(removeMemoryEntry("y")).toBe(false);
  });

  it("listMemoryEntries returns sorted entries", () => {
    addMemoryEntry("beta", "b");
    addMemoryEntry("alpha", "a");
    const list = listMemoryEntries();
    expect(list.map((e) => e.name)).toEqual(["alpha", "beta"]);
  });

  it("clearMemory removes all entries", () => {
    addMemoryEntry("a", "1");
    addMemoryEntry("b", "2");
    expect(clearMemory()).toBe(2);
    expect(listMemoryEntries()).toEqual([]);
  });

  it("rejects invalid names", () => {
    expect(() => addMemoryEntry("../escape", "x")).toThrow(/Invalid memory name/);
    expect(() => addMemoryEntry("with space", "x")).toThrow(/Invalid memory name/);
  });
});

describe("buildSystemPromptWithMemory", () => {
  it("returns the base prompt unchanged when no memory exists", () => {
    expect(buildSystemPromptWithMemory("BASE")).toBe("BASE");
  });

  it("appends a Persistent memory section when entries exist", () => {
    addMemoryEntry("style", "be concise");
    addMemoryEntry("project", "storage-navigator");
    const out = buildSystemPromptWithMemory("BASE");
    expect(out).toContain("BASE");
    expect(out).toContain("## Persistent memory");
    expect(out).toContain("### style");
    expect(out).toContain("be concise");
    expect(out).toContain("### project");
    expect(out).toContain("storage-navigator");
  });
});
