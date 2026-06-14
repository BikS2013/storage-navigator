// ===========================================================================
// src/cli/commands/github-app-ops.ts
//
// CLI commands for GitHub App credential management:
//   - add-github-app
//   - list-github-apps
//   - remove-github-app
//
// Phase 4 (plan-012)
// ===========================================================================

import { CredentialStore } from "../../core/credential-store.js";
import { readFileSync } from "fs";
import type { GitHubAppEntry } from "../../core/types.js";

/**
 * Add or update a GitHub App credential.
 * 
 * @param opts.name User-defined name (unique within githubApps array)
 * @param opts.appId GitHub App ID (numeric string from app settings)
 * @param opts.installationId Installation ID for the target account/org
 * @param opts.privateKeyFile Path to PEM file containing the private key
 * @param opts.clientId Optional OAuth client ID (reserved for future)
 * @param opts.clientSecret Optional OAuth client secret (reserved for future)
 * @param opts.companionPatName Optional stored PAT name for repo-scope addition
 * @param opts.expiresAt Optional ISO 8601 timestamp for key rotation tracking
 */
export async function addGitHubApp(opts: {
  name: string;
  appId: string;
  installationId: string;
  privateKeyFile: string;
  clientId?: string;
  clientSecret?: string;
  companionPatName?: string;
  expiresAt?: string;
}): Promise<void> {
  const store = new CredentialStore();
  
  // Read private key from file
  let privateKeyPem: string;
  try {
    privateKeyPem = readFileSync(opts.privateKeyFile, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read private key file: ${(err as Error).message}. ` +
      `Verify the file exists and is readable.`
    );
  }
  
  // Basic PEM validation (OQ5)
  if (!privateKeyPem.includes("-----BEGIN")) {
    throw new Error(
      "Invalid private key file: PEM format not detected. " +
      "Expected -----BEGIN RSA PRIVATE KEY----- or -----BEGIN PRIVATE KEY-----."
    );
  }
  
  // Validate companionPatName if provided
  if (opts.companionPatName) {
    const pat = store.getToken(opts.companionPatName);
    if (!pat) {
      throw new Error(
        `Companion PAT "${opts.companionPatName}" not found. ` +
        `Add it first with: storage-nav add-token --name ${opts.companionPatName} --provider github --token <pat>`
      );
    }
    if (pat.provider !== "github") {
      throw new Error(
        `Companion PAT "${opts.companionPatName}" is not a GitHub token (provider: ${pat.provider}). ` +
        `GitHub App scope addition requires a GitHub PAT.`
      );
    }
  }
  
  const entry: Omit<GitHubAppEntry, "addedAt"> = {
    name: opts.name,
    appId: opts.appId,
    installationId: opts.installationId,
    privateKeyPem,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    companionPatTokenName: opts.companionPatName,
    expiresAt: opts.expiresAt,
  };
  
  store.addGitHubApp(entry);
  
  console.log(`✓ GitHub App "${opts.name}" added successfully.`);
  if (opts.companionPatName) {
    console.log(`  Companion PAT: ${opts.companionPatName} (for repository scope addition; must have 'repo' scope)`);
  }
}

/**
 * List all stored GitHub Apps (no secrets exposed).
 */
export async function listGitHubApps(): Promise<void> {
  const store = new CredentialStore();
  const apps = store.listGitHubApps();
  
  if (apps.length === 0) {
    console.log("No GitHub Apps configured.");
    console.log();
    console.log("Add one with:");
    console.log("  storage-nav add-github-app --name <name> --app-id <id> --installation-id <id> --private-key-file <path>");
    return;
  }
  
  console.log(`GitHub Apps (${apps.length}):\n`);
  
  for (const app of apps) {
    console.log(`  ${app.name}`);
    console.log(`    App ID:          ${app.appId}`);
    console.log(`    Installation ID: ${app.installationId}`);
    console.log(`    Added:           ${app.addedAt}`);
    
    if (app.expiresAt) {
      const status = app.isExpired ? "(EXPIRED)" : "(valid)";
      console.log(`    Expires:         ${app.expiresAt} ${status}`);
    }
    
    if (app.hasCompanionPat) {
      console.log(`    Companion PAT:   configured (for repo scope addition)`);
    }
    
    console.log();
  }
}

/**
 * Remove a GitHub App credential by name.
 */
export async function removeGitHubApp(opts: {
  name: string;
}): Promise<void> {
  const store = new CredentialStore();
  const removed = store.removeGitHubApp(opts.name);
  
  if (!removed) {
    throw new Error(
      `GitHub App "${opts.name}" not found. ` +
      `List existing apps with: storage-nav list-github-apps`
    );
  }
  
  console.log(`✓ GitHub App "${opts.name}" removed.`);
}
