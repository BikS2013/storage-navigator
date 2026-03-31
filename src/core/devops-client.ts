import type { RepoFileEntry } from "./types.js";
import { rateLimitedFetch } from "./repo-utils.js";

export class DevOpsClient {
  private headers: Record<string, string>;
  private org: string;

  constructor(pat: string, org: string) {
    this.org = org;
    const encoded = Buffer.from(`:${pat}`).toString("base64");
    this.headers = {
      Authorization: `Basic ${encoded}`,
      Accept: "application/json",
    };
  }

  /** Parse org, project, and repo from an Azure DevOps URL */
  static parseRepoUrl(url: string): { org: string; project: string; repo: string } {
    // Handles: https://dev.azure.com/{org}/{project}/_git/{repo}
    // Also: https://{org}.visualstudio.com/{project}/_git/{repo}
    let match = url.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/);
    if (match) return { org: match[1], project: match[2], repo: match[3] };

    match = url.match(/([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)/);
    if (match) return { org: match[1], project: match[2], repo: match[3] };

    throw new Error(`Invalid Azure DevOps URL: ${url}`);
  }

  /** Get the default branch name */
  async getDefaultBranch(project: string, repo: string): Promise<string> {
    const res = await rateLimitedFetch(
      `https://dev.azure.com/${this.org}/${project}/_apis/git/repositories/${repo}?api-version=7.1`,
      this.headers
    );
    if (!res.ok) throw new Error(`Azure DevOps API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as { defaultBranch: string };
    // defaultBranch comes as "refs/heads/main" — strip the prefix
    return data.defaultBranch.replace("refs/heads/", "");
  }

  /** List all files in the repo recursively */
  async listFiles(project: string, repo: string, branch: string): Promise<RepoFileEntry[]> {
    const res = await rateLimitedFetch(
      `https://dev.azure.com/${this.org}/${project}/_apis/git/repositories/${repo}/items?recursionLevel=Full&versionDescriptor.version=${branch}&api-version=7.1`,
      this.headers
    );
    if (!res.ok) throw new Error(`Azure DevOps API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as {
      value: Array<{ path: string; objectId: string; gitObjectType: string; size?: number }>;
    };
    return data.value
      .filter((item) => item.gitObjectType === "blob")
      .map((item) => ({
        path: item.path.startsWith("/") ? item.path.slice(1) : item.path,
        sha: item.objectId,
        size: item.size,
      }));
  }

  /** Download a single file's content as Buffer */
  async downloadFile(project: string, repo: string, filePath: string, ref: string): Promise<Buffer> {
    const encodedPath = encodeURIComponent(filePath);
    const res = await rateLimitedFetch(
      `https://dev.azure.com/${this.org}/${project}/_apis/git/repositories/${repo}/items?path=${encodedPath}&versionDescriptor.version=${ref}&$format=octetStream&api-version=7.1`,
      this.headers
    );
    if (!res.ok) throw new Error(`Azure DevOps download error for ${filePath}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
