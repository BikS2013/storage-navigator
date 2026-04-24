import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SlashCommand, SlashContext } from "./context.js";
import {
  listMemoryEntries,
  getMemoryEntry,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  ensureMemoryDir,
  getMemoryDir,
} from "../memory.js";

export const memoryCommand: SlashCommand = {
  name: "/memory",
  brief: "Manage persistent memory (list/show/add/remove/edit).",
  async run(ctx: SlashContext, args: string[]): Promise<void> {
    ensureMemoryDir();
    const sub = args[0];
    if (!sub) {
      const list = listMemoryEntries();
      if (list.length === 0) {
        ctx.printSystem(`No memory entries. Use /memory add <name> <content>. Folder: ${getMemoryDir()}`);
        return;
      }
      ctx.printSystem(`Memory entries (${getMemoryDir()}):`);
      for (const e of list) {
        const preview = e.content.split("\n")[0]!.slice(0, 60);
        ctx.println(`  ${e.name}  —  ${preview}${e.content.length > 60 ? "…" : ""}`);
      }
      return;
    }

    if (sub === "show") {
      const name = args[1];
      if (!name) {
        ctx.printSystem("Usage: /memory show <name>");
        return;
      }
      const e = getMemoryEntry(name);
      if (!e) {
        ctx.printSystem(`No memory entry named "${name}".`);
        return;
      }
      ctx.println(`# ${e.name}\n${e.content}`);
      return;
    }

    if (sub === "add") {
      const name = args[1];
      const content = args.slice(2).join(" ");
      if (!name || !content) {
        ctx.printSystem('Usage: /memory add <name> <content...>   (use quotes for content with spaces)');
        return;
      }
      try {
        addMemoryEntry(name, content);
        ctx.printSystem(`Added memory entry "${name}". It will be in the system prompt on the next turn.`);
      } catch (err) {
        ctx.printSystem((err as Error).message);
      }
      return;
    }

    if (sub === "remove" || sub === "rm") {
      const name = args[1];
      if (!name) {
        ctx.printSystem("Usage: /memory remove <name>");
        return;
      }
      const ok = removeMemoryEntry(name);
      ctx.printSystem(ok ? `Removed "${name}".` : `No memory entry named "${name}".`);
      return;
    }

    if (sub === "edit") {
      const name = args[1];
      if (!name) {
        ctx.printSystem("Usage: /memory edit <name>");
        return;
      }
      const editor = process.env["EDITOR"] ?? process.env["VISUAL"];
      if (!editor) {
        ctx.printSystem("Set $EDITOR (e.g. EDITOR=nvim) to use /memory edit.");
        return;
      }
      // Materialize the file (creating an empty entry if needed) then exec the editor.
      let entry = getMemoryEntry(name);
      let createdNow = false;
      if (!entry) {
        const tmp = path.join(os.tmpdir(), `tui-memory-${Date.now()}.md`);
        fs.writeFileSync(tmp, "");
        addMemoryEntry(name, "");
        entry = getMemoryEntry(name);
        createdNow = true;
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      }
      if (!entry) {
        ctx.printSystem(`Failed to materialize entry "${name}".`);
        return;
      }
      ctx.printSystem(`Opening ${entry.filePath} in ${editor}…`);
      await new Promise<void>((resolve) => {
        const proc = spawn(editor, [entry!.filePath], { stdio: "inherit" });
        proc.on("close", () => resolve());
        proc.on("error", () => resolve());
      });
      // Reload from disk
      const updated = getMemoryEntry(name);
      if (updated) {
        updateMemoryEntry(name, updated.content); // re-stamp 0600 mode
        ctx.printSystem(`Saved memory entry "${name}" (${updated.content.length} chars).`);
      } else if (createdNow) {
        ctx.printSystem(`Edit cancelled.`);
      }
      return;
    }

    ctx.printSystem(`Unknown /memory subcommand "${sub}". Try /memory, /memory add, /memory show, /memory remove, /memory edit.`);
  },
};
