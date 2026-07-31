use std::fs;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};

use anyhow::{Context, Result, anyhow, bail};
use clap::{ArgAction, Args, CommandFactory, Parser, Subcommand, ValueEnum};
use clap_complete::{Shell, generate};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use similar::TextDiff;

const DEFAULT_OLLAMA_URL: &str = "http://127.0.0.1:11434";
const DEFAULT_MODEL: &str = "llama3.1";

#[derive(Parser, Debug)]
#[command(
    name = "clive",
    version,
    about = "Clive: a coding assistant CLI backed by Ollama",
    long_about = "Clive is a local-first coding assistant for terminal workflows. Chat with Ollama models, run multi-turn sessions, manage models, and safely edit code.",
    arg_required_else_help = true,
    subcommand_required = true,
    propagate_version = true,
    disable_help_subcommand = true,
    infer_subcommands = true,
    next_line_help = true,
    after_help = "Examples:\n  clive ollama serve --detach\n  clive ollama pull qwen2.5-coder:latest\n  clive session --model qwen2.5-coder:latest\n  clive edit src/main.rs \"Refactor error handling\" --write --backup"
)]
struct Cli {
    /// Override Ollama base URL (default: http://127.0.0.1:11434)
    #[arg(long, global = true)]
    ollama_url: Option<String>,

    /// Default model for chat/session/edit commands
    #[arg(long, short = 'm', global = true, env = "CLIVE_MODEL")]
    model: Option<String>,

    /// Hide the Clive ASCII art banner
    #[arg(long, global = true)]
    no_banner: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Send a prompt to an Ollama model
    #[command(visible_alias = "ask")]
    Chat(ChatArgs),

    /// List local Ollama models
    #[command(visible_alias = "ls")]
    Models,

    /// Check Ollama connectivity
    #[command(visible_alias = "health")]
    Doctor,

    /// Start an interactive multi-turn coding session
    #[command(visible_alias = "repl")]
    Session(SessionArgs),

    /// Manage Ollama from Clive (serve, pull, rm)
    Ollama(OllamaArgs),

    /// Ask Clive to edit a file in-place (or preview changes)
    Edit(EditArgs),

    /// Generate a unified diff and optionally apply it
    Patch(EditArgs),

    /// Generate shell completions
    Completions(CompletionsArgs),
}

#[derive(Args, Debug)]
struct ChatArgs {
    /// Prompt to send to the model
    prompt: String,

    /// Model name (e.g. llama3.1, codellama, qwen2.5-coder)
    #[arg(short, long)]
    model: Option<String>,

    /// Optional system message to steer behavior
    #[arg(short, long)]
    system: Option<String>,

    /// Disable token streaming and wait for full response
    #[arg(long, action = ArgAction::SetTrue)]
    no_stream: bool,
}

#[derive(Args, Debug)]
struct EditArgs {
    /// Path to file you want to modify
    file: PathBuf,

    /// Edit instruction for the assistant
    instruction: String,

    /// Model name to use for editing
    #[arg(short, long)]
    model: Option<String>,

    /// Write the generated changes to disk
    #[arg(long)]
    write: bool,

    /// Create a .bak copy before writing
    #[arg(long)]
    backup: bool,

    /// Refuse to write if git sees uncommitted changes in target file
    #[arg(long)]
    require_clean_git: bool,

    /// Stage the file with git add after writing
    #[arg(long)]
    stage: bool,
}

#[derive(Args, Debug)]
struct SessionArgs {
    /// Model name (e.g. qwen2.5-coder, codellama)
    #[arg(short, long)]
    model: Option<String>,

    /// Optional system instruction
    #[arg(short, long)]
    system: Option<String>,

    /// Disable token streaming and wait for full response
    #[arg(long, action = ArgAction::SetTrue)]
    no_stream: bool,
}

#[derive(Args, Debug)]
struct OllamaArgs {
    #[command(subcommand)]
    command: OllamaCommand,
}

#[derive(Subcommand, Debug)]
enum OllamaCommand {
    /// Start Ollama server from Clive
    Serve(ServeArgs),
    /// Pull/install a model
    Pull(PullArgs),
    /// Remove an installed model
    Rm(ModelNameArg),
    /// Curated coding-model recommendations
    Recommend(RecommendArgs),
}

#[derive(Args, Debug)]
struct ServeArgs {
    /// Start in the background and return immediately
    #[arg(long)]
    detach: bool,
}

#[derive(Args, Debug)]
struct PullArgs {
    /// Model name to install (e.g. qwen2.5-coder:latest)
    model: String,
}

#[derive(Args, Debug)]
struct ModelNameArg {
    /// Model name
    model: String,
}

#[derive(Args, Debug)]
struct RecommendArgs {
    /// Recommendation profile
    #[arg(long, value_enum, default_value_t = RecommendProfile::Coding)]
    profile: RecommendProfile,

    /// Only show models that are already installed
    #[arg(long)]
    installed_only: bool,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum RecommendProfile {
    Coding,
    Rust,
    Fast,
    Reasoning,
}

#[derive(Args, Debug)]
struct CompletionsArgs {
    /// Target shell (bash, zsh, fish, powershell, elvish)
    #[arg(value_enum)]
    shell: Shell,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    stream: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    message: Message,
}

#[derive(Debug, Deserialize)]
struct StreamChatResponse {
    message: Option<Message>,
    done: bool,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Vec<ModelTag>,
}

#[derive(Debug, Deserialize)]
struct ModelTag {
    name: String,
    size: Option<u64>,
    modified_at: Option<String>,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("Error: {err:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();

    let disable_banner_for_command = matches!(cli.command, Commands::Completions(_));
    if !cli.no_banner && !disable_banner_for_command {
        print_banner();
    }

    let base_url = cli
        .ollama_url
        .or_else(|| std::env::var("OLLAMA_HOST").ok())
        .unwrap_or_else(|| DEFAULT_OLLAMA_URL.to_string());

    let ollama = OllamaClient::new(base_url)?;
    let default_model = cli.model.clone();

    match cli.command {
        Commands::Chat(args) => cmd_chat(&ollama, args, &default_model),
        Commands::Models => cmd_models(&ollama),
        Commands::Doctor => cmd_doctor(&ollama),
        Commands::Session(args) => cmd_session(&ollama, args, &default_model),
        Commands::Ollama(args) => cmd_ollama(&ollama, args),
        Commands::Edit(args) => cmd_edit(&ollama, args, false, &default_model),
        Commands::Patch(args) => cmd_edit(&ollama, args, true, &default_model),
        Commands::Completions(args) => cmd_completions(args),
    }
}

fn print_banner() {
    println!(
        r"  ____ _ _            
 / ___| (_)_   _____   
| |   | | \ \ / / _ \  
| |___| | |\ V /  __/  
 \____|_|_| \_/ \___|  
"
    );
    println!("Clive - local coding assistant on Ollama\n");
}

fn resolve_model(ollama: &OllamaClient, local: Option<String>, global: &Option<String>) -> String {
    let installed_models = ollama.installed_model_names().unwrap_or_default();
    resolve_model_name(&installed_models, local, global)
}

fn resolve_model_name(
    installed_models: &[String],
    local: Option<String>,
    global: &Option<String>,
) -> String {
    if let Some(model) = local.or_else(|| global.clone()) {
        return model;
    }

    installed_models
        .first()
        .cloned()
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

fn cmd_chat(ollama: &OllamaClient, args: ChatArgs, default_model: &Option<String>) -> Result<()> {
    let model = resolve_model(ollama, args.model, default_model);
    let mut messages = Vec::new();
    if let Some(system) = args.system {
        messages.push(Message {
            role: "system".to_string(),
            content: system,
        });
    }
    messages.push(Message {
        role: "user".to_string(),
        content: args.prompt,
    });

    if args.no_stream {
        let response = ollama.chat(&model, messages)?;
        println!("{}", response.message.content.trim());
    } else {
        let full = ollama.chat_stream(&model, messages, |chunk| {
            print!("{chunk}");
            let _ = io::stdout().flush();
        })?;
        if !full.ends_with('\n') {
            println!();
        }
    }
    Ok(())
}

fn cmd_models(ollama: &OllamaClient) -> Result<()> {
    let models = ollama.tags()?;
    if models.models.is_empty() {
        println!("No local models found. Pull one with: clive ollama pull llama3.1");
        return Ok(());
    }

    for model in models.models {
        let size = model
            .size
            .map(human_size)
            .unwrap_or_else(|| "unknown".to_string());
        let modified = model.modified_at.unwrap_or_else(|| "unknown".to_string());
        println!("{}\t{}\t{}", model.name, size, modified);
    }
    Ok(())
}

fn cmd_doctor(ollama: &OllamaClient) -> Result<()> {
    let version = ollama.version()?;
    println!("Ollama reachable at {}", ollama.base_url);
    println!("Version: {version}");
    Ok(())
}

fn cmd_session(
    ollama: &OllamaClient,
    args: SessionArgs,
    default_model: &Option<String>,
) -> Result<()> {
    let model = resolve_model(ollama, args.model, default_model);
    let mut messages = Vec::new();

    if let Some(system) = args.system {
        messages.push(Message {
            role: "system".to_string(),
            content: system,
        });
    } else {
        messages.push(Message {
            role: "system".to_string(),
            content: "You are Clive, a practical coding assistant. Prefer concise, correct answers with runnable code examples when useful.".to_string(),
        });
    }

    println!("Interactive session started with model: {model}");
    println!("Commands: /help, /clear, /exit");

    loop {
        print!("> ");
        io::stdout().flush().context("Failed to flush stdout")?;

        let mut input = String::new();
        let bytes = io::stdin()
            .read_line(&mut input)
            .context("Failed to read input")?;

        if bytes == 0 {
            println!("\nSession ended.");
            break;
        }

        let input = input.trim();
        if input.is_empty() {
            continue;
        }

        match input {
            "/exit" | "/quit" => {
                println!("Session ended.");
                break;
            }
            "/help" => {
                println!("/help  Show commands");
                println!("/clear Clear conversation context");
                println!("/exit  Exit session");
                continue;
            }
            "/clear" => {
                messages.retain(|m| m.role == "system");
                println!("Conversation context cleared.");
                continue;
            }
            _ => {}
        }

        messages.push(Message {
            role: "user".to_string(),
            content: input.to_string(),
        });

        let assistant = if args.no_stream {
            let response = ollama.chat(&model, messages.clone())?;
            let assistant = response.message.content.trim().to_string();
            println!("\n{assistant}\n");
            assistant
        } else {
            println!();
            let assistant = ollama.chat_stream(&model, messages.clone(), |chunk| {
                print!("{chunk}");
                let _ = io::stdout().flush();
            })?;
            println!("\n");
            assistant.trim().to_string()
        };

        messages.push(Message {
            role: "assistant".to_string(),
            content: assistant,
        });
    }

    Ok(())
}

fn cmd_ollama(ollama: &OllamaClient, args: OllamaArgs) -> Result<()> {
    match args.command {
        OllamaCommand::Serve(s) => cmd_ollama_serve(s),
        OllamaCommand::Pull(p) => cmd_ollama_pull(ollama, p),
        OllamaCommand::Rm(m) => cmd_ollama_rm(ollama, m),
        OllamaCommand::Recommend(r) => cmd_ollama_recommend(ollama, r),
    }
}

fn cmd_ollama_serve(args: ServeArgs) -> Result<()> {
    if args.detach {
        let child = Command::new("ollama")
            .arg("serve")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .context("Failed to launch 'ollama serve' in background")?;

        println!("Ollama started in background (pid {}).", child.id());
        println!("Use 'clive doctor' to verify it's reachable.");
        return Ok(());
    }

    println!("Starting Ollama in foreground. Press Ctrl+C to stop.");
    let status = Command::new("ollama")
        .arg("serve")
        .status()
        .context("Failed to execute 'ollama serve'")?;

    if !status.success() {
        bail!("ollama serve exited with status {status}");
    }

    Ok(())
}

fn cmd_ollama_pull(ollama: &OllamaClient, args: PullArgs) -> Result<()> {
    println!("Pulling model: {}", args.model);
    pull_model_via_cli(&args.model)?;

    println!("Model pull completed: {}", args.model);

    if let Ok(tags) = ollama.tags() {
        if let Some(model) = tags.models.into_iter().find(|m| m.name.starts_with(&args.model)) {
            let size = model.size.map(human_size).unwrap_or_else(|| "unknown".to_string());
            println!("Installed: {} ({})", model.name, size);
        }
    }

    Ok(())
}

fn pull_model_via_cli(model: &str) -> Result<()> {
    pull_model_with_runner(model, run_ollama_command)
}

fn pull_model_with_runner<F>(model: &str, runner: F) -> Result<()>
where
    F: FnOnce(&str, &[&str]) -> io::Result<ExitStatus>,
{
    let status = runner("pull", &[model]).context("Failed to execute 'ollama pull'")?;

    if !status.success() {
        bail!("ollama pull exited with status {status}");
    }

    Ok(())
}

fn run_ollama_command(command: &str, args: &[&str]) -> io::Result<ExitStatus> {
    Command::new("ollama").arg(command).args(args).status()
}

fn cmd_ollama_rm(ollama: &OllamaClient, args: ModelNameArg) -> Result<()> {
    ollama.delete(&args.model)?;
    println!("Removed model: {}", args.model);
    Ok(())
}

fn cmd_ollama_recommend(ollama: &OllamaClient, args: RecommendArgs) -> Result<()> {
    let installed_names = ollama.installed_model_names()?;
    let profile = recommendations_for_profile(args.profile);

    println!("Recommended models for profile: {:?}\n", args.profile);
    for (model, note) in profile {
        let installed = installed_names.iter().any(|name| name.starts_with(model));
        if args.installed_only && !installed {
            continue;
        }
        let state = if installed { "installed" } else { "not installed" };
        println!("- {model} [{state}]");
        println!("  {note}");
        if !installed {
            println!("  Install: clive ollama pull {model}");
        }
    }

    Ok(())
}

fn recommendations_for_profile(profile: RecommendProfile) -> Vec<(&'static str, &'static str)> {
    match profile {
        RecommendProfile::Coding => vec![
            (
                "qwen2.5-coder:latest",
                "Great default coding model with strong code synthesis and refactoring.",
            ),
            (
                "codellama:latest",
                "Solid coder with broad language support and reliable completions.",
            ),
            (
                "llama3.1:latest",
                "Generalist model useful for design discussion and code explanations.",
            ),
        ],
        RecommendProfile::Rust => vec![
            (
                "qwen2.5-coder:latest",
                "Very good at Rust refactors, traits, lifetimes, and error handling patterns.",
            ),
            (
                "codellama:latest",
                "Useful for idiomatic Rust scaffolding and incremental edits.",
            ),
            (
                "llama3.1:latest",
                "Strong for architecture review and documentation generation.",
            ),
        ],
        RecommendProfile::Fast => vec![
            (
                "llama3.1:8b",
                "Fast and capable for quick coding Q&A on local hardware.",
            ),
            (
                "qwen2.5-coder:7b",
                "Lower-latency coding model variant with good quality.",
            ),
            (
                "phi3:mini",
                "Very lightweight option for constrained machines.",
            ),
        ],
        RecommendProfile::Reasoning => vec![
            (
                "llama3.1:latest",
                "Good for complex reasoning and step-by-step design exploration.",
            ),
            (
                "qwen2.5-coder:latest",
                "Balances reasoning depth with concrete code generation.",
            ),
            (
                "mistral:latest",
                "Good alternative for planning and architectural trade-off analysis.",
            ),
        ],
    }
}

fn cmd_completions(args: CompletionsArgs) -> Result<()> {
    let mut cmd = Cli::command();
    let name = cmd.get_name().to_string();
    let mut output = Vec::new();
    generate(args.shell, &mut cmd, name, &mut output);

    if let Err(err) = io::stdout().write_all(&output) {
        if err.kind() == io::ErrorKind::BrokenPipe {
            return Ok(());
        }
        return Err(err).context("Failed writing completion script to stdout");
    }

    Ok(())
}

fn cmd_edit(
    ollama: &OllamaClient,
    args: EditArgs,
    patch_mode: bool,
    default_model: &Option<String>,
) -> Result<()> {
    if !args.file.exists() {
        bail!("File does not exist: {}", args.file.display());
    }

    if !args.file.is_file() {
        bail!("Path is not a file: {}", args.file.display());
    }

    let file_content = fs::read_to_string(&args.file)
        .with_context(|| format!("Failed to read {}", args.file.display()))?;

    let model = resolve_model(ollama, args.model, default_model);
    let prompt = build_edit_prompt(&args.file, &file_content, &args.instruction);

    let messages = vec![
        Message {
            role: "system".to_string(),
            content: "You are Clive, a careful coding assistant. Follow the requested change exactly and return only the updated file content in <updated_file>...</updated_file>.".to_string(),
        },
        Message {
            role: "user".to_string(),
            content: prompt,
        },
    ];

    let response = ollama.chat(&model, messages)?;
    let new_content = extract_updated_file(&response.message.content)?;

    if new_content == file_content {
        println!("No changes produced.");
        return Ok(());
    }

    if patch_mode {
        print_unified_diff(&args.file, &file_content, &new_content);
    } else {
        print_diff(&args.file, &file_content, &new_content);
    }

    if !args.write {
        println!("\nPreview only. Re-run with --write to apply changes.");
        return Ok(());
    }

    if args.require_clean_git {
        ensure_clean_git_for_file(&args.file)?;
    }

    if args.backup {
        let backup_path = args.file.with_extension("bak");
        fs::write(&backup_path, &file_content)
            .with_context(|| format!("Failed to write backup to {}", backup_path.display()))?;
        println!("Backup created: {}", backup_path.display());
    }

    fs::write(&args.file, new_content)
        .with_context(|| format!("Failed to write {}", args.file.display()))?;

    println!("Applied changes to {}", args.file.display());

    if args.stage {
        git_add_file(&args.file)?;
        println!("Staged {}", args.file.display());
    }

    Ok(())
}

fn build_edit_prompt(path: &Path, content: &str, instruction: &str) -> String {
    format!(
        "You must edit one file.\n\
File path: {}\n\
Instruction: {}\n\n\
Return format requirements:\n\
1) Return ONLY one XML block: <updated_file>...</updated_file>\n\
2) The block content must be the complete updated file\n\
3) Do not include markdown fences or explanations\n\n\
Current file content:\n\
<current_file>\n{}\n</current_file>",
        path.display(),
        instruction,
        content
    )
}

fn extract_updated_file(raw: &str) -> Result<String> {
    let start_tag = "<updated_file>";
    let end_tag = "</updated_file>";

    let start = raw
        .find(start_tag)
        .ok_or_else(|| anyhow!("Model response missing <updated_file> tag"))?;
    let end = raw
        .find(end_tag)
        .ok_or_else(|| anyhow!("Model response missing </updated_file> tag"))?;

    if end <= start {
        bail!("Malformed <updated_file> block");
    }

    let inner_start = start + start_tag.len();
    let updated = raw[inner_start..end].trim_matches('\n').to_string();
    Ok(updated)
}

fn print_diff(path: &Path, old: &str, new: &str) {
    println!("Proposed changes for {}", path.display());
    let diff = TextDiff::from_lines(old, new);
    for change in diff.iter_all_changes() {
        let sign = match change.tag() {
            similar::ChangeTag::Delete => "-",
            similar::ChangeTag::Insert => "+",
            similar::ChangeTag::Equal => " ",
        };
        print!("{}{}", sign, change);
    }
}

fn print_unified_diff(path: &Path, old: &str, new: &str) {
    let diff = TextDiff::from_lines(old, new);
    let rendered = diff
        .unified_diff()
        .header(
            &format!("a/{}", path.display()),
            &format!("b/{}", path.display()),
        )
        .context_radius(3)
        .to_string();
    println!("{rendered}");
}

fn ensure_clean_git_for_file(path: &Path) -> Result<()> {
    let output = Command::new("git")
        .arg("status")
        .arg("--porcelain")
        .arg("--")
        .arg(path)
        .output()
        .context("Failed to run git status")?;

    if !output.status.success() {
        bail!("git status failed; cannot enforce --require-clean-git");
    }

    let dirty = String::from_utf8_lossy(&output.stdout);
    if !dirty.trim().is_empty() {
        bail!(
            "Refusing to write because file has uncommitted git changes: {}",
            path.display()
        );
    }

    Ok(())
}

fn git_add_file(path: &Path) -> Result<()> {
    let status = Command::new("git")
        .arg("add")
        .arg(path)
        .status()
        .context("Failed to run git add")?;

    if !status.success() {
        bail!("git add failed for {}", path.display());
    }

    Ok(())
}

fn human_size(size: u64) -> String {
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut size_f = size as f64;
    let mut unit = 0usize;
    while size_f >= 1024.0 && unit < units.len() - 1 {
        size_f /= 1024.0;
        unit += 1;
    }
    format!("{size_f:.1} {}", units[unit])
}

struct OllamaClient {
    client: Client,
    base_url: String,
}

impl OllamaClient {
    fn new(base_url: String) -> Result<Self> {
        let client = Client::builder()
            .build()
            .context("Failed to initialize HTTP client")?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }

    fn chat(&self, model: &str, messages: Vec<Message>) -> Result<ChatResponse> {
        let url = format!("{}/api/chat", self.base_url);
        let req = ChatRequest {
            model: model.to_string(),
            messages,
            stream: false,
        };

        let response = self
            .client
            .post(url)
            .json(&req)
            .send()
            .context("Failed to call Ollama chat endpoint")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_else(|_| "<unreadable body>".to_string());
            bail!("Ollama chat failed: {status} - {body}");
        }

        response
            .json::<ChatResponse>()
            .context("Failed to parse Ollama chat response")
    }

    fn chat_stream<F>(&self, model: &str, messages: Vec<Message>, mut on_chunk: F) -> Result<String>
    where
        F: FnMut(&str),
    {
        let url = format!("{}/api/chat", self.base_url);
        let req = ChatRequest {
            model: model.to_string(),
            messages,
            stream: true,
        };

        let response = self
            .client
            .post(url)
            .json(&req)
            .send()
            .context("Failed to call Ollama chat endpoint")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_else(|_| "<unreadable body>".to_string());
            bail!("Ollama stream chat failed: {status} - {body}");
        }

        let mut full = String::new();
        let reader = BufReader::new(response);
        for line in reader.lines() {
            let line = line.context("Failed to read streamed Ollama response")?;
            if line.trim().is_empty() {
                continue;
            }

            let chunk: StreamChatResponse = serde_json::from_str(&line)
                .with_context(|| format!("Invalid streamed JSON chunk: {line}"))?;

            if let Some(err) = chunk.error {
                bail!("Ollama streaming error: {err}");
            }

            if let Some(msg) = chunk.message {
                if !msg.content.is_empty() {
                    on_chunk(&msg.content);
                    full.push_str(&msg.content);
                }
            }

            if chunk.done {
                break;
            }
        }

        Ok(full)
    }

    fn tags(&self) -> Result<TagsResponse> {
        let url = format!("{}/api/tags", self.base_url);
        let response = self
            .client
            .get(url)
            .send()
            .context("Failed to call Ollama tags endpoint")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_else(|_| "<unreadable body>".to_string());
            bail!("Ollama tags failed: {status} - {body}");
        }

        response
            .json::<TagsResponse>()
            .context("Failed to parse Ollama tags response")
    }

    fn installed_model_names(&self) -> Result<Vec<String>> {
        Ok(self.tags()?.models.into_iter().map(|m| m.name).collect())
    }

    fn version(&self) -> Result<String> {
        let url = format!("{}/api/version", self.base_url);
        let response = self
            .client
            .get(url)
            .send()
            .context("Failed to call Ollama version endpoint")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_else(|_| "<unreadable body>".to_string());
            bail!("Ollama version failed: {status} - {body}");
        }

        let value: serde_json::Value = response
            .json()
            .context("Failed to parse Ollama version response")?;

        let version = value
            .get("version")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("Ollama version response missing string field 'version'"))?;

        Ok(version.to_string())
    }

    fn delete(&self, model: &str) -> Result<()> {
        let url = format!("{}/api/delete", self.base_url);
        let response = self
            .client
            .delete(url)
            .json(&serde_json::json!({ "model": model }))
            .send()
            .context("Failed to call Ollama delete endpoint")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_else(|_| "<unreadable body>".to_string());
            bail!("Ollama delete failed: {status} - {body}");
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn cli_parses_ollama_recommend_aliases_and_flags() {
        let cli = Cli::try_parse_from([
            "clive",
            "--no-banner",
            "ollama",
            "recommend",
            "--profile",
            "rust",
            "--installed-only",
        ])
        .expect("cli should parse");

        assert!(cli.no_banner);

        match cli.command {
            Commands::Ollama(args) => match args.command {
                OllamaCommand::Recommend(recommend) => {
                    assert!(matches!(recommend.profile, RecommendProfile::Rust));
                    assert!(recommend.installed_only);
                }
                _ => panic!("expected recommend command"),
            },
            _ => panic!("expected ollama command"),
        }
    }

    #[test]
    fn resolve_model_name_prefers_local_global_installed_default() {
        let installed = vec!["installed-model:latest".to_string()];

        assert_eq!(
            resolve_model_name(&installed, Some("local-model".to_string()), &None),
            "local-model"
        );
        assert_eq!(
            resolve_model_name(&installed, None, &Some("global-model".to_string())),
            "global-model"
        );
        assert_eq!(
            resolve_model_name(&installed, None, &None),
            "installed-model:latest"
        );
        assert_eq!(resolve_model_name(&[], None, &None), DEFAULT_MODEL);
    }

    #[test]
    fn recommendations_are_profile_specific_and_complete() {
        let coding = recommendations_for_profile(RecommendProfile::Coding);
        let rust = recommendations_for_profile(RecommendProfile::Rust);
        let fast = recommendations_for_profile(RecommendProfile::Fast);
        let reasoning = recommendations_for_profile(RecommendProfile::Reasoning);

        assert_eq!(coding.len(), 3);
        assert_eq!(rust.len(), 3);
        assert_eq!(fast.len(), 3);
        assert_eq!(reasoning.len(), 3);
        assert!(rust.iter().any(|(name, _)| *name == "qwen2.5-coder:latest"));
    }

    #[test]
    fn extract_updated_file_reads_expected_content() {
        let raw = "noise <updated_file>fn main() {}\n</updated_file> trailing";
        let updated = extract_updated_file(raw).expect("expected updated content");
        assert_eq!(updated, "fn main() {}");
    }

    #[test]
    fn extract_updated_file_rejects_missing_tags() {
        let err = extract_updated_file("no tags here").expect_err("should fail");
        assert!(err.to_string().contains("updated_file"));
    }

    #[test]
    fn build_edit_prompt_contains_path_instruction_and_content() {
        let prompt = build_edit_prompt(Path::new("src/lib.rs"), "old content", "make it better");
        assert!(prompt.contains("src/lib.rs"));
        assert!(prompt.contains("make it better"));
        assert!(prompt.contains("old content"));
    }

    #[test]
    fn human_size_formats_common_values() {
        assert_eq!(human_size(0), "0.0 B");
        assert_eq!(human_size(1024), "1.0 KB");
        assert_eq!(human_size(1024 * 1024), "1.0 MB");
    }

    #[test]
    fn pull_model_with_runner_invokes_pull_command() {
        let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::<(String, Vec<String>)>::new()));
        let calls_clone = calls.clone();

        let result = pull_model_with_runner("qwen2.5-coder:latest", move |command, args| {
            calls_clone.lock().unwrap().push((
                command.to_string(),
                args.iter().map(|arg| arg.to_string()).collect(),
            ));
            Ok(success_status())
        });

        assert!(result.is_ok());
        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].0, "pull");
        assert_eq!(recorded[0].1, vec!["qwen2.5-coder:latest"]);
    }

    #[test]
    fn pull_model_with_runner_surfaces_non_zero_exit_status() {
        let err = pull_model_with_runner("broken-model", |_, _| Ok(failure_status()))
            .expect_err("expected failure");
        assert!(err.to_string().contains("ollama pull exited"));
    }

    #[test]
    fn ensure_clean_git_for_file_errors_out_for_non_repo_paths() {
        let dir = tempdir().expect("tempdir");
        let file_path = dir.path().join("file.txt");
        fs::write(&file_path, "hello").expect("write file");

        let result = ensure_clean_git_for_file(&file_path);
        assert!(result.is_err());
    }

    #[cfg(unix)]
    fn success_status() -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(0)
    }

    #[cfg(unix)]
    fn failure_status() -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(1 << 8)
    }

    #[cfg(windows)]
    fn success_status() -> ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        ExitStatus::from_raw(0)
    }

    #[cfg(windows)]
    fn failure_status() -> ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        ExitStatus::from_raw(1)
    }
}
