# Plan 010 — Raw-mode TUI for `storage-nav agent --interactive`

Status: in-flight implementation
Author: agent-tui-builder
Spec: `~/.claude/agents/agent-tui-builder-spec.md`
Supersedes the line-based REPL in `src/agent/run.ts::runInteractive` for TTY sessions.

## 1. Scope

Replace the current line-based readline REPL behind `storage-nav agent --interactive`
with a raw-mode TUI that gives token-by-token streaming, multiline editing, ESC-to-abort,
slash commands, persistent memory, runtime model/provider switching, and an in-process
confirmation modal for destructive tool calls.

Non-goals:
- No PTY-based smoke tests (raw mode is hard to test in CI; we rely on unit-tested pure
  helpers for the byte-level reader and the §14.1/§14.2 regression suites from the spec).
- No persisted model override file (would conflict with Policy B / file-wins). `/model`
  and `/provider` switch only the live session.
- No monitoring session integration (the host agent currently doesn't expose
  `createMonitoringSession`; the existing structured logger is reused by routing it to
  a TUI-side log file).

## 2. Backend detection

Row 1 of `<standard_conventions>` detection table fires:
- `src/agent/graph.ts` exports `createAgentGraph` which uses `createAgent` from the
  top-level `langchain` package.
- `~/.tool-agents/storage-nav/` config layout exists (config.json + .env, Policy B).
- LangGraph `MemorySaver` checkpointer is already used by `runInteractive`.

The TUI streams via `graph.streamEvents(input, { version: "v2", signal })`. No event
translation is needed beyond mapping the three event types from spec §4.

## 3. Streaming seam (new)

`src/agent/stream.ts` is a new file that exports `streamAgentTurn()`:

```ts
export type StreamEvent =
  | { kind: "token"; text: string }
  | { kind: "tool_start"; tool: { name: string; args: unknown } }
  | { kind: "tool_end"; toolResult: { name: string; output: string } }
  | { kind: "step"; step: AgentStep }
  | { kind: "final"; finalAnswer: string }
  | { kind: "error"; errorMessage: string };

export interface StreamArgs {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  cfg: AgentConfig;
  prompt: string;
  threadId: string;
  signal?: AbortSignal;
  checkpointer?: BaseCheckpointSaver;
}

export async function* streamAgentTurn(args: StreamArgs): AsyncGenerator<StreamEvent>;
```

It builds the graph (or accepts a pre-built one — TUI keeps a single graph instance
across turns to share the MemorySaver state), then iterates
`graph.streamEvents(...)`, yielding `token`/`tool_start`/`tool_end` for each
`on_chat_model_stream` / `on_tool_start` / `on_tool_end`. The `signal` is
forwarded to `streamEvents()` so ESC aborts cleanly. Errors are yielded as
`{ kind: "error" }` and the generator terminates.

## 4. TUI mount point

`src/cli/commands/agent.ts::run()` is amended:
- If `cfg.interactive && process.stdin.isTTY`, dynamically import `src/tui/index.ts`
  and call `runTui(...)`.
- If `cfg.interactive && !process.stdin.isTTY`, fall through to existing
  `runInteractive` so CI/scripting (`agent --interactive < input.txt`) still works.
- One-shot mode (`storage-nav agent "prompt..."`) is unchanged.

## 5. File-creation matrix

All under `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/`.

| File | Owner unit | LOC est | Purpose |
|---|---|---|---|
| `src/agent/stream.ts` | streaming seam | 120 | `streamAgentTurn()` wraps `graph.streamEvents()` v2 |
| `src/tui/index.ts` | entrypoint | 350 | `runTui()`: banner, REPL loop, slash dispatcher, streaming loop, signal handlers |
| `src/tui/adapter.ts` | adapter | 90 | translates `StreamEvent` → `TuiEvent` (for spinner/header logic) |
| `src/tui/ansi.ts` | rendering | 40 | RESET/BOLD/DIM/colour constants + cursor helpers |
| `src/tui/spinner.ts` | rendering | 80 | braille spinner per spec §6 |
| `src/tui/utf8.ts` | input | 25 | `createUtf8Decoder()` wrapping `node:string_decoder` |
| `src/tui/reader.ts` | input | 480 | raw-mode multiline reader, all keybindings from spec §5 |
| `src/tui/clipboard.ts` | platform | 70 | dispatch to `pbcopy`/`xclip`/`xsel`/`clip.exe`; throws on no binary |
| `src/tui/memory.ts` | persistence | 130 | folder-based memory CRUD at `~/.tool-agents/storage-nav/memory/` |
| `src/tui/system-prompt-with-memory.ts` | persistence | 30 | append memory entries as `## Persistent memory` section |
| `src/tui/confirm-bridge.ts` | tool integration | 35 | `setTuiConfirm(fn) / getTuiConfirm()` global; consumed by `confirm.ts` |
| `src/tui/log-redirect.ts` | logging | 60 | route `AgentLogger` writes to `~/.tool-agents/storage-nav/logs/tui-<ts>.log` |
| `src/tui/slash/context.ts` | slash | 60 | `SlashContext` type carrying live mutable session state |
| `src/tui/slash/help.ts` | slash | 60 | `/help` |
| `src/tui/slash/quit.ts` | slash | 25 | `/quit`, `/exit` |
| `src/tui/slash/new.ts` | slash | 35 | `/new` — fresh thread + new MemorySaver |
| `src/tui/slash/history.ts` | slash | 50 | `/history` |
| `src/tui/slash/last.ts` | slash | 25 | `/last` |
| `src/tui/slash/copy.ts` | slash | 40 | `/copy` |
| `src/tui/slash/memory.ts` | slash | 130 | list/show/add/remove/edit |
| `src/tui/slash/model.ts` | slash | 60 | `/model <name>` — re-runs `buildModel` |
| `src/tui/slash/provider.ts` | slash | 90 | `/provider <name>` — re-loads .env, re-runs `loadAgentConfig` + `buildModel` |
| `src/tui/slash/tools.ts` | slash | 70 | `/tools` |
| `src/tui/slash/allow-mutations.ts` | slash | 60 | toggle + rebuild catalog |
| `src/tui/__tests__/utf8.spec.ts` | tests | 80 | spec §14.2 |
| `src/tui/__tests__/reader.spec.ts` | tests | 220 | spec §14.1 + §14.2 + §14.3 (mandatory) |
| `src/tui/__tests__/spinner.spec.ts` | tests | 50 | frame rotation |
| `src/tui/__tests__/memory.spec.ts` | tests | 100 | folder-based CRUD against tmp dir |
| `src/tui/__tests__/clipboard.spec.ts` | tests | 60 | platform dispatch via mocked `spawn` |
| `src/tui/__tests__/slash-parsing.spec.ts` | tests | 80 | `/model`, `/memory`, `/provider` parsing |
| `src/tui/__tests__/adapter.spec.ts` | tests | 80 | mock `streamEvents` → assert event sequence |

Modified host files (minimal):
- `src/agent/tools/confirm.ts` — call injected TUI bridge if set, else existing readline path.
- `src/cli/commands/agent.ts` — TTY-gated branch into `runTui`.
- `package.json` — add `clipboardy` dep and `agent:tui` convenience script.

## 6. Slash-command scope

All 12 from the request are in scope; `/exit` is an alias of `/quit`.

## 7. Persistence paths

| Item | Location | Mode |
|---|---|---|
| Input history | in-memory only | — |
| User memory | `~/.tool-agents/storage-nav/memory/<name>.md` | dir 0700, file 0600 |
| TUI log | `~/.tool-agents/storage-nav/logs/tui-<ts>.log` | file 0600 |
| Saved model override | NOT persisted (would conflict with Policy B / file-wins config.json). In-session only. |

`.gitignore` is unaffected (everything is under `~/.tool-agents/`, outside the repo).

## 8. Confirmation-modal strategy

`src/agent/tools/confirm.ts::confirmDestructive` is the choke point used by all 10
destructive tools. We change it to:

```ts
export async function confirmDestructive(summary: string): Promise<ConfirmResult> {
  const tuiConfirm = getTuiConfirm();
  if (tuiConfirm) return tuiConfirm(summary);
  // existing readline path unchanged
}
```

The TUI registers its modal via `setTuiConfirm()` at startup. The modal pauses the
streaming display, prints a yellow `[CONFIRM] <summary>` block, and reads y/N from
the same raw-mode stdin (a tiny one-shot reader, not a second readline). On
abort/Ctrl+C inside the modal, returns `{ confirmed: false }`.

## 9. Logger redirect

`createAgentLogger` already supports `logFilePath`. The TUI auto-generates one at
`~/.tool-agents/storage-nav/logs/tui-<ts>.log` and passes `quiet: true` so
structured INFO/WARN lines never reach stderr (and never corrupt the TUI). ERROR
events are surfaced separately as `[error]` lines in the TUI itself.

## 10. Test plan

Mandatory regression suites from spec §14 (must pass before Phase 5):
- `__tests__/reader.spec.ts` §14.1 — every escape sequence (`\x1b[A/B/C/D`, `\x1bOH`,
  `\x1b[3~`, `\x1b[1;5D`, `\x1bb`) followed by Enter resolves to `""`.
- `__tests__/reader.spec.ts` §14.2 — Greek round-trip, emoji round-trip, split
  multi-byte across chunks.
- `__tests__/reader.spec.ts` §14.3 — mixed ASCII + multi-byte + escape in one chunk.

Plus `utf8.spec.ts`, `spinner.spec.ts`, `memory.spec.ts`, `clipboard.spec.ts`,
`slash-parsing.spec.ts`, `adapter.spec.ts`. Existing 119 tests must still pass.

## 11. Documentation updates

- `CLAUDE.md` — update the existing `<storage-nav>` `agent` info block (no separate
  `<storage-nav-tui>` block) to document the TUI behaviour of `--interactive`.
- `docs/design/configuration-guide.md` — add TUI section: slash commands, memory
  folder, log file location.
- `docs/design/project-functions.md` — add `FR-AGT-TUI-1` … `FR-AGT-TUI-12`.
- `docs/design/project-design.md` — add TUI module layout diagram.
- `Issues - Pending Items.md` — register any open issues.
