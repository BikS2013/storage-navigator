/**
 * Agent configuration loader for storage-nav agent subcommand.
 *
 * Precedence (Policy B — file-wins):
 *   CLI flag > ~/.tool-agents/storage-nav/.env > shell env var (STORAGE_NAV_AGENT_*) > ~/.tool-agents/storage-nav/config.json > throw
 *
 * Note on Policy B: dotenv loads the .env with override: true, so values in the .env
 * file replace any matching shell exports in process.env before this loader reads them.
 * That means any reference to "process.env[X]" below already reflects the file-wins
 * outcome — the .env value if present, otherwise the shell value.
 *
 * No fallbacks for required values — missing required setting throws ConfigurationError (exit 3).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";

// ── Error class ───────────────────────────────────────────────────────────────

export class ConfigurationError extends Error {
  readonly code = "CONFIG_MISSING";
  readonly missingSetting: string;
  readonly checkedSources: string[];

  constructor(missingSetting: string, checkedSources: string[], detail?: string) {
    const msg =
      `Mandatory setting "${missingSetting}" was not provided. Checked: ${checkedSources.join(", ")}.` +
      (detail ? ` ${detail}` : "");
    super(msg);
    this.name = "ConfigurationError";
    this.missingSetting = missingSetting;
    this.checkedSources = checkedSources;
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProviderName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "azure-openai"
  | "azure-anthropic"
  | "local-openai";

export interface AgentConfigFlags {
  provider?: string;
  model?: string;
  maxSteps?: number;
  temperature?: number;
  systemPrompt?: string;
  systemPromptFile?: string;
  tools?: string;
  perToolBudgetBytes?: number;
  allowMutations?: boolean;
  envFile?: string;
  configFile?: string;
  baseUrl?: string;
  verbose?: boolean;
  interactive?: boolean;
}

export interface AgentConfig {
  readonly provider: ProviderName;
  readonly model: string;
  readonly temperature: number;
  readonly maxSteps: number;
  readonly perToolBudgetBytes: number;
  readonly systemPrompt: string | null;
  readonly systemPromptFile: string | null;
  readonly toolsAllowlist: readonly string[] | null;
  readonly allowMutations: boolean;
  readonly envFilePath: string | null;
  readonly configFilePath: string | null;
  readonly baseUrl: string | null;
  readonly verbose: boolean;
  readonly interactive: boolean;
  /** Frozen snapshot of provider-scoped env vars at call time. */
  readonly providerEnv: Readonly<Record<string, string>>;
}

// ── Config folder ─────────────────────────────────────────────────────────────

const TOOL_AGENT_DIR = path.join(os.homedir(), ".tool-agents", "storage-nav");
const DEFAULT_CONFIG_FILE = path.join(TOOL_AGENT_DIR, "config.json");
const DEFAULT_ENV_FILE = path.join(TOOL_AGENT_DIR, ".env");

/** Ensure the ~/.tool-agents/storage-nav/ folder exists with secure permissions. */
export function ensureAgentConfigDir(): void {
  if (!fs.existsSync(TOOL_AGENT_DIR)) {
    fs.mkdirSync(TOOL_AGENT_DIR, { recursive: true, mode: 0o700 });
  }
}

// ── config.json schema ────────────────────────────────────────────────────────

const ConfigJsonSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.string().optional(),
  model: z.string().optional(),
  maxSteps: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  perToolBudgetBytes: z.number().int().positive().optional(),
  allowMutations: z.boolean().optional(),
  tools: z.string().optional(),
  systemPromptFile: z.string().optional(),
  verbose: z.boolean().optional(),
});

type ConfigJson = z.infer<typeof ConfigJsonSchema>;

function loadConfigJson(filePath: string): ConfigJson {
  if (!fs.existsSync(filePath)) return {} as ConfigJson;
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new ConfigurationError("config.json", [filePath], `Cannot read: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError("config.json", [filePath], "File is not valid JSON.");
  }
  const result = ConfigJsonSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join("; ");
    throw new ConfigurationError("config.json", [filePath], `Schema validation failed: ${issues}`);
  }
  const version = (parsed as Record<string, unknown>)["schemaVersion"];
  if (version !== 1) {
    throw new ConfigurationError(
      "config.json",
      [filePath],
      `Unknown schemaVersion "${version}". Expected 1. Delete the file to reset.`
    );
  }
  return result.data;
}

// ── Provider model fallback env ───────────────────────────────────────────────

const PROVIDER_MODEL_FALLBACK_ENV: Partial<Record<ProviderName, string>> = {
  "azure-openai": "AZURE_OPENAI_DEPLOYMENT",
  "azure-anthropic": "AZURE_AI_INFERENCE_MODEL",
  "local-openai": "LOCAL_OPENAI_MODEL",
};

// ── Provider env var snapshot ─────────────────────────────────────────────────

const PROVIDER_ENV_VARS: Record<ProviderName, string[]> = {
  openai: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"],
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  "azure-openai": ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_API_VERSION"],
  "azure-anthropic": ["AZURE_AI_INFERENCE_KEY", "AZURE_AI_INFERENCE_ENDPOINT", "AZURE_AI_INFERENCE_MODEL"],
  "local-openai": ["OPENAI_API_KEY", "OPENAI_BASE_URL", "LOCAL_OPENAI_BASE_URL", "OLLAMA_HOST", "LOCAL_OPENAI_MODEL"],
};

function captureProviderEnv(provider: ProviderName): Readonly<Record<string, string>> {
  const vars = PROVIDER_ENV_VARS[provider] ?? [];
  const snap: Record<string, string> = {};
  for (const v of vars) {
    const val = process.env[v];
    if (val !== undefined) snap[v] = val;
  }
  return Object.freeze(snap);
}

// ── Main loader ───────────────────────────────────────────────────────────────

export function loadAgentConfig(flags: AgentConfigFlags): AgentConfig {
  const configFilePath = flags.configFile ?? DEFAULT_CONFIG_FILE;
  const envFilePath = flags.envFile ?? DEFAULT_ENV_FILE;
  const cfgJson = loadConfigJson(configFilePath);

  // Helper: resolve a string value from CLI > env > config.json > throw
  function resolve(
    flagVal: string | undefined,
    envVar: string,
    jsonVal: string | undefined,
    required: true,
    cliFlag: string
  ): string;
  function resolve(
    flagVal: string | undefined,
    envVar: string,
    jsonVal: string | undefined,
    required: false,
    cliFlag: string
  ): string | undefined;
  function resolve(
    flagVal: string | undefined,
    envVar: string,
    jsonVal: string | undefined,
    required: boolean,
    cliFlag: string
  ): string | undefined {
    if (flagVal !== undefined) return flagVal;
    if (process.env[envVar] !== undefined) return process.env[envVar]!;
    if (jsonVal !== undefined) return jsonVal;
    if (required) {
      throw new ConfigurationError(envVar, [cliFlag, `env:${envVar}`, envFilePath, configFilePath]);
    }
    return undefined;
  }

  // Provider
  const providerRaw = resolve(
    flags.provider,
    "STORAGE_NAV_AGENT_PROVIDER",
    cfgJson.provider,
    true,
    "--provider"
  );
  const validProviders: ProviderName[] = [
    "openai", "anthropic", "gemini", "azure-openai", "azure-anthropic", "local-openai"
  ];
  if (!validProviders.includes(providerRaw as ProviderName)) {
    throw new ConfigurationError(
      "STORAGE_NAV_AGENT_PROVIDER",
      ["--provider", "env:STORAGE_NAV_AGENT_PROVIDER", configFilePath],
      `Unknown provider "${providerRaw}". Valid: ${validProviders.join(", ")}.`
    );
  }
  const provider = providerRaw as ProviderName;

  // Model — precedence: CLI flag > STORAGE_NAV_AGENT_MODEL env > provider-specific env
  // (e.g. AZURE_OPENAI_DEPLOYMENT, loaded from .env) > config.json > throw.
  // Provider-specific env beats config.json because the .env layer outranks the config.json
  // layer in the documented Policy B precedence.
  const fallbackEnvName = PROVIDER_MODEL_FALLBACK_ENV[provider];
  const fallbackEnvValue =
    fallbackEnvName !== undefined ? process.env[fallbackEnvName] : undefined;
  const model: string | undefined =
    flags.model ??
    process.env["STORAGE_NAV_AGENT_MODEL"] ??
    fallbackEnvValue ??
    cfgJson.model;
  if (model === undefined) {
    const sources = ["--model", "env:STORAGE_NAV_AGENT_MODEL"];
    if (fallbackEnvName) sources.push(`env:${fallbackEnvName}`);
    sources.push(configFilePath);
    throw new ConfigurationError("STORAGE_NAV_AGENT_MODEL", sources);
  }

  // Numeric / boolean options
  const maxSteps =
    flags.maxSteps ??
    (process.env["STORAGE_NAV_AGENT_MAX_STEPS"] ? parseInt(process.env["STORAGE_NAV_AGENT_MAX_STEPS"]!, 10) : undefined) ??
    cfgJson.maxSteps ??
    20;

  const temperature =
    flags.temperature ??
    (process.env["STORAGE_NAV_AGENT_TEMPERATURE"] ? parseFloat(process.env["STORAGE_NAV_AGENT_TEMPERATURE"]!) : undefined) ??
    cfgJson.temperature ??
    0;

  const perToolBudgetBytes =
    flags.perToolBudgetBytes ??
    (process.env["STORAGE_NAV_AGENT_PER_TOOL_BUDGET_BYTES"] ? parseInt(process.env["STORAGE_NAV_AGENT_PER_TOOL_BUDGET_BYTES"]!, 10) : undefined) ??
    cfgJson.perToolBudgetBytes ??
    16384;

  const allowMutationsFromEnv = process.env["STORAGE_NAV_AGENT_ALLOW_MUTATIONS"] === "true";
  const allowMutations =
    flags.allowMutations !== undefined
      ? flags.allowMutations
      : allowMutationsFromEnv || (cfgJson.allowMutations ?? false);

  const toolsRaw =
    flags.tools ??
    process.env["STORAGE_NAV_AGENT_TOOLS"] ??
    cfgJson.tools;
  const toolsAllowlist: readonly string[] | null = toolsRaw
    ? toolsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const verboseFromEnv = process.env["STORAGE_NAV_AGENT_VERBOSE"] === "true";
  const verbose =
    flags.verbose !== undefined
      ? flags.verbose
      : verboseFromEnv || (cfgJson.verbose ?? false);

  const interactive = flags.interactive ?? false;

  const systemPrompt = flags.systemPrompt ?? process.env["STORAGE_NAV_AGENT_SYSTEM_PROMPT"] ?? null;
  const systemPromptFile =
    flags.systemPromptFile ??
    process.env["STORAGE_NAV_AGENT_SYSTEM_PROMPT_FILE"] ??
    cfgJson.systemPromptFile ??
    null;

  const baseUrl = flags.baseUrl ?? process.env["STORAGE_NAV_AGENT_BASE_URL"] ?? null;

  const providerEnv = captureProviderEnv(provider);

  return Object.freeze({
    provider,
    model,
    temperature,
    maxSteps,
    perToolBudgetBytes,
    systemPrompt,
    systemPromptFile,
    toolsAllowlist,
    allowMutations,
    envFilePath,
    configFilePath,
    baseUrl,
    verbose,
    interactive,
    providerEnv,
  });
}
