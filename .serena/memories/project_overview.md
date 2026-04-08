# Storage Navigator overview
- Purpose: Azure Blob Storage Navigator with a CLI and Electron UI for browsing blob containers and related repo/link sync features.
- Tech stack: TypeScript, Node.js ESM, Commander CLI, Electron, Express, Azure Blob SDK.
- Structure: `src/core` for service/integration logic, `src/cli` for commands, `src/electron` for desktop/server UI, `docs` for design/reference material, `test_scripts` for ad hoc scripts.
- Build output: `dist`, CLI entry `bin/storage-nav.mjs`.
