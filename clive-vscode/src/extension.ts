import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { ChatViewProvider } from './ChatViewProvider';

const OUTPUT_CHANNEL_NAME = 'Clive';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME, { log: true });
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = 'Clive: Ready';
	statusBarItem.tooltip = 'Run Clive doctor';
	statusBarItem.command = 'clive.doctor';
	statusBarItem.show();

	context.subscriptions.push(outputChannel, statusBarItem);

	// ── Chat UI (sidebar webview) ──────────────────────────────────
	const chatProvider = new ChatViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);
	register(context, 'clive.openChat', () => {
		void vscode.commands.executeCommand('workbench.view.extension.clive-sidebar');
	});

	register(context, 'clive.showOutput', () => outputChannel.show(true));
	register(context, 'clive.chat', () => runChat());
	register(context, 'clive.session', () => runSession());
	register(context, 'clive.agent', () => runAgent());
	register(context, 'clive.models', () => runSimple(['models'], 'Clive models'));
	register(context, 'clive.doctor', () => runSimple(['doctor'], 'Clive doctor'));
	register(context, 'clive.ollamaServe', () => runInteractive(['ollama', 'serve'], 'Clive Ollama Serve'));
	register(context, 'clive.ollamaPull', () => runOllamaModelCommand('pull'));
	register(context, 'clive.ollamaRemove', () => runOllamaModelCommand('rm'));
	register(context, 'clive.ollamaRecommend', () => runRecommend());
	register(context, 'clive.editFile', () => runEditLikeCommand('edit'));
	register(context, 'clive.patchFile', () => runEditLikeCommand('patch'));
	register(context, 'clive.completions', () => runCompletions());
	register(context, 'clive.runRawCommand', () => runRawCommand());
}

export function deactivate() {
	statusBarItem?.dispose();
	outputChannel?.dispose();
}

function register(context: vscode.ExtensionContext, commandId: string, handler: () => Promise<void> | void) {
	context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
}

async function runChat() {
	const prompt = await vscode.window.showInputBox({
		prompt: 'Enter a prompt for Clive chat',
		ignoreFocusOut: true,
	});
	if (!prompt) {
		return;
	}

	const model = await pickModel();
	const system = await vscode.window.showInputBox({
		prompt: 'Optional system message',
		placeHolder: 'Leave empty to skip',
		ignoreFocusOut: true,
	});
	const noStream = await askYesNo('Disable token streaming?', false);

	const args = ['chat', prompt, ...modelArgs(model)];
	if (system) {
		args.push('--system', system);
	}
	if (noStream) {
		args.push('--no-stream');
	}

	await runSimple(args, 'Clive chat');
}

async function runSession() {
	const model = await pickModel();
	const system = await vscode.window.showInputBox({
		prompt: 'Optional system message',
		placeHolder: 'Leave empty to skip',
		ignoreFocusOut: true,
	});
	const noStream = await askYesNo('Disable token streaming?', false);
	const args = ['session', ...modelArgs(model)];
	if (system) {
		args.push('--system', system);
	}
	if (noStream) {
		args.push('--no-stream');
	}

	await runInteractive(args, 'Clive Session');
}

async function runAgent() {
	const goal = await vscode.window.showInputBox({
		prompt: 'Describe the agent goal',
		ignoreFocusOut: true,
	});
	if (!goal) {
		return;
	}

	const files = await pickFiles({ canSelectMany: true, title: 'Select files Clive may edit' });
	if (!files.length) {
		return;
	}

	const verify = await vscode.window.showInputBox({
		prompt: 'Optional verification command',
		placeHolder: 'Example: cargo check -q',
		ignoreFocusOut: true,
	});
	const apply = await askYesNo('Apply edits to disk?', false);
	const rollback = apply ? await askYesNo('Rollback on verification failure?', true) : false;
	const allowCommands = await askYesNo('Allow run_command actions?', false);
	const json = await askYesNo('Use JSON mode?', false);
	const requireCleanGit = apply ? await askYesNo('Require clean git status for target files?', false) : false;
	const profile = await vscode.window.showQuickPick(['quick', 'balanced', 'strict'], {
		placeHolder: 'Choose an agent profile',
	});
	if (!profile) {
		return;
	}
	const maxIterations = await vscode.window.showInputBox({
		prompt: 'Optional max iterations override',
		placeHolder: 'Leave empty to use the profile default',
		ignoreFocusOut: true,
	});
	const model = await pickModel();

	const args = ['agent', goal, '--files', ...files.map((file) => file.fsPath), ...modelArgs(model), '--profile', profile];
	if (verify) {
		args.push('--verify', verify);
	}
	if (apply) {
		args.push('--apply');
	}
	if (rollback) {
		args.push('--rollback-on-fail');
	}
	if (requireCleanGit) {
		args.push('--require-clean-git');
	}
	if (allowCommands) {
		args.push('--allow-agent-commands');
	}
	if (json) {
		args.push('--json');
	}
	if (maxIterations) {
		args.push('--max-iterations', maxIterations);
	}

	await runInteractive(args, 'Clive Agent');
}

async function runRecommend() {
	const profile = await vscode.window.showQuickPick(['coding', 'rust', 'fast', 'reasoning'], {
		placeHolder: 'Choose a recommendation profile',
	});
	if (!profile) {
		return;
	}

	const installedOnly = await askYesNo('Show only installed models?', false);
	const args = ['ollama', 'recommend', '--profile', profile];
	if (installedOnly) {
		args.push('--installed-only');
	}

	await runSimple(args, 'Clive recommend');
}

async function runOllamaModelCommand(subcommand: 'pull' | 'rm') {
	const model = await vscode.window.showInputBox({
		prompt: subcommand === 'pull' ? 'Model to pull' : 'Model to remove',
		ignoreFocusOut: true,
	});
	if (!model) {
		return;
	}

	await runInteractive(['ollama', subcommand, model], `Clive Ollama ${subcommand}`);
}

async function runEditLikeCommand(commandName: 'edit' | 'patch') {
	const files = await pickFiles({ canSelectMany: false, title: `Select a file to ${commandName}` });
	if (!files.length) {
		return;
	}

	const instruction = await vscode.window.showInputBox({
		prompt: `Describe the ${commandName} change`,
		ignoreFocusOut: true,
	});
	if (!instruction) {
		return;
	}

	const write = await askYesNo('Write changes to disk?', false);
	const backup = write ? await askYesNo('Create a backup copy?', false) : false;
	const stage = write ? await askYesNo('Run git add after writing?', false) : false;
	const requireCleanGit = write ? await askYesNo('Require clean git status for the file?', false) : false;
	const model = await pickModel();
	const args = [commandName, files[0].fsPath, instruction, ...modelArgs(model)];
	if (write) {
		args.push('--write');
	}
	if (backup) {
		args.push('--backup');
	}
	if (stage) {
		args.push('--stage');
	}
	if (requireCleanGit) {
		args.push('--require-clean-git');
	}

	await runInteractive(args, `Clive ${commandName}`);
}

async function runCompletions() {
	const shell = await vscode.window.showQuickPick(['bash', 'zsh', 'fish', 'powershell', 'elvish'], {
		placeHolder: 'Choose a shell',
	});
	if (!shell) {
		return;
	}

	await runSimple(['completions', shell], 'Clive completions');
}

async function runRawCommand() {
	const rawArgs = await vscode.window.showInputBox({
		prompt: 'Enter raw Clive arguments',
		placeHolder: 'Example: agent "Refactor" --files src/main.rs --apply',
		ignoreFocusOut: true,
	});
	if (!rawArgs) {
		return;
	}

	await runInteractive(splitShellWords(rawArgs), 'Clive');
}

async function runSimple(args: string[], title: string) {
	const executable = getExecutablePath();
	const commandArgs = buildCommonArgs(args);
	outputChannel.show(true);
	outputChannel.appendLine(`$ ${renderCommand(executable, commandArgs)}`);
	await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, () => {
		return new Promise<void>((resolve, reject) => {
			const child = spawn(executable, commandArgs, {
				cwd: getWorkingDirectory(),
				env: buildEnvironment(),
				shell: false,
			});

			child.stdout.on('data', (chunk: Buffer) => outputChannel.append(chunk.toString()));
			child.stderr.on('data', (chunk: Buffer) => outputChannel.append(chunk.toString()));
			child.on('error', reject);
			child.on('close', (code) => {
				if (code === 0) {
					resolve();
					return;
				}
				reject(new Error(`Clive exited with code ${code ?? 'unknown'}`));
			});
		});
	});
}

async function runInteractive(args: string[], terminalName: string) {
	const executable = getExecutablePath();
	const commandArgs = buildCommonArgs(args);
	const terminal = vscode.window.createTerminal({
		name: terminalName,
		cwd: getWorkingDirectory(),
		env: buildEnvironment(),
	});
	terminal.show(true);
	terminal.sendText(renderCommand(executable, commandArgs), true);
}

function getExecutablePath() {
	return vscode.workspace.getConfiguration('clive').get<string>('executablePath') || 'clive';
}

function getWorkingDirectory() {
	const configured = vscode.workspace.getConfiguration('clive').get<string>('terminalCwd') || 'workspaceFolder';
	if (configured === 'prompt') {
		return undefined;
	}
	const active = vscode.window.activeTextEditor?.document.uri;
	if (configured === 'file' && active) {
		return path.dirname(active.fsPath);
	}
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function buildCommonArgs(args: string[]) {
	const configuration = vscode.workspace.getConfiguration('clive');
	const combined: string[] = [];
	const ollamaUrl = configuration.get<string>('ollamaUrl');
	const defaultModel = configuration.get<string | null>('defaultModel');
	const noBanner = configuration.get<boolean>('noBanner');

	if (ollamaUrl) {
		combined.push('--ollama-url', ollamaUrl);
	}
	if (defaultModel) {
		combined.push('--model', defaultModel);
	}
	if (noBanner) {
		combined.push('--no-banner');
	}
	combined.push(...args);
	return combined;
}

function buildEnvironment() {
	const configuration = vscode.workspace.getConfiguration('clive');
	const ollamaUrl = configuration.get<string>('ollamaUrl');
	return ollamaUrl ? { OLLAMA_HOST: ollamaUrl } : undefined;
}

function modelArgs(model: string | undefined) {
	return model ? ['--model', model] : [];
}

async function pickModel() {
	const defaultModel = vscode.workspace.getConfiguration('clive').get<string | null>('defaultModel');
	if (defaultModel) {
		return defaultModel;
	}
	return vscode.window.showInputBox({
		prompt: 'Optional model override',
		placeHolder: 'Leave empty to use Clive defaults',
		ignoreFocusOut: true,
	}) ?? undefined;
}

type YesNoPick = vscode.QuickPickItem & { value: boolean };

async function askYesNo(question: string, defaultValue: boolean) {
	const choice = await vscode.window.showQuickPick<YesNoPick>([
		{ label: 'Yes', value: true },
		{ label: 'No', value: false },
	], {
		placeHolder: question,
		canPickMany: false,
	});
	return choice ? choice.value : defaultValue;
}

async function pickFiles(options: { canSelectMany: boolean; title: string }) {
	const picked = await vscode.window.showOpenDialog({
		canSelectMany: options.canSelectMany,
		openLabel: options.title,
		canSelectFolders: false,
		canSelectFiles: true,
		defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
	});
	return picked ?? [];
}

function renderCommand(executable: string, args: string[]) {
	return [shellQuote(executable), ...args.map(shellQuote)].join(' ');
}

function shellQuote(value: string) {
	if (/^[A-Za-z0-9_\-/.:=]+$/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function splitShellWords(input: string) {
	const words: string[] = [];
	let current = '';
	let quote: 'single' | 'double' | null = null;
	let escaped = false;

	for (const char of input) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === '\\' && quote !== 'single') {
			escaped = true;
			continue;
		}
		if (char === '"' && quote !== 'single') {
			quote = quote === 'double' ? null : 'double';
			continue;
		}
		if (char === '\'' && quote !== 'double') {
			quote = quote === 'single' ? null : 'single';
			continue;
		}
		if (char === ' ' && !quote) {
			if (current) {
				words.push(current);
				current = '';
			}
			continue;
		}
		current += char;
	}

	if (current) {
		words.push(current);
	}
	return words;
}
