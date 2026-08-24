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
- **Diagnostic tracing** — raw request payloads, token usage, and system state
  are written to a persistent `bare-ai-trace.log`.
- **Sovereign web search** — routes search through a self-hosted SearXNG
  instance (`BARE_AI_SEARCH_URL`), falling back to Google Search when unset.

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

| Variable               | Purpose                                 | Default                                      |
| ---------------------- | --------------------------------------- | -------------------------------------------- |
| `BARE_AI_ENDPOINT`     | Chat completions URL                    | `http://localhost:11434/v1/chat/completions` |
| `BARE_AI_MODEL`        | Model string (e.g., `granite4:tiny-h`)  | —                                            |
| `BARE_AI_API_KEY`      | Optional bearer token                   | none                                         |
| `BARE_AI_CONSTITUTION` | Path to the system prompt markdown file | —                                            |
| `BARE_AI_LEAN_TOOLS`   | Force tool pruning on/off               | auto-detected                                |
| `DEBUG_BARE_AI`        | Verbose tracing                         | false                                        |

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
