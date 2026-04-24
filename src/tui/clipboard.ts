/**
 * Cross-platform clipboard helper.
 *
 * Dispatches to the platform-native binary:
 *   - macOS: `pbcopy`
 *   - Linux: `xclip -selection clipboard`, then `xsel --clipboard --input`
 *   - Windows / WSL: `clip.exe` (with /mnt/c fallback path on WSL)
 *
 * Spec §13: never silent-fail. If no binary is available, throw a clear error.
 *
 * The choice to dispatch ourselves (instead of using the existing `clipboardy`
 * dep blindly) keeps the spec-mandated explicit error message and lets us write
 * a deterministic unit test that mocks `child_process.spawn`.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";

interface ClipboardCmd {
  bin: string;
  args: string[];
}

function detectCommand(): ClipboardCmd | null {
  if (process.platform === "darwin") return { bin: "pbcopy", args: [] };
  if (process.platform === "win32") return { bin: "clip", args: [] };
  // Linux / WSL
  if (process.env["WSL_DISTRO_NAME"]) {
    const wslPath = "/mnt/c/Windows/System32/clip.exe";
    if (fs.existsSync(wslPath)) return { bin: wslPath, args: [] };
  }
  // Prefer xclip; xsel as fallback (we just emit xclip and let it fail to xsel).
  return { bin: "xclip", args: ["-selection", "clipboard"] };
}

export async function copyToClipboard(text: string): Promise<void> {
  const cmd = detectCommand();
  if (!cmd) throw new Error("clipboard not available on this platform");

  await runOne(cmd, text).catch(async (err) => {
    // Linux fallback: try xsel if xclip failed
    if (process.platform === "linux" && cmd.bin === "xclip") {
      await runOne({ bin: "xsel", args: ["--clipboard", "--input"] }, text).catch(() => {
        throw new Error(
          `clipboard not available on this platform (tried xclip and xsel: ${(err as Error).message})`
        );
      });
      return;
    }
    throw new Error(`clipboard not available on this platform: ${(err as Error).message}`);
  });
}

function runOne(cmd: ClipboardCmd, text: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let proc;
    try {
      proc = spawn(cmd.bin, cmd.args, { stdio: ["pipe", "ignore", "pipe"] });
    } catch (err) {
      reject(err as Error);
      return;
    }
    let stderr = "";
    proc.stderr?.on("data", (b: Buffer) => { stderr += b.toString("utf8"); });
    proc.on("error", (err: Error) => reject(err));
    proc.on("close", (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd.bin} exited with code ${code ?? "null"}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
    proc.stdin?.end(text, "utf8");
  });
}
