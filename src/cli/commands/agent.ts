/**
 * storage-nav agent subcommand entry point.
 *
 * Orchestrates:
 *   1. dotenv.config (Policy B — file-wins: override: true)
 *   2. loadAgentConfig(flags)
 *   3. Provider model construction
 *   4. Tool catalog build
 *   5. One-shot or interactive run
 */
import { loadAgentConfig, ensureAgentConfigDir, ConfigurationError } from "../../config/agent-config.js";
import type { AgentConfigFlags } from "../../config/agent-config.js";
import { buildModel } from "../../agent/providers/registry.js";
import { buildToolCatalog } from "../../agent/tools/registry.js";
import { loadSystemPrompt } from "../../agent/system-prompt.js";
import { createAgentLogger } from "../../agent/logging.js";
import { runOneShot, runInteractive } from "../../agent/run.js";
import type { AgentResult } from "../../agent/run.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const TOOL_AGENT_DIR = path.join(os.homedir(), ".tool-agents", "storage-nav");
const DEFAULT_ENV_FILE = path.join(TOOL_AGENT_DIR, ".env");
const DEFAULT_CONFIG_FILE = path.join(TOOL_AGENT_DIR, "config.json");

/** Seed the ~/.tool-agents/storage-nav/ folder on first run. */
function seedConfigDir(envFilePath: string, configFilePath: string): void {
  ensureAgentConfigDir();

  // Seed .env (mode 0600) — commented-out placeholders only, never real values
  if (!fs.existsSync(envFilePath)) {
    const envTemplate = `# storage-nav agent — secret configuration
# Policy B (file-wins): values here override existing shell exports.
# This file is the authoritative source for storage-nav agent config.
# Mode: 0600 — keep this file private.

# ── Global ─────────────────────────────────────────────────────
# STORAGE_NAV_AGENT_PROVIDER=azure-openai
# STORAGE_NAV_AGENT_MODEL=gpt-4o
# STORAGE_NAV_AGENT_MAX_STEPS=20
# STORAGE_NAV_AGENT_TEMPERATURE=0
# STORAGE_NAV_AGENT_PER_TOOL_BUDGET_BYTES=16384
# STORAGE_NAV_AGENT_ALLOW_MUTATIONS=false
# STORAGE_NAV_AGENT_VERBOSE=false

# ── OpenAI ─────────────────────────────────────────────────────
# OPENAI_API_KEY=sk-...
# OPENAI_BASE_URL=

# ── Anthropic ──────────────────────────────────────────────────
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_BASE_URL=

# ── Google Gemini ──────────────────────────────────────────────
# GOOGLE_API_KEY=
# GEMINI_API_KEY=

# ── Azure OpenAI ───────────────────────────────────────────────
# AZURE_OPENAI_API_KEY=
# AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
# AZURE_OPENAI_DEPLOYMENT=gpt-4o
# AZURE_OPENAI_API_VERSION=2024-10-21

# ── Azure Anthropic (Foundry) ──────────────────────────────────
# AZURE_AI_INFERENCE_KEY=
# AZURE_AI_INFERENCE_ENDPOINT=https://<resource>.services.ai.azure.com/
# AZURE_AI_INFERENCE_MODEL=claude-3-5-sonnet

# ── Local OpenAI-compatible (Ollama / LiteLLM / MLX / llama.cpp) ──
# LOCAL_OPENAI_BASE_URL=http://localhost:11434/v1
# OLLAMA_HOST=http://localhost:11434
# OPENAI_API_KEY=not-needed
`;
    fs.writeFileSync(envFilePath, envTemplate, { mode: 0o600 });
    process.stderr.write(`[agent] Seeded ${envFilePath} (mode 0600)\n`);
  }

  // Seed config.json — non-secret runtime defaults
  if (!fs.existsSync(configFilePath)) {
    const configTemplate = {
      schemaVersion: 1,
      _comment: "Non-secret runtime defaults for storage-nav agent. Edit provider/model as needed.",
      provider: "azure-openai",
      model: "gpt-4o",
      maxSteps: 20,
      temperature: 0,
      perToolBudgetBytes: 16384,
      allowMutations: false,
      verbose: false,
    };
    fs.writeFileSync(configFilePath, JSON.stringify(configTemplate, null, 2) + "\n");
    process.stderr.write(`[agent] Created ${configFilePath}\n`);
    process.stderr.write(`[agent] Edit provider/model in ${configFilePath} or set STORAGE_NAV_AGENT_PROVIDER / STORAGE_NAV_AGENT_MODEL in environment.\n`);
  }
}

export interface AgentOptions extends AgentConfigFlags {
  logFile?: string;
  quiet?: boolean;
}

export async function run(
  prompt: string | null,
  opts: AgentOptions
): Promise<AgentResult | void> {
  const envFilePath = opts.envFile ?? DEFAULT_ENV_FILE;
  const configFilePath = opts.configFile ?? DEFAULT_CONFIG_FILE;

  // Seed config dir before anything else (creates folder + placeholder files)
  seedConfigDir(envFilePath, configFilePath);

  // Policy B: file-wins — .env in ~/.tool-agents/storage-nav/ is the authoritative
  // source for this tool's config, so it overrides existing shell exports. CLI flags
  // still beat both because loadAgentConfig() checks flags first.
  const dotenv = await import("dotenv");
  dotenv.config({ path: envFilePath, override: true });

  // Load and validate agent config (throws ConfigurationError on missing required)
  const cfg = loadAgentConfig({ ...opts, envFile: envFilePath, configFile: configFilePath });

  // Validate: one-shot requires a prompt; interactive requires neither
  if (!cfg.interactive && !prompt) {
    throw new ConfigurationError(
      "prompt",
      ["positional argument", "--interactive"],
      "Provide a prompt or use --interactive for REPL mode."
    );
  }

  // TUI mode: when --interactive is set AND stdin is a TTY, we route the
  // structured logger to a per-session file so it does not corrupt the
  // raw-mode rendering. The CLI flag --log-file still wins if explicitly
  // provided. Non-TTY interactive (CI / piped input) falls back to the
  // existing line-based runInteractive REPL with logger going to stderr.
  const isTuiSession = !!cfg.interactive && !!process.stdin.isTTY;
  let logFilePath: string | null = opts.logFile ?? null;
  let tuiLogPath: string | null = null;
  if (isTuiSession && !logFilePath) {
    const { defaultTuiLogPath } = await import("../../tui/log-redirect.js");
    tuiLogPath = defaultTuiLogPath();
    logFilePath = tuiLogPath;
  }
  const logger = createAgentLogger(cfg, {
    logFilePath,
    // In TUI mode silence stderr writes (they would corrupt the raw-mode UI);
    // log file still receives the structured lines.
    quiet: isTuiSession ? true : opts.quiet,
  });

  logger.info("Agent starting", {
    provider: cfg.provider,
    model: cfg.model,
    allowMutations: cfg.allowMutations,
    interactive: cfg.interactive,
  });

  // Build provider model
  const model = buildModel(cfg);

  // Build tool catalog
  const tools = buildToolCatalog(cfg);
  logger.info(`Tool catalog: ${tools.length} tools`, {
    tools: tools.map((t) => t.name),
    mutationsEnabled: cfg.allowMutations,
  });

  // Load system prompt
  const systemPrompt = loadSystemPrompt(cfg.systemPrompt, cfg.systemPromptFile);

  try {
    if (cfg.interactive) {
      if (isTuiSession) {
        const { mountTui } = await import("../../tui/index.js");
        await mountTui({
          cfg, model, tools, systemPrompt, logger,
          logFilePath: logFilePath!,
        });
        return;
      }
      // Non-TTY (CI / piped stdin): keep the legacy line-based REPL.
      await runInteractive({ model, tools, systemPrompt, cfg, logger });
      return;
    }

    const result = await runOneShot({
      model,
      tools,
      systemPrompt,
      cfg,
      prompt: prompt!,
      logger,
    });

    await logger.close();
    return result;
  } catch (err) {
    await logger.close();
    throw err;
  }
}
