# OpenAI Codex CLI — Model Selection Guide

## Overview

Codex CLI is OpenAI's open-source, locally-executed coding agent. It is available via
`npm install -g @openai/codex` or `brew install --cask codex`. This document covers verified
model selection guidance sourced directly from the official OpenAI developer documentation and
the Codex CLI GitHub repository.

---

## Key Concepts

- Codex CLI uses a model that can be set globally in `~/.codex/config.toml`, scoped per project
  in `.codex/config.toml`, or overridden per session with the `--model` / `-m` flag.
- The `/model` command changes the model mid-session inside an active TUI thread.
- A separate `review_model` config key lets you pin a different model specifically for the
  `/review` workflow without changing the default session model.
- Codex works best with the models listed on its official models page, but supports any provider
  that exposes a Chat Completions or Responses API.

---

## 1. Default Model

If no model is specified in any config layer, Codex automatically selects a **recommended model**.
As of April 2026 that recommended default is **`gpt-5.4`**.

Official quote from the docs:

> "If you don't specify a model, the Codex app, CLI, or IDE Extension defaults to a recommended model."

To set an explicit default, add this line to `~/.codex/config.toml`:

```toml
model = "gpt-5.4"
```

---

## 2. Officially Supported / Recommended Models

All models below are listed on the official Codex models page
(https://developers.openai.com/codex/models) and confirmed as working with the Codex CLI,
app, and IDE extension. Models marked "Succeeded by" are still available but no longer recommended.

### Current Models (recommended)

| Model ID | CLI flag | Description |
|---|---|---|
| `gpt-5.4` | `codex -m gpt-5.4` | Flagship frontier model. Brings gpt-5.3-codex coding capability into the general-purpose frontier model. Larger context window (1M tokens), stronger reasoning, native computer use. **OpenAI's top recommendation.** |
| `gpt-5.4-mini` | `codex -m gpt-5.4-mini` | Faster, lower-cost option. Intended for lighter coding tasks and for use inside subagent workflows. |
| `gpt-5.3-codex` | `codex -m gpt-5.3-codex` | Industry-leading specialist coding model. Complex real-world software engineering. Its capabilities now also power gpt-5.4. Still available. |
| `gpt-5.3-codex-spark` | `codex -m gpt-5.3-codex-spark` | Research preview. Optimised for near-instant, real-time iteration (>1,000 tokens/sec). Text-only. Available to ChatGPT Pro subscribers only. |

### Legacy Models (available but superseded)

| Model ID | Status |
|---|---|
| `gpt-5.2-codex` | Advanced coding model; succeeded by gpt-5.3-codex |
| `gpt-5.2` | General-purpose; succeeded by gpt-5.4 |
| `gpt-5.1-codex-max` | Optimised for long-horizon agentic coding; succeeded |
| `gpt-5.1-codex` | Succeeded by gpt-5.1-codex-max |
| `gpt-5.1` | Succeeded by gpt-5.2 |
| `gpt-5-codex` | First agentic coding version of GPT-5; succeeded |
| `gpt-5` | Reasoning model; succeeded by gpt-5.1 |

---

## 3. Model Recommendations for Code Review

The Codex CLI has a first-class `/review` command in the TUI. It diffs against a base branch,
reviews uncommitted changes, reviews a specific commit, or accepts custom review instructions.

### Configuring the review model

The `review_model` config key lets you specify a dedicated model for `/review` without affecting
the default session model:

```toml
# ~/.codex/config.toml
model = "gpt-5.4-mini"          # Default for interactive sessions
review_model = "gpt-5.4"        # Heavier model for /review passes
```

### Which model to use for code review

Official guidance from the features documentation:

> "By default it uses the current session model; set `review_model` in `config.toml` to override."

Practical recommendations (derived from official model descriptions and benchmarks):

| Goal | Recommended Model | Reason |
|---|---|---|
| Most code review tasks | `gpt-5.4` | Strongest overall reasoning + coding. 1M token context covers large diffs. |
| Real-time review iteration (Pro subscribers) | `gpt-5.3-codex-spark` | Near-instant feedback during active development. |
| Cost-sensitive pipelines | `gpt-5.4-mini` | Faster and cheaper; good for straightforward reviews. |
| Specialist deep-dive on complex codebases | `gpt-5.3-codex` | Purpose-built for software engineering; still available and capable. |

OpenAI does not publish a code-review-specific benchmark for Codex CLI models. The recommendation
to use `gpt-5.4` for reviews is based on OpenAI's own positioning of it as the successor to
`gpt-5.3-codex` for all coding tasks.

---

## 4. Benchmarks and Official OpenAI Guidance

OpenAI has published the following performance data about these models:

| Metric | gpt-5.3-codex | gpt-5.4 |
|---|---|---|
| Context window | 400K tokens | 1M tokens |
| OSWorld-Verified (computer use) | 64% | 75% (surpasses 72.4% human baseline) |
| Artificial Analysis Intelligence Index | 54 | 57 |
| GDPval knowledge-work benchmark | Not measured | 83% match/exceed professionals |
| Knowledge cutoff | Aug 31, 2025 | Aug 31, 2025 |

OpenAI's stated model selection guidance from the official documentation:

> "For most tasks in Codex, start with gpt-5.4. It combines strong coding, reasoning, native
> computer use, and broader professional workflows in one model. Use gpt-5.4-mini when you want
> a faster, lower-cost option for lighter coding tasks or subagents."

---

## 5. Configuration Reference

### Precedence order (highest to lowest)

1. CLI flags and `--config` / `-c` overrides
2. Profile values (`--profile <name>`)
3. Project config: `.codex/config.toml` (trusted projects only)
4. User config: `~/.codex/config.toml`
5. System config: `/etc/codex/config.toml`
6. Built-in defaults

### Relevant config keys

```toml
# ~/.codex/config.toml

model = "gpt-5.4"                    # Default session model
review_model = "gpt-5.4"            # Model used by /review (defaults to session model)
model_reasoning_effort = "high"      # Tune reasoning depth where supported ("low"|"medium"|"high")
```

### CLI model flags

```bash
# Set model for a single session
codex --model gpt-5.4
codex -m gpt-5.4

# One-off config override without editing the file
codex -c model=gpt-5.3-codex

# Change model during an active session
/model
```

---

## 6. Using Third-Party or Local Models

Codex can connect to any provider that supports the Chat Completions or Responses APIs:

```toml
[model_provider]
name = "my-provider"
base_url = "https://my-provider.example.com/v1"
env_key = "MY_PROVIDER_API_KEY"
```

For local open-source models via Ollama:

```bash
codex --oss
```

Note: The Chat Completions API support is officially deprecated in Codex and will be removed in
a future release. The Responses API is the preferred path for custom providers.

---

## Community Context

No significant Reddit or Hacker News threads specifically comparing Codex CLI model performance
were found during research. The community discussion that does exist (SmartScope guide, DeployHQ
guide) replicates the official OpenAI guidance rather than providing independent benchmarks.
The main reported friction points are around approval prompts, sandbox network access, and
authentication — not model selection.

The Codex CLI changelog (https://developers.openai.com/codex/changelog) shows continuous active
development through March 2026, with the current stable CLI version being 0.118.0.

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| `gpt-5.4` is the current built-in default when no model is configured | HIGH — confirmed by official docs | Would change primary recommendation |
| Model names like `gpt-5.4` are the exact API identifiers to use in config | HIGH — confirmed by code examples in official docs | Incorrect model IDs would fail at runtime |
| `gpt-5.3-codex-spark` requires ChatGPT Pro subscription | HIGH — stated explicitly in docs | Otherwise available to all users |
| No code-review-specific benchmark exists from OpenAI | MEDIUM — no benchmark page was found; docs only give general guidance | A dedicated benchmark would sharpen recommendations |
| Community guidance largely mirrors official docs (no independent benchmarks found) | MEDIUM — limited search coverage | Independent benchmarks could change the review model recommendation |

---

## References

| Source | URL |
|---|---|
| Codex Models — Official Docs | https://developers.openai.com/codex/models |
| Codex CLI Features (model & review sections) | https://developers.openai.com/codex/cli/features |
| Config Basics — Official Docs | https://developers.openai.com/codex/config-basic |
| CLI Command Reference | https://developers.openai.com/codex/cli/reference |
| Codex CLI Changelog | https://developers.openai.com/codex/changelog |
| Introducing Codex — OpenAI Blog | https://openai.com/index/introducing-codex/ |
| Introducing Upgrades to Codex — OpenAI Blog | https://openai.com/index/introducing-upgrades-to-codex/ |
| Introducing GPT-5.3-Codex — OpenAI Blog | https://openai.com/index/introducing-gpt-5-3-codex/ |
| Introducing GPT-5.4 — OpenAI Blog | https://openai.com/index/introducing-gpt-5-4/ |
| Codex CLI GitHub Repository | https://github.com/openai/codex |
| GPT-5.4 vs GPT-5.3-Codex Comparison (Artificial Analysis) | https://artificialanalysis.ai/models/comparisons/gpt-5-4-vs-gpt-5-3-codex |
