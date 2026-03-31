import type { RepoFileEntry } from "./types.js";
import { rateLimitedFetch } from "./repo-utils.js";

export class GitHubClient {
  private headers: Record<string, string>;

  constructor(pat: string) {
    this.headers = {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  /** Parse owner and repo from a GitHub URL */
  static parseRepoUrl(url: string): { owner: string; repo: string } {
    // Handles: https://github.com/owner/repo, https://github.com/owner/repo.git, github.com/owner/repo
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) throw new Error(`Invalid GitHub URL: ${url}`);
    return { owner: match[1], repo: match[2] };
  }

  /** Get the default branch name */
  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const res = await rateLimitedFetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      this.headers
    );
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as { default_branch: string };
    return data.default_branch;
  }

  /** List all files in the repo recursively using the Git Trees API */
  async listFiles(owner: string, repo: string, branch: string): Promise<RepoFileEntry[]> {
    const res = await rateLimitedFetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      this.headers
    );
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as {
      tree: Array<{ path: string; sha: string; size?: number; type: string }>;
      truncated: boolean;
    };
    if (data.truncated) {
      console.warn("Warning: Repository tree was truncated (very large repo). Some files may be missing.");
    }
    return data.tree
      .filter((item) => item.type === "blob")
      .map((item) => ({ path: item.path, sha: item.sha, size: item.size }));
  }

  /** Download a single file's content as Buffer */
  async downloadFile(owner: string, repo: string, filePath: string, ref: string): Promise<Buffer> {
    const res = await rateLimitedFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${ref}`,
      { ...this.headers, Accept: "application/vnd.github.raw+json" }
    );
    if (!res.ok) throw new Error(`GitHub download error for ${filePath}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
