# Clive (Rust CLI)

![Clive mascot](../docs/clive-mascot.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.78%2B-orange.svg)](https://www.rust-lang.org/)
[![Ollama](https://img.shields.io/badge/Ollama-Local%20LLM-black.svg)](https://ollama.com/)
[![Clap](https://img.shields.io/badge/CLI-Clap%204-blue.svg)](https://github.com/clap-rs/clap)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](../CONTRIBUTING.md)

Clive is a local coding-assistant CLI powered by Ollama models. It supports streaming chat, interactive coding sessions, model management, and file editing workflows directly from one terminal.

## Features

- ASCII art banner at startup
- Chat with local Ollama models
- Stream tokens in real time (chat and session)
- Interactive multi-turn coding sessions
- Autonomous multi-file agent workflows
- Manage Ollama from Clive (serve, pull/install, remove)
- Get curated model recommendations by profile
- List installed models and verify connectivity
- Edit source files with preview/apply flow
- Generate unified patches and optionally apply
- Optional git safety checks and auto-stage on write
- Shell completions for bash, zsh, fish, powershell, and elvish
- Non-interactive JSON reports for automation

## Prerequisites

- Rust toolchain (cargo, rustc)
- Ollama installed on your machine

You do not need a separate terminal for Ollama setup once Clive is installed.

## Install Clive Globally

From this folder:

```bash
cargo install --path .
```

Binary location is usually:

```bash
~/.cargo/bin/clive
```

## One-Terminal Onboarding (Recommended)

1) Start Ollama from Clive in background:

```bash
clive ollama serve --detach
```

2) Verify connection:

```bash
clive doctor
```

3) Install a coding model (example):

```bash
clive ollama pull qwen2.5-coder:latest
```

Clive uses the local Ollama CLI for pulls, so long model downloads stay attached to the terminal and do not time out over HTTP.

4) Confirm model is available:

```bash
clive models
```

5) Start using Clive:

```bash
clive session --model qwen2.5-coder:latest
```

6) Optional: check curated recommendations:

```bash
clive ollama recommend --profile rust
```

## Core Commands

Show help:

```bash
clive --help
```

Set a global default model for all commands:

```bash
export CLIVE_MODEL=qwen2.5-coder:latest
```

Or pass it directly:

```bash
clive -m qwen2.5-coder:latest session
```

If no model is provided, Clive auto-selects your first installed local model. If none are installed, it falls back to `llama3.1`.

Hide startup ASCII art:

```bash
clive --no-banner doctor
```

### Ollama Management from Clive

Start Ollama in foreground:

```bash
clive ollama serve
```

Start Ollama in background:

```bash
clive ollama serve --detach
```

Install a model:

```bash
clive ollama pull llama3.1
clive ollama pull qwen2.5-coder:latest
```

Recommended models by use-case profile:

```bash
clive ollama recommend --profile coding
clive ollama recommend --profile rust
clive ollama recommend --profile fast
clive ollama recommend --profile reasoning
```

Only show recommendations that are already installed:

```bash
clive ollama recommend --profile coding --installed-only
```

Remove an installed model:

```bash
clive ollama rm qwen2.5-coder:latest
```

List installed models:

```bash
clive models
```

Health check:

```bash
clive doctor
```

### Chat (Single Prompt)

```bash
clive chat "Explain Rust ownership in simple terms"
clive chat "Refactor this function" --model qwen2.5-coder:latest
```

By default, chat streams tokens as they are generated. Disable streaming:

```bash
clive chat "Summarize this module" --no-stream
```

Optional system prompt:

```bash
clive chat "Create tests for this module" --system "Be concise and production-focused"
```

### Interactive Session (Multi-Turn)

```bash
clive session --model qwen2.5-coder:latest
```

Disable streaming in session mode:

```bash
clive session --model qwen2.5-coder:latest --no-stream
```

Session commands:

- /help shows available commands
- /clear resets conversation context (keeps system instruction)
- /exit exits the session

### Agent Workflow (Phase 1, 2, 3)

Run an autonomous workflow over specific files:

```bash
clive agent "Refactor error handling and add tests" \
	--files src/main.rs \
	--verify "cargo check -q" \
	--apply
```

Key options:

- `--files` required allow-list of files Clive may edit
- `--verify` repeatable verification commands after apply
- `--apply` writes edits to disk (otherwise preview only)
- `--rollback-on-fail` restores originals if verification never passes
- `--require-clean-git` refuses writes when target files are dirty
- `--profile quick|balanced|strict` adjusts default iteration and verification behavior
- `--max-iterations` overrides profile default loop depth
- `--json` prints machine-readable run report for CI/automation
- `--allow-agent-commands` allows `run_command` actions from the model (disabled by default for safety)

Strict profile example:

```bash
clive agent "Harden CLI argument validation" \
	--files src/main.rs \
	--apply \
	--rollback-on-fail \
	--profile strict
```

Automation-friendly JSON mode:

```bash
clive --no-banner agent "Improve docs" \
	--files README.md \
	--json
```

Enable command actions when you explicitly trust the run context:

```bash
clive agent "Run formatter and fix lint issues" \
        --files src/main.rs \
        --apply \
        --allow-agent-commands \
        --verify "cargo check -q"
```
Apply changes:

```bash
clive edit src/main.rs "Add structured logging and stronger error handling" --write
```

Create backup before write:

```bash
clive edit src/main.rs "Add structured logging" --write --backup
```

Git-aware write protection:

```bash
clive edit src/main.rs "Refactor parsing logic" --write --require-clean-git
```

Auto-stage after write:

```bash
clive edit src/main.rs "Refactor parsing logic" --write --stage
```

### Patch Mode (Unified Diff)

Show unified patch instead of line-marked diff:

```bash
clive patch src/main.rs "Extract helper functions"
```

Apply patch result to file:

```bash
clive patch src/main.rs "Extract helper functions" --write
```

## Professional CLI Features (Clap)

Clive uses a polished Clap configuration with:

- command aliases (for example: ask, ls, health, repl)
- inferred subcommands
- strict help behavior when commands are missing
- global model selection via `-m` and `CLIVE_MODEL`
- typed shell completion generation

Generate shell completions:

```bash
clive completions bash > ~/.clive-complete.bash
clive completions zsh > ~/.clive-complete.zsh
clive completions fish > ~/.config/fish/completions/clive.fish
```

## Verification Before Release

Run these checks before cutting a release:

```bash
cargo fmt --check
cargo check
cargo test
```

## Ollama Host Configuration

Default:

- http://127.0.0.1:11434

Override per command:

```bash
clive --ollama-url http://127.0.0.1:11434 chat "hello"
```

Or via environment variable:

```bash
export OLLAMA_HOST=http://127.0.0.1:11434
```

## VS Code Workflow Notes

Run Clive from your project root for best relative path behavior.

When you run edit or patch with --write, Clive updates files directly and VS Code reflects changes automatically.
