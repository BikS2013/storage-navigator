import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import type { RepoFileEntry } from "./types.js";

/**
 * Git client that clones repositories via SSH (or any git-supported URL).
 * Uses the system's git binary and SSH agent/keys for authentication.
 * Clones to a temp directory, lists files via `git ls-tree`, reads from disk.
 */
export class SshGitClient {
  private cloneDir: string | null = null;

  /** Parse a repo name from an SSH URL for display purposes */
  static parseRepoUrl(url: string): { repoName: string } {
    // Handles: git@github.com:owner/repo.git, ssh://git@host/owner/repo.git, https://...
    const match = url.match(/[/:]([^/]+\/[^/.]+?)(?:\.git)?$/);
    return { repoName: match ? match[1] : url };
  }

  /** Get the default branch of a remote repo */
  async getDefaultBranch(repoUrl: string): Promise<string> {
    try {
      const output = execSync(`git ls-remote --symref ${repoUrl} HEAD`, {
        encoding: "utf-8",
        timeout: 30000,
        env: { ...process.env, GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=accept-new" },
      });
      // Parse: ref: refs/heads/main\tHEAD
      const match = output.match(/ref: refs\/heads\/(\S+)\tHEAD/);
      if (match) return match[1];
      throw new Error("Could not determine default branch");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to query remote: ${msg}. Check that the URL is correct and your SSH key is configured.`);
    }
  }

  /**
   * Clone the repository to a temp directory.
   * Uses --depth 1 --single-branch for efficiency.
   */
  async clone(repoUrl: string, branch: string): Promise<void> {
    const tmpName = `sn-ssh-${crypto.randomBytes(6).toString("hex")}`;
    this.cloneDir = path.join(os.tmpdir(), tmpName);

    try {
      execSync(
        `git clone --depth 1 --single-branch --branch ${branch} ${repoUrl} ${this.cloneDir}`,
        {
          encoding: "utf-8",
          timeout: 300000, // 5 minutes for large repos
          env: { ...process.env, GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=accept-new" },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
    } catch (err) {
      this.cleanup();
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Git clone failed: ${msg}. Check that the URL is correct and your SSH key has access.`);
    }
  }

  /**
   * List all tracked files in the cloned repo with their git object SHAs.
   * Must call clone() first.
   */
  async listFiles(): Promise<RepoFileEntry[]> {
    if (!this.cloneDir) throw new Error("Repository not cloned. Call clone() first.");

    const output = execSync("git ls-tree -r --long HEAD", {
      cwd: this.cloneDir,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB for large repos
    });

    const files: RepoFileEntry[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line) continue;
      // Format: <mode> <type> <sha> <size>\t<path>
      const match = line.match(/^\d+ \w+ ([a-f0-9]+)\s+(\d+|-)\t(.+)$/);
      if (match) {
        files.push({
          path: match[3],
          sha: match[1],
          size: match[2] === "-" ? undefined : parseInt(match[2], 10),
        });
      }
    }
    return files;
  }

  /**
   * Read a file from the local clone.
   * Must call clone() first.
   */
  async downloadFile(filePath: string): Promise<Buffer> {
    if (!this.cloneDir) throw new Error("Repository not cloned. Call clone() first.");
    const fullPath = path.join(this.cloneDir, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found in clone: ${filePath}`);
    }
    return fs.readFileSync(fullPath);
  }

  /** Remove the temp clone directory */
  cleanup(): void {
    if (this.cloneDir && fs.existsSync(this.cloneDir)) {
      fs.rmSync(this.cloneDir, { recursive: true, force: true });
      this.cloneDir = null;
    }
  }
}
