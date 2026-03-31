# Plan 003: Inline Secrets as CLI Parameters

## Objective
Allow all CLI commands to accept secrets (account keys, SAS tokens, PATs) as command-line parameters. If not provided, fall back to stored credentials. If neither exists, prompt the user interactively and offer to store the secret.

## Resolution Chain
1. CLI parameter (--account-key, --sas-token, --pat)
2. Stored credential (from encrypted credential store)
3. Interactive prompt → user provides secret → offer to store it

## Changes

### Phase 1: Shared helper module
Create `src/cli/commands/shared.ts` with:
- `resolveStorageEntry(opts)`: accepts {storage?, accountKey?, sasToken?, account?}, resolves through the chain
- `resolvePatToken(store, provider, opts)`: accepts {pat?, tokenName?}, resolves through the chain
- `promptSecret(question)`: readline prompt for secrets
- `promptYesNo(question)`: y/N prompt
- Reuse across all command files to eliminate the duplicated resolveStorage functions

### Phase 2: Update blob commands
- `view.ts`: use shared resolveStorageEntry, accept accountKey/sasToken
- `blob-ops.ts`: same
- `index.ts`: add --account-key and --sas-token options to containers, ls, view, download, rename, delete, create

### Phase 3: Update repo sync commands
- `repo-sync.ts`: use shared resolvePatToken, accept --pat
- `index.ts`: add --pat option to clone-github, clone-devops, sync

### Phase 4: Documentation update
