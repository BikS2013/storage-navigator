# storage-navigator

> **Repository:** [https://NBGIDP@dev.azure.com/NBGIDP/DevOps_Private/_git/storage-navigator](https://NBGIDP@dev.azure.com/NBGIDP/DevOps_Private/_git/storage-navigator)

## Overview

**storage-navigator** is a unified platform for browsing, editing, automating, and syncing Azure Blob Storage and Azure File Shares. It provides multiple interfaces—including a command-line tool (CLI), an Electron-based desktop UI, an HTTP brokering API, and an LLM-powered agent—built atop a shared backend abstraction. The project enables users to interact with Azure Storage directly (via account keys or SAS tokens) or through a secure, RBAC-protected API, with advanced features like repo-to-container sync, publishing to GitHub, streaming ZIP downloads, and LLM-driven automation.

The repository is organized to support both end-user applications and DevOps/infrastructure needs, including CI/CD pipelines, configuration management, and comprehensive documentation.

---

## Repository Structure

```
├── .claude/
│   ├── memory/
│   │   ├── feedback_electron_rename.md
│   │   └── MEMORY.md
│   ├── skills/
│   │   └── electron-app-branding.md
│   └── settings.local.json
├── .serena/
│   ├── memories/
│   │   ├── project_overview.md
│   │   ├── style_conventions.md
│   │   ├── suggested_commands.md
│   │   └── task_completion.md
│   ├── .gitignore
│   └── project.yml
├── API/
│   ├── src/
│   │   ├── auth/
│   │   ├── azure/
│   │   ├── errors/
│   │   ├── observability/
│   │   ├── rbac/
│   │   ├── routes/
│   │   ├── streaming/
│   │   ├── types/
│   │   ├── util/
│   │   ├── app.ts
│   │   ├── config.ts
│   │   └── index.ts
│   ├── test/
│   │   ├── helpers/
│   │   ├── integration/
│   │   └── unit/
│   ├── test_scripts/
│   │   └── smoke-download.ts
│   ├── .dockerignore
│   ├── .env.example
│   ├── .gitignore
│   ├── docker-compose.dev.yml
│   ├── Dockerfile
│   ├── openapi.yaml
│   ├── package-lock.json
│   ├── package.json
│   ├── README.md
│   ├── tsconfig.json
│   └── vitest.config.ts
├── assets/
│   ├── icon.icns
│   ├── icon.png
│   └── icon.svg
├── bin/
│   └── storage-nav.mjs
├── configuration/
│   └── storage-nav-api/
│       └── settings.QA.json
├── docs/
│   ├── design/
│   │   ├── configuration-guide.md
│   │   ├── implementation-notes-github-app-auth.md
│   │   ├── plan-001-docx-support.md
│   │   ├── plan-002-repo-sync.md
│   │   ├── plan-003-inline-secrets.md
│   │   ├── plan-004-folder-link-sync.md
│   │   ├── plan-005-container-diff.md
│   │   ├── plan-006-rbac-api-impl.md
│   │   ├── plan-006-rbac-api.md
│   │   ├── plan-007-storage-nav-client-adapter-impl.md
│   │   ├── plan-007-storage-nav-client-adapter.md
│   │   ├── plan-008-static-auth-header-impl.md
│   │   ├── plan-008-static-auth-header.md
│   │   ├── plan-009-agent-subcommand.md
│   │   ├── plan-010-tui.md
│   │   ├── plan-011-reverse-git.md
│   │   ├── plan-012-github-app-auth.md
│   │   ├── plan-013-macos-standalone-app.md
│   │   ├── plan-014-macos-ui-redesign.md
│   │   ├── project-design.md
│   │   └── project-functions.md
│   ├── reference/
│   │   ├── .env.example
│   │   ├── api-npm-audit-baseline-2026-04-23.json
│   │   ├── codebase-scan-container-diff.md
│   │   ├── codebase-scan-docx-support.md
│   │   ├── codebase-scan-folder-link-sync.md
│   │   ├── codebase-scan-github-app-auth.md
│   │   ├── codebase-scan-macos-ui-redesign.md
│   │   ├── codebase-scan-repo-sync.md
│   │   ├── codebase-scan-reverse-git.md
│   │   ├── codex-plugin-azure-openai-config.md
│   │   ├── compliance-audit-report.md
│   │   ├── config.json.example
│   │   ├── dependency-validation-github-app-auth.md
│   │   ├── dependency-validation-reverse-git.md
│   │   ├── integration-verification-github-app-auth.md
│   │   ├── investigation-container-diff.md
│   │   ├── investigation-docx-support.md
│   │   ├── investigation-folder-link-sync.md
│   │   ├── investigation-github-app-auth.md
│   │   ├── investigation-repo-sync.md
│   │   ├── investigation-reverse-git.md
│   │   ├── refined-request-container-diff.md
│   │   ├── refined-request-docx-support.md
│   │   ├── refined-request-folder-link-sync.md
│   │   ├── refined-request-github-app-auth.md
│   │   ├── refined-request-macos-ui-redesign.md
│   │   ├── refined-request-repo-sync.md
│   │   ├── refined-request-reverse-git.md
│   │   ├── test-build-reverse-git-phase-a.md
│   │   ├── test-build-reverse-git-phase-b.md
│   │   ├── test-build-reverse-git-phase-c.md
│   │   ├── test-build-reverse-git-phase-d.md
│   │   ├── test-build-reverse-git-phase-e.md
│   │   └── test-build-reverse-git-phase-f.md
│   ├── research/
│   │   ├── azure-devops-git-pushes-api.md
│   │   ├── github-app-installation-auth-and-repo-scope.md
│   │   ├── github-git-data-api.md
│   │   ├── jose-rs256-github-app-jwt.md
│   │   ├── macos-tahoe-design-for-electron.md
│   │   └── openai-codex-cli-models.md
│   ├── superpowers/
│   │   ├── plans/
│   │   └── specs/
│   └── tools/
│       ├── storage-nav-agent.md
│       ├── storage-nav-api.md
│       └── storage-nav.md
├── pipelines/
│   ├── README.md
│   ├── storage-nav-api.yaml
│   └── sync-from-github.sh
├── src/
│   ├── agent/
│   │   ├── providers/
│   │   ├── tools/
│   │   ├── graph.ts
│   │   ├── logging.ts
│   │   ├── run.ts
│   │   ├── stream.ts
│   │   └── system-prompt.ts
│   ├── cli/
│   │   ├── commands/
│   │   └── index.ts
│   ├── config/
│   │   └── agent-config.ts
│   ├── core/
│   │   ├── backend/
│   │   ├── blob-client.ts
│   │   ├── blob-enumerator.ts
│   │   ├── credential-store.ts
```

---

## Key Components

### Applications & Services

| Component                | Location              | Purpose                                                                                       |
|--------------------------|-----------------------|-----------------------------------------------------------------------------------------------|
| **CLI (`storage-nav`)**  | `src/cli/`            | Command-line interface for browsing, viewing, editing, uploading, downloading, and syncing Azure Storage. |
| **Desktop UI**           | `src/electron/`       | Electron-based desktop application with tree explorer, in-place text editor, ZIP download, and repo diff viewer. |
| **API (`storage-nav-api`)| `API/`                | HTTP service that brokers Azure Storage access behind OIDC and RBAC, with optional static-header perimeter gate. |
| **Agent**                | `src/agent/`          | LLM-driven ReAct agent exposing CLI commands as LLM tools, supporting multiple AI providers and confirmation-gated mutations. |

### Infrastructure & DevOps

| Item                       | Location            | Purpose                                                                                  |
|----------------------------|---------------------|------------------------------------------------------------------------------------------|
| **CI/CD Pipeline**         | `pipelines/storage-nav-api.yaml` | Azure DevOps pipeline for building, testing, and deploying the API service.              |
| **Pipeline Sync Script**   | `pipelines/sync-from-github.sh` | Synchronizes code from GitHub into the Azure DevOps environment.                         |
| **Dockerfile**             | `API/Dockerfile`    | Builds the API service into a container image for deployment.                            |
| **docker-compose.dev.yml** | `API/docker-compose.dev.yml` | Local development orchestration for the API and dependencies.                             |
| **Configuration**          | `configuration/storage-nav-api/settings.QA.json` | Stores QA environment settings for the API.                                              |

### Documentation

| Area                  | Location                | Purpose                                                                                  |
|-----------------------|-------------------------|------------------------------------------------------------------------------------------|
| **Design Docs**       | `docs/design/`          | Feature plans, architecture, and implementation notes.                                   |
| **Tool References**   | `docs/tools/`           | Reference documentation for CLI, API, and Agent.                                         |
| **Research**          | `docs/research/`        | Investigations and background on related technologies and APIs.                          |
| **Reference Material**| `docs/reference/`       | Compliance, audit, and codebase scan reports; example configs.                           |
| **Superpowers**       | `docs/superpowers/`     | Advanced feature plans and specifications.                                               |

### API Service (Details)

- **API Source:** `API/src/` — Express-based Node.js service with modules for authentication (OIDC, static header), Azure SDK integration, RBAC enforcement, error handling, observability, and streaming.
- **API OpenAPI Spec:** `API/openapi.yaml` — OpenAPI definition for the HTTP API.
- **API Tests:** `API/test/` — Integration and unit tests for API endpoints and features.
- **API Test Scripts:** `API/test_scripts/` — Manual/integration smoke test scripts.

### CLI & Desktop UI (Details)

- **CLI Commands:** `src/cli/commands/` — One file per CLI command group (e.g., add storage, list, view, sync, publish).
- **Electron App:** `src/electron/` — Main process, embedded server, and frontend assets for the desktop UI.
- **Credential Store:** `src/core/credential-store.ts` — Encrypted local storage for credentials and tokens.
- **Backend Abstraction:** `src/core/backend/` — Unified interface for all storage backends (direct, SAS, API).
- **Sync Engine:** `src/core/sync-engine.ts` — Logic for repo ↔ container synchronization and diffing.

### Agent

- **Agent Core:** `src/agent/` — Implements the LLM-powered agent using LangGraph, with provider plugins for OpenAI, Anthropic, Gemini, Azure OpenAI, and local endpoints.
- **Agent Tools:** `src/agent/tools/` — Maps CLI commands to LLM tool schemas.
- **Agent Providers:** `src/agent/providers/` — Integrations with supported LLM providers.

### Configuration & Assets

- **App Icons:** `assets/` — Application icons for desktop packaging.
- **QA Settings:** `configuration/storage-nav-api/settings.QA.json` — Environment-specific configuration for the API.

### Pipelines

#### List of Pipelines

| Pipeline Name              | Purpose                                                                                 |
|----------------------------|-----------------------------------------------------------------------------------------|
| `storage-nav-api.yaml`     | CI/CD pipeline for building, testing, and deploying the Storage Navigator API service.  |
| `sync-from-github.sh`      | Script to synchronize codebase from GitHub into Azure DevOps.                          |

---

## Tech Stack

- **Languages:** TypeScript, JavaScript
- **Frameworks/Libraries:** Node.js, Express, Electron, LangGraph, Azure SDK, zod, jose
- **Testing:** Vitest
- **Containerization:** Docker, Docker Compose
- **CI/CD:** Azure DevOps Pipelines
- **Cloud Services:** Azure Blob Storage, Azure File Shares, Azure App Service, Azure Key Vault (for secrets), Azure Managed Identity
- **Other:** OpenAPI (for API definition), OIDC (authentication), RBAC (role-based access control)

---

## Project Structure

- `.claude/`, `.serena/`: Internal memory, skills, and project management for AI/automation tooling (not part of core product).
- `API/`: Source code, configuration, and tests for the HTTP brokering API service. Includes Dockerfile, OpenAPI spec, and pipeline definitions.
- `assets/`: Application icons for desktop builds.
- `bin/`: Binary entry points (e.g., for CLI).
- `configuration/`: Environment-specific configuration files (e.g., API QA settings).
- `docs/`: Comprehensive documentation, including design plans, tool references, research, and compliance.
- `pipelines/`: Azure DevOps pipeline definitions and sync scripts.
- `src/`: Main source code for CLI, Electron desktop UI, agent, core backend logic, and utilities.
    - `src/agent/`: LLM agent implementation and provider integrations.
    - `src/cli/`: CLI command definitions and entry point.
    - `src/core/`: Storage backend abstraction, credential management, sync engine, and related logic.
    - `src/electron/`: Electron app main process, embedded server, and renderer assets.
    - `src/tui/`: TUI for the agent (streaming, slash commands).
    - `src/util/`: Shared utility functions.
- (Test scripts and unit tests are present in both `API/test/` and `src/` subfolders.)

---

## Configuration & Secrets

- **Encrypted Credential Store:** User credentials, tokens, and backend entries are stored encrypted at rest (see `src/core/credential-store.ts`).
- **Environment Variables:** Agent provider keys and API secrets are loaded from environment files (e.g., `.env`, `~/.tool-agents/storage-nav/.env`).
- **API Settings:** Environment-specific API settings are in `configuration/storage-nav-api/`.

---

## Documentation

Key documentation is provided in the `docs/` folder:

- `docs/tools/storage-nav.md`: CLI and UI command reference.
- `docs/tools/storage-nav-api.md`: API endpoints, RBAC, and authentication.
- `docs/tools/storage-nav-agent.md`: Agent provider matrix and usage.
- `docs/design/configuration-guide.md`: Credentials, config, and GitHub App authentication.
- `docs/design/project-design.md`: High-level architecture.
- `docs/design/plan-*.md`: Feature-specific design and implementation plans.

---

## Infrastructure & Deployment

- **API Service** can be built and deployed via Docker (see `API/Dockerfile`), with local development supported by Docker Compose (`API/docker-compose.dev.yml`).
- **CI/CD** is managed through Azure DevOps pipelines (`pipelines/storage-nav-api.yaml`).
- **API** is designed for deployment to Azure App Service, with secrets pulled from Azure Key Vault and support for Managed Identity.

---

## Testing

- **API Tests:** Located in `API/test/` (unit and integration).
- **Test Scripts:** Manual/integration scripts in `API/test_scripts/`.
- **Client Tests:** (Not fully visible in the truncated tree, but typically under `src/` or `tests/`).

---

## Notes

- Shared utility code and helper files exist throughout the codebase (e.g., `src/util/`, `API/src/util/`), but are not detailed here.
- Some internal folders (e.g., `.claude/`, `.serena/`) are for project automation and are not part of the main application or infrastructure.

---