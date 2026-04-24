/**
 * Default TUI log file path.
 *
 * The TUI passes this to createAgentLogger() with quiet=true so structured
 * logs go to disk instead of stderr (which would corrupt the raw-mode UI).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function defaultTuiLogPath(): string {
  const dir = path.join(os.homedir(), ".tool-agents", "storage-nav", "logs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(dir, `tui-${ts}.log`);
}
