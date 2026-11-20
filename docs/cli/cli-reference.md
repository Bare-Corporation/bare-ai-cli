# Bare AI CLI cheatsheet

This page provides a reference for commonly used Bare AI CLI commands, options,
and parameters.

## CLI commands

| Command                          | Description                        | Example                                                      |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| `bare`                           | Start interactive REPL             | `bare`                                                       |
| `bare -p "query"`                | Query non-interactively            | `bare -p "summarize README.md"`                              |
| `bare "query"`                   | Query and continue interactively   | `bare "explain this project"`                                |
| `cat file \| gemini`             | Process piped content              | `cat logs.txt \| gemini`<br>`Get-Content logs.txt \| gemini` |
| `bare -i "query"`                | Execute and continue interactively | `bare -i "What is the purpose of this project?"`             |
| `bare -r "latest"`               | Continue most recent session       | `bare -r "latest"`                                           |
| `bare -r "latest" "query"`       | Continue session with a new prompt | `bare -r "latest" "Check for type errors"`                   |
| `bare -r "<session-id>" "query"` | Resume session by ID               | `bare -r "abc123" "Finish this PR"`                          |
| `bare update`                    | Update to latest version           | `bare update`                                                |
| `bare extensions`                | Manage extensions                  | See [Extensions Management](#extensions-management)          |
| `bare mcp`                       | Configure MCP servers              | See [MCP Server Management](#mcp-server-management)          |

### Positional arguments

| Argument | Type              | Description                                                                                                |
| -------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `query`  | string (variadic) | Positional prompt. Defaults to interactive mode in a TTY. Use `-p/--prompt` for non-interactive execution. |

## Interactive commands

These commands are available within the interactive REPL.

| Command              | Description                               |
| -------------------- | ----------------------------------------- |
| `/skills reload`     | Reload discovered skills from disk        |
| `/agents reload`     | Reload the agent registry                 |
| `/commands reload`   | Reload custom slash commands              |
| `/memory reload`     | Reload context files (e.g., `BARE_AI.md`) |
| `/mcp reload`        | Restart and reload MCP servers            |
| `/extensions reload` | Reload all active extensions              |
| `/help`              | Show help for all commands                |
| `/quit`              | Exit the interactive session              |

## CLI Options

| Option                           | Alias | Type    | Default   | Description                                                                                                                                                            |
| -------------------------------- | ----- | ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--debug`                        | `-d`  | boolean | `false`   | Run in debug mode with verbose logging                                                                                                                                 |
| `--version`                      | `-v`  | -       | -         | Show CLI version number and exit                                                                                                                                       |
| `--help`                         | `-h`  | -       | -         | Show help information                                                                                                                                                  |
| `--model`                        | `-m`  | string  | `auto`    | Model to use. See [Model Selection](#model-selection) for available values.                                                                                            |
| `--prompt`                       | `-p`  | string  | -         | Prompt text. Appended to stdin input if provided. Forces non-interactive mode.                                                                                         |
| `--prompt-interactive`           | `-i`  | string  | -         | Execute prompt and continue in interactive mode                                                                                                                        |
| `--worktree`                     | `-w`  | string  | -         | Start Gemini in a new git worktree. If no name is provided, one is generated automatically. Requires `experimental.worktrees: true` in settings.                       |
| `--sandbox`                      | `-s`  | boolean | `false`   | Run in a sandboxed environment for safer execution                                                                                                                     |
| `--skip-trust`                   | -     | boolean | `false`   | Trust the current workspace for this session, skipping the folder trust check.                                                                                         |
| `--approval-mode`                | -     | string  | `default` | Approval mode for tool execution. Choices: `default`, `auto_edit`, `yolo`, `plan`                                                                                      |
| `--yolo`                         | `-y`  | boolean | `false`   | **Deprecated.** Auto-approve all actions. Use `--approval-mode=yolo` instead.                                                                                          |
| `--experimental-acp`             | -     | boolean | -         | Start in ACP (Agent Code Pilot) mode. **Experimental feature.**                                                                                                        |
| `--experimental-zed-integration` | -     | boolean | -         | Run in Zed editor integration mode. **Experimental feature.**                                                                                                          |
| `--allowed-mcp-server-names`     | -     | array   | -         | Allowed MCP server names (comma-separated or multiple flags)                                                                                                           |
| `--allowed-tools`                | -     | array   | -         | **Deprecated.** Use the [Policy Engine](../reference/policy-engine.md) instead. Tools that are allowed to run without confirmation (comma-separated or multiple flags) |
| `--extensions`                   | `-e`  | array   | -         | List of extensions to use. If not provided, all extensions are enabled (comma-separated or multiple flags)                                                             |
| `--list-extensions`              | `-l`  | boolean | -         | List all available extensions and exit                                                                                                                                 |
| `--resume`                       | `-r`  | string  | -         | Resume a previous session. Use `"latest"` for most recent or index number (e.g. `--resume 5`)                                                                          |
| `--list-sessions`                | -     | boolean | -         | List available sessions for the current project and exit                                                                                                               |
| `--delete-session`               | -     | string  | -         | Delete a session by index number (use `--list-sessions` to see available sessions)                                                                                     |
| `--include-directories`          | -     | array   | -         | Additional directories to include in the workspace (comma-separated or multiple flags)                                                                                 |
| `--screen-reader`                | -     | boolean | -         | Enable screen reader mode for accessibility                                                                                                                            |
| `--output-format`                | `-o`  | string  | `text`    | The format of the CLI output. Choices: `text`, `json`, `stream-json`                                                                                                   |

## Model selection

The `--model` (or `-m`) flag lets you specify which Gemini model to use. You can
use either model aliases (user-friendly names) or concrete model names.

### Model aliases

These are convenient shortcuts that map to specific models:

| Alias        | Resolves To                                | Description                                                                                                               |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `auto`       | `gemini-2.5-pro` or `gemini-3-pro-preview` | **Default.** Resolves to the preview model if preview features are enabled, otherwise resolves to the standard pro model. |
| `pro`        | `gemini-2.5-pro` or `gemini-3-pro-preview` | For complex reasoning tasks. Uses preview model if enabled.                                                               |
| `flash`      | `gemini-2.5-flash`                         | Fast, balanced model for most tasks.                                                                                      |
| `flash-lite` | `gemini-2.5-flash-lite`                    | Fastest model for simple tasks.                                                                                           |

## Extensions management

| Command                                          | Description                                  | Example                                                                      |
| ------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------- |
| `bare extensions install <source>`               | Install extension from Git URL or local path | `bare extensions install https://github.com/user/my-extension`               |
| `bare extensions install <source> --ref <ref>`   | Install from specific branch/tag/commit      | `bare extensions install https://github.com/user/my-extension --ref develop` |
| `bare extensions install <source> --auto-update` | Install with auto-update enabled             | `bare extensions install https://github.com/user/my-extension --auto-update` |
| `bare extensions uninstall <name>`               | Uninstall one or more extensions             | `bare extensions uninstall my-extension`                                     |
| `bare extensions list`                           | List all installed extensions                | `bare extensions list`                                                       |
| `bare extensions update <name>`                  | Update a specific extension                  | `bare extensions update my-extension`                                        |
| `bare extensions update --all`                   | Update all extensions                        | `bare extensions update --all`                                               |
| `bare extensions enable <name>`                  | Enable an extension                          | `bare extensions enable my-extension`                                        |
| `bare extensions disable <name>`                 | Disable an extension                         | `bare extensions disable my-extension`                                       |
| `bare extensions link <path>`                    | Link local extension for development         | `bare extensions link /path/to/extension`                                    |
| `bare extensions new <path>`                     | Create new extension from template           | `bare extensions new ./my-extension`                                         |
| `bare extensions validate <path>`                | Validate extension structure                 | `bare extensions validate ./my-extension`                                    |

See [Extensions Documentation](../extensions/index.md) for more details.

## MCP server management

| Command                                                     | Description                     | Example                                                                                            |
| ----------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `bare mcp add <name> <command>`                             | Add stdio-based MCP server      | `bare mcp add github npx -y @modelcontextprotocol/server-github`                                   |
| `bare mcp add <name> <url> --transport http`                | Add HTTP-based MCP server       | `bare mcp add api-server http://localhost:3000 --transport http`                                   |
| `bare mcp add <name> <command> --env KEY=value`             | Add with environment variables  | `bare mcp add slack node server.js --env SLACK_TOKEN=xoxb-xxx`                                     |
| `bare mcp add <name> <command> --scope user`                | Add with user scope             | `bare mcp add db node db-server.js --scope user`                                                   |
| `bare mcp add <name> <command> --include-tools tool1,tool2` | Add with specific tools         | `bare mcp add github npx -y @modelcontextprotocol/server-github --include-tools list_repos,get_pr` |
| `bare mcp remove <name>`                                    | Remove an MCP server            | `bare mcp remove github`                                                                           |
| `bare mcp list`                                             | List all configured MCP servers | `bare mcp list`                                                                                    |

See [MCP Server Integration](../tools/mcp-server.md) for more details.

## Skills management

| Command                        | Description                           | Example                                         |
| ------------------------------ | ------------------------------------- | ----------------------------------------------- |
| `bare skills list`             | List all discovered agent skills      | `bare skills list`                              |
| `bare skills install <source>` | Install skill from Git, path, or file | `bare skills install https://github.com/u/repo` |
| `bare skills link <path>`      | Link local agent skills via symlink   | `bare skills link /path/to/my-skills`           |
| `bare skills uninstall <name>` | Uninstall an agent skill              | `bare skills uninstall my-skill`                |
| `bare skills enable <name>`    | Enable an agent skill                 | `bare skills enable my-skill`                   |
| `bare skills disable <name>`   | Disable an agent skill                | `bare skills disable my-skill`                  |
| `bare skills enable --all`     | Enable all skills                     | `bare skills enable --all`                      |
| `bare skills disable --all`    | Disable all skills                    | `bare skills disable --all`                     |

See [Agent Skills Documentation](./skills.md) for more details.
