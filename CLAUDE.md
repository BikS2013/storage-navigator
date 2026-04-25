<structure-and-conventions>
## Structure & Conventions

- Every time you want to create a test script, you must create it in the test_scripts folder. If the folder doesn't exist, you must make it.

- All the plans must be kept under the docs/design folder inside the project's folder in separate files: Each plan file must be named according to the following pattern: plan-xxx-<indicative description>.md

- The complete project design must be maintained inside a file named docs/design/project-design.md under the project's folder. The file must be updated with each new design or design change.

- All the reference material used for the project must be collected and kept under the docs/reference folder.
- All the functional requirements and all the feature descriptions must be registered in the /docs/design/project-functions.MD document under the project's folder.

<configuration-guide>
- If the user ask you to create a configuration guide, you must create it under the docs/design folder, name it configuration-guide.md and be sure to explain the following:
  - if multiple configuration options exist (like config file, env variables, cli params, etc) you must explain the options and what is the priority of each one.
  - Which is the purpose and the use of each configuration variable
  - How the user can obtain such a configuration variable
  - What is the recomented approach of storing or managing this configuration variable
  - Which options exist for the variable and what each option means for the project
  - If there are any default value for the parameter you must present it.
  - For configuration parameters that expire (e.g., PAT keys, tokens), I want you to propose to the user adding a parameter to capture the parameter's expiration date, so the app or service can proactively warn users to renew.
</configuration-guide>

- Every time you create a prompt working in a project, the prompt must be placed inside a dedicated folder named prompts. If the folder doesn't exists you must create it. The prompt file name must have an sequential number prefix and must be representative to the prompt use and purpose.

- You must maintain a document at the root level of the project, named "Issues - Pending Items.md," where you must register any issue, pending item, inconsistency, or discrepancy you detect. Every time you fix a defect or an issue, you must check this file to see if there is an item to remove.
- The "Issues - Pending Items.md" content must be organized with the pending items on top and the completed items after. From the pending items the most critical and important must be first followed by the rest.

- When I ask you to create tools in the context of a project everything must be in Typescript.
- Every tool you develop must have its own dedicated documentation file, named after the tool, placed under the `docs/tools/` folder of the project (create the folder if it does not exist). The file must be named `<tool-name>.md` and must contain the complete tool documentation in the following format:
<toolName>
    <objective>
        what the tool does
    </objective>
    <command>
        the exact command to run
    </command>
    <info>
        detailed description of the tool
        command line parameters and their description
        examples of usage
    </info>
</toolName>

- The project's CLAUDE.md file must NOT contain the full tool documentation. Instead, it must contain a "Tools" section with a concise reference entry for each tool that includes:
  - The tool's name
  - A high-level description of what the tool is capable of (one or two sentences)
  - The relative path to the tool's dedicated documentation file (e.g. `docs/tools/<tool-name>.md`) so that Claude can retrieve the full documentation any time it is needed.

- Every time I ask you to do something that requires the creation of a code script, I want you to examine the tools already implemented in the scope of the project (by consulting the "Tools" section of the project's CLAUDE.md and the corresponding documentation files under `docs/tools/`) to detect if the code you plan to write fits to the scope of an existing tool.
- If so, I want you to implement the code as an extension of the tool, otherwise I want you to build a generic and abstract version of the code as a tool, which will be part of the toolset of the project.
- Our goal is, while the project progressing, to develop the tools needed to test, evaluate, generate data, collect information, etc and reuse them in a consistent manner.
- All these tools must be referenced inside the project's CLAUDE.md (with their dedicated documentation files under `docs/tools/`) to allow their consistent reuse.

- Every tool must follow the standard environment-variable resolution chain. Configuration values are read from the following sources, ordered from lowest to highest priority — each higher source overrides the lower one when the same variable is defined in both:
  1. **Shell-registered environment variables** — what the user has exported in the current shell (`process.env`). This is the baseline.
  2. **`~/.tool-agents/[tool-name]/.env`** — the per-user, per-tool durable defaults file. Values here override the shell variables.
  3. **Local `.env`** — the `.env` file in the current working directory (project-local override). Values here override the `~/.tool-agents/[tool-name]/.env` values.
  4. **Command-line parameters** — flags passed by the user when invoking the tool. These override every env-variable source above and always win.
- On startup the tool must check whether the `~/.tool-agents/[tool-name]/` folder exists; if it does not, the tool must create it (with mode `0700`, and seed an empty or placeholder `.env` inside with mode `0600`) before resolving any configuration. Never assume the folder is already present.

- For variables related to LLM provider configuration (`API_KEY`, `BASE_URL`, `ENDPOINT`, `DEPLOYMENT`, `API_VERSION`, etc.), the tool must adopt the provider's documented, vendor-canonical names — **never prefix them with the tool name**. This lets a single shell-exported variable (e.g. `OPENAI_API_KEY`) be reused by every tool that talks to that provider, instead of forcing the user to re-declare the same value per tool. Canonical names to honor:
  - **OpenAI** — `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`
  - **Anthropic** — `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`
  - **Gemini** — `GOOGLE_API_KEY` (accept `GEMINI_API_KEY` as an alias)
  - **Azure OpenAI** — `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`
  - **Azure Anthropic** (via Foundry) — `AZURE_AI_INFERENCE_KEY`, `AZURE_AI_INFERENCE_ENDPOINT`
  - **Ollama** — `OLLAMA_HOST`
  - **LiteLLM proxy** — `LITELLM_PROXY_URL`, `LITELLM_MASTER_KEY`
  - **MLX-LM server** — reuse `OPENAI_BASE_URL` (MLX-LM is OpenAI-wire-compatible and has no dedicated env convention)

- The standard set of LLM providers every tool must support out of the box (extra providers may be added; **none of these may be omitted**):
  1. **Direct OpenAI** — `api.openai.com`.
  2. **Direct Anthropic** — `api.anthropic.com`.
  3. **Gemini** — Google Generative AI direct API.
  4. **Azure OpenAI** — Azure-hosted OpenAI deployments.
  5. **Azure Anthropic** — Azure AI Foundry-hosted Anthropic models.
  6. **Local Ollama** — local Ollama server (default `http://localhost:11434`).
  7. **Local LiteLLM** — local LiteLLM proxy (OpenAI-wire-compatible).
  8. **Local MLX** — local MLX-LM server on Apple Silicon (OpenAI-wire-compatible).

- When I ask you to locate code, I need to give me the folder, the file name, the class, and the line number together with the code extract.
- Don't perform any version control operation unless I explicitly request it.

- When you design databases you must align with the following table naming conventions:
  - Table names must be singular e.g. the table that keeps customers' data must be called "Customer"
  - Tables that are used to express references from one entity to another can by plural if the first entity is linked to many other entities.
  - So we have "Customer" and "Transaction" tables, we have CustomerTransactions.

- You must never create fallback solutions for configuration settings. In every case a configuration setting is not provided you must raise the appropriate exception. You must never substitute the missing config value with a default or a fallback value.
- If I ask you to make an exception to the configuration setting rule, you must write this exception in the projects memory file, before you implement it.
</structure-and-conventions>

---

# Storage Navigator

Azure Blob Storage Navigator — browse containers and view files through CLI or desktop UI.

## Tools

### storage-nav

CLI and Electron desktop app for browsing Azure Blob Storage and Azure File Shares. Manages encrypted credentials and PATs, clones/syncs GitHub and Azure DevOps repos into containers, and diffs containers against linked repos.

Full documentation: [docs/tools/storage-nav.md](docs/tools/storage-nav.md)

### storage-nav-api

HTTP API (in `API/`) that brokers Azure Blob and Azure Files access behind toggleable OIDC and three global roles (StorageReader, StorageWriter, StorageAdmin), plus an optional static auth header. Designed as a third backend type for the Storage Navigator client.

Full documentation: [docs/tools/storage-nav-api.md](docs/tools/storage-nav-api.md)

### storage-nav-agent

LangGraph ReAct agent (`agent` subcommand) that wraps storage-nav's CLI commands as LLM tools, with one-shot and interactive TUI modes, six provider backends (OpenAI, Anthropic, Gemini, Azure OpenAI, Azure Anthropic, local OpenAI-wire), persistent memory, and confirmation-gated mutations.

Full documentation: [docs/tools/storage-nav-agent.md](docs/tools/storage-nav-agent.md)
