# Storage Navigator — Configuration Guide

## Overview

Storage Navigator uses encrypted local storage for credentials and command-line options for runtime settings. There are no environment variables or config files — all configuration is done through the CLI or UI.

## Configuration Options

### 1. Storage Account Credentials

**Purpose**: Authenticate against Azure Blob Storage accounts to browse containers and view files.

**How to configure**: Via CLI or UI.

```bash
# CLI
storage-nav add --name <display-name> --account <azure-account-name> --account-key <key>
storage-nav add --name <display-name> --account <azure-account-name> --sas-token <token>
```

In the UI, click the **+** button in the header to open the Add Storage modal.

**Authentication types** (choose one per storage account):

| Type | Option | Description | Recommended |
|------|--------|-------------|-------------|
| Account Key | `--account-key` | Full access to all containers and blobs. Does not expire. | Yes |
| SAS Token | `--sas-token` | Scoped access. May be limited to specific containers or operations. Has an expiration date. | For restricted access |

**How to obtain**:
- **Account Key**: Azure Portal > Storage Account > Security + networking > Access keys. Copy Key1 or Key2.
- **SAS Token**: Azure Portal > Storage Account > Shared access signature. Configure permissions, expiry, and generate.
- **Azure CLI**: `az storage account keys list --account-name <name> --query "[0].value" -o tsv`

**Storage location**: `~/.storage-navigator/credentials.json` (encrypted with AES-256-GCM).

**Encryption key**: `~/.storage-navigator/machine.key` (random 32-byte key, generated on first use, owner-only permissions `0600`).

**Recommended approach**: Use **Account Key** for developer/admin use. Use **SAS Token** when you need scoped, time-limited access. The app displays expiration warnings in the storage selector when a SAS token is within 30 days of expiry.

**Expiration handling**: SAS tokens have a built-in expiry date (`se` parameter). The app parses this and shows:
- `[EXPIRED]` badge if the token has expired
- `[Xd left]` badge if expiring within 30 days

> **Recommendation**: When adding a SAS token, note its expiration date. The app will warn you as it approaches, but you must manually replace the token with `storage-nav add --name <same-name> ...` which overwrites the existing entry.

### 2. Server Port

**Purpose**: Set the HTTP port for the Express server (used by both the Electron UI and the web interface).

**How to configure**:

```bash
# Default: 3100
storage-nav ui

# Custom port
storage-nav ui --port 3200
```

**Default value**: `3100`

**When to change**: When running multiple instances simultaneously, or when port 3100 is already in use.

### 3. Storage Account Selection

**Purpose**: Select which storage account to use for CLI commands.

**How to configure**:

```bash
# Explicit selection
storage-nav containers --storage corporateloans
storage-nav ls --container prompts --storage corporateloans

# Implicit: uses first configured account if --storage is omitted
storage-nav containers
```

**Default behavior**: If `--storage` is omitted, the first configured account is used.

### 4. Inline Secrets

**Purpose**: Allow commands to run without pre-configured credentials, useful for scripting, one-off operations, or first-time use.

**How to configure**:

```bash
# Blob commands: inline storage credentials
storage-nav containers --account myaccount --account-key "your-key"
storage-nav ls --container data --account myaccount --sas-token "sv=2021..."

# Repo commands: inline PAT
storage-nav clone-github --repo https://github.com/org/repo --container myrepo --pat "ghp_xxx"
storage-nav sync --container myrepo --pat "ghp_xxx"

# Combine inline storage + inline PAT
storage-nav clone-github --repo https://github.com/org/repo --container myrepo \
  --pat "ghp_xxx" --account myaccount --account-key "key"
```

**Resolution chain** (in priority order):
1. Inline CLI parameter (`--account-key`, `--sas-token`, `--pat`)
2. Named stored credential (`--storage`, `--token-name`)
3. First stored credential for the account/provider
4. Interactive prompt — asks user for the secret and offers to store it

**When to use**: CI/CD pipelines, one-off operations, or when you don't want to persist credentials.

## Configuration Priority

All secrets follow the resolution chain: inline CLI param → stored credential → interactive prompt. No environment variables or config files are used.

| Setting | Source | Priority |
|---------|--------|----------|
| Storage credentials | `~/.storage-navigator/credentials.json` | Only source |
| Server port | `--port` CLI argument | Only source (default: 3100) |
| Storage selection | `--storage` CLI argument | Explicit > first configured |
| Theme (UI only) | `localStorage` in browser | Persisted per browser |

## Security Considerations

- Credentials are encrypted at rest using AES-256-GCM with a random key
- The encryption key file (`machine.key`) has `0600` permissions (owner read/write only)
- The credential directory (`~/.storage-navigator/`) has `0700` permissions
- Credentials are never logged, exported with secrets, or sent to external services
- The `export` command and API endpoint exclude secrets — only metadata is exported

## Troubleshooting

### "Failed to decrypt credentials"

The encryption key has changed or the credentials file is corrupted. The app will attempt to migrate from old key formats automatically. If migration fails:

1. Check `~/.storage-navigator/machine.key` exists
2. If lost, re-add your storage accounts with `storage-nav add`
3. See `~/ai-coding/claude-workdocs/local-credential-encryption-pitfalls.md` for details on the encryption approach

### Port already in use

```bash
# Use a different port
storage-nav ui --port 3200
```
