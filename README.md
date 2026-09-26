# Bare AI CLI

Bare AI CLI is a fork of the Google Gemini CLI that replaces the hardcoded cloud
dependencies with a local-first, agentic engine. It is designed for secure
datacenter and homelab environments (such as Proxmox) and routes through local
inference servers (such as Ollama). The CLI exposes a terminal interface capable
of executing shell commands, reading files, and diagnosing system state through
tool use.

---

## Architecture

Bare AI CLI intercepts the Google SDK calls in the CLI's routing layer:

1. **Intercept** — `BareAiClient` captures the prompt and the active tool
   registry.
2. **Translate** — Google `FunctionDeclarations` are converted to OpenAI tool
   schemas, with schema pruning when "Lean Mode" is active.
3. **Execute** — requests are posted to the configured `/v1/chat/completions`
   endpoint. When the model returns `tool_calls`, the client runs the
   corresponding local shell or filesystem tool and feeds the result back.
4. **Yield** — the final plain-text summary is returned to the terminal UI.

---

## Features

- **OpenAI-compatible client** — `BareAiClient` is a drop-in replacement for the
  Gemini backend and targets any `/v1/chat/completions` endpoint (Ollama, vLLM,
  LM Studio, and others).
- **Agentic loop** — the model uses tools (`run_shell_command`, `read_file`,
  `write_file`, `list_directory`) to perform tasks, recover from errors, and
  summarize results.
- **Lean Mode** — models under 8B parameters are detected automatically and tool
  schemas are pruned to avoid context-window exhaustion.
- **Constitution-driven** — agent identity and directives are loaded from a
  local markdown file (`~/.bare-ai/constitution.md`).
- **Vault / OpenBao integration** — endpoint URLs, model names, and API keys are
  injected at runtime via AppRole and are not written to shell history.
- **Diagnostic tracing** — routing metadata, native event types and debug detail
  are written to a persistent `bare-ai-trace.log`, which is overwritten at each
  session start. It does NOT contain raw request payloads or token usage: token
  counts are reported on the telemetry line in the terminal instead.
- **Sovereign web search** — routes search through a self-hosted SearXNG
  instance (`BARE_AI_SEARCH_URL`), falling back to Google Search when unset.
- **Multi-provider routing** — the provider is detected from the endpoint URL
  (Ollama, OpenAI-compatible, Google, Anthropic, DeepSeek) and provider-specific
  headers and features are applied (native Anthropic Messages API, DeepSeek
  reasoning content).
- **Model catalog / Sovereign Switchboard** — models resolve from the Council
  API catalog (`/v1/models`) and hot-swap via `/model`, so onboarding a new
  model is a catalog change, not a code change.
- **Multi-model Council** — `/council` orchestrates a cross-model debate; a
  "Composer" pass selects the models, roles, and rounds from the catalog.

---

## Installation

Prerequisites:

- **Node.js** v20.0 or higher
- **npm** v10.0 or higher

The [Bare AI Agent](https://github.com/Bare-Corporation/bare-ai-agent) installer
can build and configure the CLI automatically and is the recommended path for a
full deployment.

To build manually:

```bash
git clone https://github.com/Bare-Corporation/bare-ai-cli.git
cd bare-ai-cli
npm install
npm run build && npm run bundle
sudo npm link --force
```

`npm link --force` overwrites any legacy `gemini` binaries installed by the
original CLI.

---

## Configuration

Configuration is provided through environment variables, a `.env` file, or the
`sovereign.js` Vault/OpenBao wrapper.

| Variable                 | Purpose                                                                                                                                        | Default                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `BARE_AI_ENDPOINT`       | Chat completions URL                                                                                                                           | `http://localhost:11434/v1/chat/completions` |
| `BARE_AI_MODEL`          | Model string (e.g., `granite4:tiny-h`)                                                                                                         | —                                            |
| `BARE_AI_API_KEY`        | Optional bearer token                                                                                                                          | none                                         |
| `BARE_AI_CONTEXT_WINDOW` | Model context window in tokens                                                                                                                 | — (window unknown)                           |
| `BARE_AI_CONSTITUTION`   | Path to the system prompt markdown file                                                                                                        | —                                            |
| `BARE_AI_LEAN_TOOLS`     | Force tool pruning on/off                                                                                                                      | auto-detected                                |
| `BARE_AI_NO_TOOLS`       | Hard tool-policy override for this execution: `true` withholds tools, `false` forces them on. Set by the caller; outranks the model catalogue. | auto (by model capability)                   |
| `BARE_AI_TOOLS_OVERRIDE` | Records the caller override in force (`tools` / `no-tools`); set automatically, locked per execution.                                          | -                                            |
| `DEBUG_BARE_AI`          | Verbose tracing                                                                                                                                | false                                        |
| `BARE_AI_SEARCH_URL`     | Self-hosted SearXNG instance URL                                                                                                               | — (falls back to Google Search)              |
| `COUNCIL_API_BASE_URL`   | Council model-catalog API base URL                                                                                                             | `https://api.bare-ai.net`                    |

### Tool policy (per execution)

Whether a model may use tools is decided once per execution, in this order:

1. `--disable-tools` / `--tools` (explicit flags for this run)
2. `BARE_AI_NO_TOOLS=true|false` supplied by the caller at launch
3. the catalogue row for the model (`tool_capability`: `thinker` = no tools,
   `doer` = tools allowed)

Whichever of 1-2 applies is recorded in `BARE_AI_TOOLS_OVERRIDE` and is then
frozen for the execution: a `/model` hot-swap updates `BARE_AI_NO_TOOLS` to
match it, but can never flip it, because a swap is a routing decision and not a
new statement of caller intent. A caller that must guarantee a tool-free run
(for example a Council API pod using `--approval-mode plan`, which auto-approves
read-only tools) should pass `--disable-tools` or `BARE_AI_NO_TOOLS=true`.

Vault/OpenBao credentials:

```bash
export VAULT_ROLE_ID="your-approle-role-id"
export VAULT_SECRET_ID="your-approle-secret-id"
export VAULT_SECRET_PATH="secret/data/granite/config"
```

---

## Usage

Agentic mode:

```bash
export BARE_AI_CONSTITUTION="/home/user/.bare-ai/constitution.md"
node sovereign.js
```

Example prompts:

- "Ping 8.8.8.8 four times and report the latency."
- "Check the systemd journal for the last hour and explain why the container
  crashed."
- "Scan the subnet and list active hosts."

Headless mode (`--prompt` / `-p`), suitable for cron jobs:

```bash
node sovereign.js -p "Check disk space and CPU temperatures, then write a summary to ~/daily_report.md"
```

---

## License

Apache-2.0. This project is a derivative work of the Google Gemini CLI, modified
for local, sovereign operation.
