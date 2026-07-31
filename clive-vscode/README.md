# Clive VS Code Extension

A Copilot-style sidebar for [Clive](../clive/README.md) — a local AI coding assistant powered by Ollama models. Chat with models, run multi-turn sessions, and launch autonomous agent workflows, all without leaving VS Code.

---

## Requirements

| Requirement | Version / notes |
|---|---|
| VS Code | 1.118 or later |
| [Ollama](https://ollama.com) | Running locally on `http://127.0.0.1:11434` |
| Clive CLI | See [installation](#installing-clive) below |

### Installing Clive

```bash
# From source (requires Rust toolchain)
cd clive/
cargo build --release
cp target/release/clive ~/.cargo/bin/

# Verify
clive --version
```

### Pulling models

```bash
ollama pull qwen2.5-coder:latest
ollama pull deepseek-coder-v2:latest
ollama pull gemma2:2b
```

---

## Features

### Sidebar (Activity Bar icon)

The extension adds a **Clive** icon to the Activity Bar. Click it to open the sidebar with three tabs:

#### Chat
- Select a model from the dropdown (auto-populated from `clive models`)
- Type a message and press **Enter** (Shift+Enter for a new line)
- Responses stream in real time with syntax-highlighted code blocks
- Each code block has **Copy** and **Insert at cursor** buttons
- The context bar shows the active editor file and whether there is a selection

#### Session
- Starts `clive session` in an **integrated terminal** for a persistent multi-turn conversation
- Optional **system prompt** field to set a persona or constraints before the session begins
- Useful commands inside the session: `/help`, `/clear`, `/exit`

#### Agent
- **Goal** — describe what you want the agent to accomplish
- **Files** — add files via the VS Code file picker; the agent edits only those files
- **Verify command** — optional shell command run after each patch to validate the change (e.g. `cargo check -q`)
- **Profile** — `balanced` (default), `quick`, or `strict`
- **Checkboxes** — Apply changes to disk / Rollback on verify failure / Allow shell commands
- Runs in an **integrated terminal** so you can watch progress and interact

### Command Palette

All Clive commands are also available via `Ctrl+Shift+P` → `Clive: …`:

| Command | Description |
|---|---|
| `Clive: Chat` | Quick one-shot chat via input box |
| `Clive: Start Session` | Open `clive session` in terminal |
| `Clive: Run Agent` | Launch agent with goal + file selection |
| `Clive: List Models` | Show available Ollama models |
| `Clive: Health Check` | Check Ollama connectivity |
| `Clive: Pull Model` | Pull a model with `ollama pull` |
| `Clive: Delete Model` | Remove a local model |
| `Clive: Show Version` | Print Clive + Ollama versions |
| `Clive: Edit File` | Run `clive edit` on the active file |
| `Clive: Generate Patch` | Run `clive patch` on the active file |
| `Clive: Run Command` | Run any arbitrary Clive arguments |

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `clive.executablePath` | `clive` | Absolute path to the Clive binary (if not on `PATH`) |
| `clive.ollamaUrl` | _(Ollama default)_ | Override the Ollama base URL |
| `clive.defaultModel` | _(first available)_ | Pre-select this model in the sidebar dropdown |
| `clive.noBanner` | `true` | Pass `--no-banner` to suppress the startup banner |
| `clive.terminalCwd` | _(workspace root)_ | Working directory for terminal-based commands |

> **PATH note (Linux / macOS):** The VS Code extension host does not inherit `~/.cargo/bin` from the shell. The extension automatically prepends `~/.cargo/bin`, `~/.local/bin`, and `/usr/local/bin` to `PATH` when spawning Clive. If Clive is installed elsewhere, set `clive.executablePath` to the full path.

---

## Development

### Setup

```bash
cd clive-vscode/
npm install
npm run compile     # type-check + lint + bundle
```

### Launch (F5)

Press **F5** from the workspace root. This runs the `Build Clive Extension` task and opens an **Extension Development Host** window with the extension loaded.

> The `.vscode/launch.json` and `.vscode/tasks.json` at the **repository root** configure this — VS Code ignores these files when they are inside `clive-vscode/`.

### Tests

```bash
npm run test        # runs tests inside a headless VS Code instance
```

### Build scripts

| Script | What it does |
|---|---|
| `npm run compile` | Type-check + lint + esbuild bundle (watch mode) |
| `npm run check-types` | `tsc --noEmit` only |
| `npm run lint` | ESLint on `src/` |
| `npm run package` | Production bundle (`NODE_ENV=production`) |
| `npm run test` | Extension-host test runner |

---

## Troubleshooting

**Sidebar shows "Error loading models"**
- Confirm Ollama is running: `ollama list`
- Confirm Clive is reachable: `clive models` in a terminal
- Check `clive.executablePath` in settings if the binary is not on `PATH`

**Chat hangs / never responds**
- Large models (e.g. `deepseek-coder-v2`) can take 30–60 s for the first token on CPU — this is normal
- The Clive HTTP client has no timeout for chat requests so it will always eventually respond

**Agent makes no changes**
- Ensure "Apply changes to disk" is checked in the Agent tab
- Check the terminal output for verify-command failures (enable rollback to auto-revert)
