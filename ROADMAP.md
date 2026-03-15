# Bare AI CLI Roadmap

Bare AI CLI is a sovereign, local-first fork of the Google Gemini CLI.
This roadmap tracks features and improvements specific to this fork.

For the upstream Gemini CLI roadmap, see:
https://github.com/orgs/google-gemini/projects/11/

---

## ✅ Completed

- **BareAiClient** — Drop-in replacement for GeminiClient, compatible with any OpenAI `/v1/chat/completions` endpoint (Ollama, vLLM, LM Studio, etc.)
- **Lean Mode** — Automatic tool schema pruning for tiny models (<4B parameters) to prevent context window exhaustion
- **Constitution Support** — Agent identity and directives loaded from `~/.bare-ai/constitution.md` at runtime
- **HashiCorp Vault Integration** — AppRole-based dynamic credential injection via `sovereign.js`
- **Persistent Trace Logging** — Raw request/response logging to `bare-ai-trace.log`, bypassing TUI
- **Sovereign Web Search** — Self-hosted SearXNG integration via `BARE_AI_SEARCH_URL`, with Google/Gemini fallback

---

## 🔄 In Progress

- **Tool Name Cleanup** — Rename `google_web_search` tool to `web_search` to reflect backend-agnostic design ([#issue](https://github.com/Cian-CloudIntCorp/bare-ai-cli/issues))

---

## 🗺️ Planned

- **Multi-node Awareness** — Allow the agent to query temperature and status from peer nodes over Tailscale
- **Vault Secret Rotation** — Automatic re-authentication when Vault tokens expire mid-session
- **SearXNG Health Check** — Graceful fallback messaging when `BARE_AI_SEARCH_URL` is unreachable
- **Model Auto-detection** — Query Ollama `/api/tags` at startup to confirm the configured model exists before launching
- **Lean Mode Tuning** — Allow `BARE_AI_MAX_TOOLS` env var to control tool count cap independently of model name matching

---

## 🐛 Known Issues

- `google_web_search` tool name is misleading when SearXNG backend is active — rename tracked above
- `NODE_TLS_REJECT_UNAUTHORIZED=0` set in `sovereign.js` for local Vault — should be replaced with proper cert pinning

---

## Contributing

This is a sovereign homelab/datacenter project. Contributions welcome.
Please open an issue before submitting a PR.
