import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as os from 'node:os';

interface InMsg {
    type: string;
    text?: string;
    model?: string;
    goal?: string;
    files?: string[];
    verify?: string;
    profile?: string;
    apply?: boolean;
    allowCommands?: boolean;
    rollback?: boolean;
    systemPrompt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'clive.chatView';
    private _view?: vscode.WebviewView;
    private _busy = false;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = buildHtml(crypto.randomBytes(16).toString('hex'));

        webviewView.webview.onDidReceiveMessage(async (msg: InMsg) => {
            switch (msg.type) {
                case 'ready':
                case 'refreshModels':
                    await this._loadModels();
                    await this._pushContext();
                    break;
                case 'chat':
                    await this._runChat(msg.text!, msg.model ?? '');
                    break;
                case 'openSession':
                    this._openSession(msg.model ?? '', msg.systemPrompt);
                    break;
                case 'runAgent':
                    this._openAgent(msg);
                    break;
                case 'pickFiles':
                    await this._pickFiles();
                    break;
                case 'copyText':
                    if (msg.text) {
                        await vscode.env.clipboard.writeText(msg.text);
                        vscode.window.showInformationMessage('Copied to clipboard');
                    }
                    break;
                case 'insertText':
                    if (msg.text) { await this._insertAtCursor(msg.text); }
                    break;
            }
        });

        vscode.window.onDidChangeActiveTextEditor(() => this._pushContext());
    }

    // ── Chat (streaming in webview) ──────────────────────────────────────────

    private async _runChat(text: string, model: string) {
        if (this._busy) { return; }
        this._busy = true;

        const { exe, env, cwd } = this._cfg();
        const args: string[] = ['--no-banner'];
        if (model) { args.push('--model', model); }
        args.push('chat', text);

        const child = spawn(exe, args, { cwd, env, shell: false });

        child.stdout.on('data', (b: Buffer) => {
            this._post({ type: 'token', token: b.toString() });
        });
        child.stderr.on('data', (b: Buffer) => {
            const s = b.toString().trim();
            if (s) { this._post({ type: 'token', token: s }); }
        });
        child.on('error', (err) => {
            this._post({
                type: 'chatError',
                message:
                    'Cannot run clive: ' + err.message +
                    '\n\nMake sure clive is installed:\n  cargo install clive\n\n' +
                    'Or set clive.executablePath in VS Code Settings.',
            });
            this._busy = false;
        });
        child.on('close', () => {
            this._post({ type: 'chatDone' });
            this._busy = false;
        });
    }

    // ── Session (opens integrated terminal) ─────────────────────────────────

    private _openSession(model: string, systemPrompt?: string) {
        const { exe, cwd } = this._cfg();
        const args: string[] = ['--no-banner'];
        if (model) { args.push('--model', model); }
        if (systemPrompt?.trim()) { args.push('--system', systemPrompt.trim()); }
        args.push('session');
        const t = vscode.window.createTerminal({ name: 'Clive Session', cwd });
        t.show();
        t.sendText(buildCmd(exe, args));
    }

    // ── Agent (opens integrated terminal) ───────────────────────────────────

    private _openAgent(msg: InMsg) {
        if (!msg.goal?.trim()) {
            vscode.window.showWarningMessage('Enter an agent goal first.');
            return;
        }
        if (!msg.files?.length) {
            vscode.window.showWarningMessage('Select at least one file for the agent to edit.');
            return;
        }
        const { exe, cwd } = this._cfg();
        const args: string[] = ['--no-banner', 'agent', msg.goal];
        if (msg.model) { args.push('--model', msg.model); }
        args.push('--files', ...msg.files);
        if (msg.verify?.trim()) { args.push('--verify', msg.verify.trim()); }
        if (msg.profile) { args.push('--profile', msg.profile); }
        if (msg.apply) { args.push('--apply'); }
        if (msg.rollback) { args.push('--rollback-on-fail'); }
        if (msg.allowCommands) { args.push('--allow-agent-commands'); }
        const t = vscode.window.createTerminal({ name: 'Clive Agent', cwd });
        t.show();
        t.sendText(buildCmd(exe, args));
    }

    // ── File picker ──────────────────────────────────────────────────────────

    private async _pickFiles() {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            title: 'Select files for Clive Agent',
        });
        if (uris?.length) {
            this._post({ type: 'filesAdded', files: uris.map(u => u.fsPath) });
        }
    }

    // ── Model loading ────────────────────────────────────────────────────────

    private async _loadModels() {
        const { exe, env, cwd } = this._cfg();
        let out = '';
        let errOut = '';
        const child = spawn(exe, ['--no-banner', 'models'], { cwd, env, shell: false });
        child.stdout.on('data', (b: Buffer) => (out += b.toString()));
        child.stderr.on('data', (b: Buffer) => (errOut += b.toString()));
        child.on('error', (err) => {
            this._post({ type: 'modelsError', message: 'Cannot run clive: ' + err.message });
        });
        child.on('close', () => {
            // Lines look like:  "qwen2.5-coder:latest    4.4 GB  2026-07-31T..."
            // Model names always have the format  name:tag  so filter by ':'
            const models = out
                .split('\n')
                .map((l) => l.split(/\s{2,}|\t/)[0].trim())
                .filter((l) => l.includes(':') && !l.startsWith('http'));
            const def =
                vscode.workspace.getConfiguration('clive').get<string | null>('defaultModel') ||
                models[0] ||
                '';
            this._post({ type: 'models', models, defaultModel: def });
            if (!models.length && errOut.trim()) {
                this._post({ type: 'modelsError', message: errOut.trim() });
            }
        });
    }

    // ── Editor context ───────────────────────────────────────────────────────

    private async _pushContext() {
        const ed = vscode.window.activeTextEditor;
        if (!ed) {
            this._post({ type: 'context', file: null, fileName: null });
            return;
        }
        this._post({
            type: 'context',
            file: ed.document.uri.fsPath,
            fileName: path.basename(ed.document.uri.fsPath),
            sel: ed.selection.isEmpty ? null : ed.document.getText(ed.selection),
        });
    }

    private async _insertAtCursor(text: string) {
        const ed = vscode.window.activeTextEditor;
        if (!ed) { vscode.window.showWarningMessage('Open a file first to insert code.'); return; }
        await ed.edit((b) => b.replace(ed.selection, text));
    }

    // ── Config ───────────────────────────────────────────────────────────────

    private _cfg() {
        const cfg = vscode.workspace.getConfiguration('clive');
        const exe = cfg.get<string>('executablePath') || 'clive';
        const ollamaUrl = cfg.get<string>('ollamaUrl') || '';
        const home = process.env.HOME ?? os.homedir();
        // Extension host strips PATH — prepend common Rust/local install dirs
        const PATH = [
            path.join(home, '.cargo', 'bin'),
            path.join(home, '.local', 'bin'),
            '/usr/local/bin',
            process.env.PATH ?? '/usr/bin:/bin',
        ].join(':');
        return {
            exe,
            env: { ...process.env, PATH, ...(ollamaUrl ? { OLLAMA_HOST: ollamaUrl } : {}) },
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        };
    }

    private _post(msg: unknown) {
        this._view?.webview.postMessage(msg);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildCmd(exe: string, args: string[]): string {
    return [exe, ...args].map(shellQuote).join(' ');
}

function shellQuote(s: string): string {
    return /^[a-zA-Z0-9\-_./:=,]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'";
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML builder
// CSS and HTML use template literals (safe: no backticks or ${} in either).
// JS uses a string array join — completely avoids backtick escaping issues.
// ─────────────────────────────────────────────────────────────────────────────

function buildHtml(nonce: string): string {
    return (
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
        '<meta charset="UTF-8">\n' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
        'style-src \'nonce-' + nonce + '\' \'unsafe-inline\'; ' +
        'script-src \'nonce-' + nonce + '\';">\n' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
        '<title>Clive</title>\n' +
        '<style nonce="' + nonce + '">\n' + CSS + '\n</style>\n' +
        '</head>\n<body>\n' + HTML_BODY + '\n' +
        '<script nonce="' + nonce + '">\n' + JS + '\n</script>\n' +
        '</body>\n</html>'
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS  (no backticks in CSS — template literal is safe here)
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:var(--vscode-sideBar-background,#1e1e1e);
  --bg2:var(--vscode-editor-background,#252526);
  --fg:var(--vscode-sideBar-foreground,#ccc);
  --fg2:var(--vscode-descriptionForeground,#888);
  --bdr:var(--vscode-panel-border,#3c3c3c);
  --btn:var(--vscode-button-background,#0e639c);
  --btnfg:var(--vscode-button-foreground,#fff);
  --btnhov:var(--vscode-button-hoverBackground,#1177bb);
  --inp:var(--vscode-input-background,#3c3c3c);
  --inpfg:var(--vscode-input-foreground,#ccc);
  --inpbdr:var(--vscode-input-border,#555);
  --focus:var(--vscode-focusBorder,#007fd4);
  --ubg:var(--vscode-list-activeSelectionBackground,#094771);
  --ufg:var(--vscode-list-activeSelectionForeground,#fff);
  --code:var(--vscode-textCodeBlock-background,#1a1a1a);
  --err:var(--vscode-editorError-foreground,#f48771);
  --ok:#4ec9b0;--r:4px;
}
html,body{height:100%;background:var(--bg);color:var(--fg);
  font-family:var(--vscode-font-family,system-ui,sans-serif);font-size:13px;line-height:1.5}
.app{display:flex;flex-direction:column;height:100vh;overflow:hidden}
.hdr{display:flex;align-items:center;gap:6px;padding:6px 8px;
  border-bottom:1px solid var(--bdr);flex-shrink:0}
.hdr-title{font-weight:700;font-size:11px;color:var(--fg2);
  text-transform:uppercase;letter-spacing:.08em;flex-shrink:0}
select.model-sel{background:var(--inp);color:var(--inpfg);
  border:1px solid var(--inpbdr);border-radius:var(--r);
  padding:3px 5px;font-size:11px;cursor:pointer;flex:1;min-width:0}
select.model-sel:focus{outline:1px solid var(--focus)}
.icon-btn{background:transparent;border:1px solid var(--bdr);color:var(--fg2);
  border-radius:var(--r);padding:2px 7px;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0}
.icon-btn:hover{background:var(--inp);color:var(--fg)}
.tabs{display:flex;border-bottom:1px solid var(--bdr);flex-shrink:0}
.tab{flex:1;background:transparent;border:none;border-bottom:2px solid transparent;
  color:var(--fg2);cursor:pointer;padding:7px 4px;font-size:12px;font-weight:500;transition:color .1s}
.tab:hover{color:var(--fg)}
.tab.active{color:var(--fg);border-bottom-color:var(--btn)}
.panels{flex:1;overflow:hidden}
.panel{display:none;flex-direction:column;height:100%}
.panel.active{display:flex}
.ctx{display:none;align-items:center;gap:5px;padding:3px 8px;
  border-bottom:1px solid var(--bdr);font-size:11px;color:var(--fg2);flex-shrink:0}
.ctx.on{display:flex}
.ctx-tag{background:var(--inp);border-radius:3px;padding:1px 5px;font-size:10px}
.msgs{flex:1;overflow-y:auto;padding:10px 8px;display:flex;flex-direction:column;gap:10px}
.msgs::-webkit-scrollbar{width:5px}
.msgs::-webkit-scrollbar-thumb{background:var(--bdr);border-radius:3px}
.msg{display:flex;flex-direction:column;gap:2px;animation:fi .15s ease}
@keyframes fi{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.msg-label{font-size:10px;color:var(--fg2);padding:0 2px}
.msg.user .msg-label{text-align:right}
.bubble{padding:7px 10px;border-radius:var(--r);word-break:break-word;
  max-width:100%;font-size:13px;line-height:1.6}
.msg.user .bubble{background:var(--ubg);color:var(--ufg)}
.msg.ai .bubble{background:var(--bg2);border:1px solid var(--bdr)}
.msg.err .bubble{background:transparent;border:1px solid var(--err);
  color:var(--err);font-size:12px;white-space:pre-wrap}
.bubble pre{background:var(--code);border:1px solid var(--bdr);
  border-radius:var(--r);padding:8px 10px;margin:5px 0;overflow-x:auto}
.bubble pre code{font-family:var(--vscode-editor-font-family,monospace);font-size:12px}
.bubble code{font-family:var(--vscode-editor-font-family,monospace);
  font-size:12px;background:var(--code);border:1px solid var(--bdr);
  border-radius:3px;padding:0 3px}
.code-btns{display:flex;gap:4px;margin:2px 0 4px}
.code-btn{background:var(--inp);border:1px solid var(--bdr);color:var(--fg2);
  border-radius:3px;padding:2px 7px;cursor:pointer;font-size:10px}
.code-btn:hover{color:var(--fg)}
.cur{display:inline-block;width:2px;height:1em;background:var(--fg);
  vertical-align:text-bottom;margin-left:1px;animation:bl .8s step-end infinite}
@keyframes bl{50%{opacity:0}}
.inp-area{display:flex;align-items:flex-end;gap:6px;padding:8px;
  border-top:1px solid var(--bdr);flex-shrink:0}
textarea{background:var(--inp);color:var(--inpfg);border:1px solid var(--inpbdr);
  border-radius:var(--r);padding:6px 8px;font-family:inherit;font-size:13px;
  resize:none;min-height:34px;max-height:120px;overflow-y:auto;flex:1}
textarea:focus{outline:1px solid var(--focus);border-color:var(--focus)}
textarea::placeholder{color:var(--fg2)}
textarea:disabled{opacity:.5;cursor:not-allowed}
.send-btn{background:var(--btn);color:var(--btnfg);border:none;
  border-radius:var(--r);width:30px;height:30px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;flex-shrink:0}
.send-btn:hover:not(:disabled){background:var(--btnhov)}
.send-btn:disabled{opacity:.4;cursor:not-allowed}
.scrl{overflow-y:auto;flex:1;padding:10px 8px;display:flex;flex-direction:column;gap:8px}
.info-card{background:var(--bg2);border:1px solid var(--bdr);
  border-radius:var(--r);padding:10px 12px}
.info-card h3{font-size:12px;margin-bottom:5px}
.info-card p{font-size:11px;color:var(--fg2);line-height:1.7}
.info-card code{font-family:var(--vscode-editor-font-family,monospace);
  background:var(--code);border-radius:2px;padding:0 3px;font-size:11px}
.form-row{display:flex;flex-direction:column;gap:3px}
.lbl{font-size:11px;color:var(--fg2)}
input[type="text"]{background:var(--inp);color:var(--inpfg);
  border:1px solid var(--inpbdr);border-radius:var(--r);
  padding:5px 8px;font-size:12px;font-family:inherit;width:100%}
input[type="text"]:focus{outline:1px solid var(--focus);border-color:var(--focus)}
textarea.goal-ta{resize:vertical;min-height:56px;max-height:160px;
  font-size:12px;flex:none;width:100%}
.btn-primary{background:var(--btn);color:var(--btnfg);border:none;
  border-radius:var(--r);padding:8px;cursor:pointer;font-size:12px;
  font-weight:500;width:100%}
.btn-primary:hover{background:var(--btnhov)}
.btn-secondary{background:transparent;border:1px solid var(--bdr);
  color:var(--fg2);border-radius:var(--r);padding:6px;cursor:pointer;
  font-size:12px;width:100%}
.btn-secondary:hover{background:var(--inp);color:var(--fg)}
.files-area{display:flex;flex-direction:column;gap:4px}
.files-list{display:flex;flex-direction:column;gap:2px;max-height:90px;overflow-y:auto}
.file-row{display:flex;align-items:center;gap:4px;background:var(--inp);
  border-radius:3px;padding:3px 6px}
.file-row span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;font-family:var(--vscode-editor-font-family,monospace);color:var(--fg2)}
.file-del{background:none;border:none;color:var(--fg2);cursor:pointer;
  font-size:14px;padding:0 2px;line-height:1;flex-shrink:0}
.file-del:hover{color:var(--err)}
.no-files{color:var(--fg2);font-size:11px;font-style:italic;padding:2px 0;display:block}
.chk-row{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}
input[type="checkbox"]{cursor:pointer;flex-shrink:0}
select.profile-sel{background:var(--inp);color:var(--inpfg);
  border:1px solid var(--inpbdr);border-radius:var(--r);
  padding:5px 6px;font-size:12px;width:100%}
.welcome{display:flex;flex-direction:column;align-items:center;
  padding:32px 12px;gap:6px;text-align:center;color:var(--fg2)}
.welcome-icon{font-size:32px;margin-bottom:4px}
.welcome p{font-size:12px}
`;

// ─────────────────────────────────────────────────────────────────────────────
// HTML body  (no backticks in HTML — template literal is safe here)
// ─────────────────────────────────────────────────────────────────────────────

const HTML_BODY = `
<div class="app">
  <div class="hdr">
    <span class="hdr-title">Clive</span>
    <select class="model-sel" id="modelSel"><option value="">Loading&#8230;</option></select>
    <button class="icon-btn" id="refreshBtn" title="Refresh model list">&#8635;</button>
  </div>
  <div class="tabs">
    <button class="tab active" id="tab-chat">Chat</button>
    <button class="tab" id="tab-session">Session</button>
    <button class="tab" id="tab-agent">Agent</button>
  </div>
  <div class="ctx" id="ctx">
    <span>Context:</span>
    <span class="ctx-tag" id="ctxFile"></span>
    <span class="ctx-tag" id="ctxSel" style="display:none">selection</span>
  </div>
  <div class="panels">

    <!-- Chat -->
    <div class="panel active" id="pnl-chat">
      <div class="msgs" id="msgs">
        <div class="welcome" id="welcome">
          <div class="welcome-icon">&#9889;</div>
          <p><strong>Clive</strong> &mdash; local AI coding assistant</p>
          <p>Pick a model above and start asking</p>
        </div>
      </div>
      <div class="inp-area">
        <textarea id="chatInput"
          placeholder="Ask Clive&#8230;  (Enter sends  &middot;  Shift+Enter new line)"
          rows="1"></textarea>
        <button class="send-btn" id="sendBtn" title="Send (Enter)">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M8 2L8 14M2 8L8 2L14 8" stroke="currentColor"
                  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Session -->
    <div class="panel" id="pnl-session">
      <div class="scrl">
        <div class="info-card">
          <h3>Multi-turn Session</h3>
          <p>Starts <code>clive session</code> in an integrated terminal.
             The model remembers the full conversation history.<br><br>
             Commands: <code>/help</code> &nbsp;<code>/clear</code> &nbsp;<code>/exit</code></p>
        </div>
        <div class="form-row">
          <label class="lbl" for="sysPrompt">System prompt (optional)</label>
          <input type="text" id="sysPrompt" placeholder="You are a Rust expert&#8230;">
        </div>
        <button class="btn-primary" id="startSessionBtn">
          &#9654;&ensp;Start Session in Terminal
        </button>
      </div>
    </div>

    <!-- Agent -->
    <div class="panel" id="pnl-agent">
      <div class="scrl">
        <div class="form-row">
          <label class="lbl" for="agentGoal">Goal *</label>
          <textarea id="agentGoal" class="goal-ta"
            placeholder="Refactor error handling to use anyhow&#8230;"></textarea>
        </div>
        <div class="form-row">
          <label class="lbl">Files to edit *</label>
          <div class="files-area">
            <div class="files-list" id="filesList">
              <span class="no-files">No files selected</span>
            </div>
            <button class="btn-secondary" id="addFilesBtn">+ Add Files&#8230;</button>
          </div>
        </div>
        <div class="form-row">
          <label class="lbl" for="verifyCmd">Verify command (optional)</label>
          <input type="text" id="verifyCmd" placeholder="cargo check -q">
        </div>
        <div class="form-row">
          <label class="lbl" for="profileSel">Profile</label>
          <select class="profile-sel" id="profileSel">
            <option value="balanced">Balanced (default)</option>
            <option value="quick">Quick</option>
            <option value="strict">Strict</option>
          </select>
        </div>
        <label class="chk-row">
          <input type="checkbox" id="chkApply" checked> Apply changes to disk
        </label>
        <label class="chk-row">
          <input type="checkbox" id="chkRollback"> Rollback on verify failure
        </label>
        <label class="chk-row">
          <input type="checkbox" id="chkCommands"> Allow shell commands
        </label>
        <button class="btn-primary" id="runAgentBtn">
          &#9654;&ensp;Run Agent in Terminal
        </button>
      </div>
    </div>

  </div>
</div>
`;

// ─────────────────────────────────────────────────────────────────────────────
// JavaScript  (string-array join: zero backtick escaping issues)
// Backtick character is obtained via String.fromCharCode(96) where needed.
// ─────────────────────────────────────────────────────────────────────────────

const JS = [
    '"use strict";',
    'const vscode = acquireVsCodeApi();',
    '',
    '// State',
    'let models = [];',
    'let agentFiles = [];',
    'let busy = false;',
    'let streamBuf = "";',
    'let streamEl = null;',
    '',
    '// Wire every interactive element via addEventListener — no inline handlers.',
    '// This satisfies the webview CSP (script-src nonce only, no unsafe-inline).',
    'window.addEventListener("message", onMessage);',
    'document.getElementById("tab-chat").addEventListener("click", () => switchTab("chat"));',
    'document.getElementById("tab-session").addEventListener("click", () => switchTab("session"));',
    'document.getElementById("tab-agent").addEventListener("click", () => switchTab("agent"));',
    'document.getElementById("refreshBtn").addEventListener("click",',
    '  () => vscode.postMessage({ type: "refreshModels" }));',
    'document.getElementById("sendBtn").addEventListener("click", sendChat);',
    'const chatTA = document.getElementById("chatInput");',
    'chatTA.addEventListener("keydown", e => {',
    '  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }',
    '});',
    'chatTA.addEventListener("input", () => autoResize(chatTA));',
    'document.getElementById("startSessionBtn").addEventListener("click", startSession);',
    'document.getElementById("addFilesBtn").addEventListener("click",',
    '  () => vscode.postMessage({ type: "pickFiles" }));',
    'document.getElementById("runAgentBtn").addEventListener("click", runAgent);',
    '',
    '// Tell the extension we are ready — triggers model load + context push',
    'vscode.postMessage({ type: "ready" });',
    '',
    '// ── Tab switching ───────────────────────────────────────────────────────',
    'function switchTab(tab) {',
    '  ["chat", "session", "agent"].forEach(t => {',
    '    document.getElementById("tab-" + t).classList.toggle("active", t === tab);',
    '    document.getElementById("pnl-" + t).classList.toggle("active", t === tab);',
    '  });',
    '}',
    '',
    '// ── Chat ────────────────────────────────────────────────────────────────',
    'function sendChat() {',
    '  if (busy) return;',
    '  const text = chatTA.value.trim();',
    '  if (!text) return;',
    '  const model = document.getElementById("modelSel").value;',
    '  appendUserMsg(text);',
    '  chatTA.value = "";',
    '  autoResize(chatTA);',
    '  setBusy(true);',
    '  streamBuf = ""; streamEl = null;',
    '  vscode.postMessage({ type: "chat", text, model });',
    '}',
    '',
    '// ── Session ─────────────────────────────────────────────────────────────',
    'function startSession() {',
    '  const model = document.getElementById("modelSel").value;',
    '  const sys = document.getElementById("sysPrompt").value.trim();',
    '  vscode.postMessage({ type: "openSession", model, systemPrompt: sys });',
    '}',
    '',
    '// ── Agent ───────────────────────────────────────────────────────────────',
    'function runAgent() {',
    '  const model = document.getElementById("modelSel").value;',
    '  const goal = document.getElementById("agentGoal").value.trim();',
    '  const verify = document.getElementById("verifyCmd").value.trim();',
    '  const profile = document.getElementById("profileSel").value;',
    '  const apply = document.getElementById("chkApply").checked;',
    '  const rollback = document.getElementById("chkRollback").checked;',
    '  const allowCommands = document.getElementById("chkCommands").checked;',
    '  vscode.postMessage({ type: "runAgent", model, goal,',
    '    files: [...agentFiles], verify, profile, apply, rollback, allowCommands });',
    '}',
    '',
    '// ── Agent file list ─────────────────────────────────────────────────────',
    'function renderFiles() {',
    '  const el = document.getElementById("filesList");',
    '  el.innerHTML = "";',
    '  if (!agentFiles.length) {',
    '    const s = document.createElement("span");',
    '    s.className = "no-files";',
    '    s.textContent = "No files selected";',
    '    el.appendChild(s);',
    '    return;',
    '  }',
    '  agentFiles.forEach((f, i) => {',
    '    const row = document.createElement("div");',
    '    row.className = "file-row";',
    '    const span = document.createElement("span");',
    '    span.textContent = f.split("/").pop() || f;',
    '    span.title = f;',
    '    const del = document.createElement("button");',
    '    del.className = "file-del";',
    '    del.textContent = "\u00d7";',
    '    del.title = "Remove";',
    '    del.onclick = () => { agentFiles.splice(i, 1); renderFiles(); };',
    '    row.appendChild(span); row.appendChild(del);',
    '    el.appendChild(row);',
    '  });',
    '}',
    '',
    '// ── Message rendering ────────────────────────────────────────────────────',
    'function appendUserMsg(text) {',
    '  removeWelcome();',
    '  const row = mkEl("div", "msg user");',
    '  row.appendChild(mkEl("span", "msg-label", "You"));',
    '  const b = mkEl("div", "bubble");',
    '  b.textContent = text;',
    '  row.appendChild(b);',
    '  getMsgs().appendChild(row);',
    '  scrollBottom();',
    '}',
    '',
    'function startAiMsg() {',
    '  removeWelcome();',
    '  const row = mkEl("div", "msg ai");',
    '  row.appendChild(mkEl("span", "msg-label", "Clive"));',
    '  const b = mkEl("div", "bubble");',
    '  b.appendChild(mkEl("span", "cur"));',
    '  row.appendChild(b);',
    '  getMsgs().appendChild(row);',
    '  scrollBottom();',
    '  return b;',
    '}',
    '',
    'function appendToken(token) {',
    '  if (!streamEl) { streamEl = startAiMsg(); }',
    '  streamBuf += token;',
    '  let pre = streamEl.querySelector("pre.streaming");',
    '  if (!pre) {',
    '    streamEl.innerHTML = "";',
    '    pre = document.createElement("pre");',
    '    pre.className = "streaming";',
    '    // Apply style properties via JS (not HTML attribute) to satisfy CSP',
    '    pre.style.whiteSpace = "pre-wrap";',
    '    pre.style.wordBreak = "break-word";',
    '    pre.style.margin = "0";',
    '    pre.style.fontFamily = "inherit";',
    '    pre.style.fontSize = "inherit";',
    '    pre.style.background = "none";',
    '    pre.style.border = "none";',
    '    pre.style.padding = "0";',
    '    streamEl.appendChild(pre);',
    '    streamEl.appendChild(mkEl("span", "cur"));',
    '  }',
    '  pre.textContent = streamBuf;',
    '  scrollBottom();',
    '}',
    '',
    'function finalizeAiMsg() {',
    '  if (!streamEl) return;',
    '  streamEl.innerHTML = renderMarkdown(streamBuf);',
    '  streamEl.querySelectorAll("pre").forEach(pre => {',
    '    const codeEl = pre.querySelector("code");',
    '    const code = codeEl ? codeEl.textContent : pre.textContent;',
    '    const btns = mkEl("div", "code-btns");',
    '    const cp = mkEl("button", "code-btn", "Copy");',
    '    cp.onclick = () => vscode.postMessage({ type: "copyText", text: code });',
    '    const ins = mkEl("button", "code-btn", "Insert at cursor");',
    '    ins.onclick = () => vscode.postMessage({ type: "insertText", text: code });',
    '    btns.appendChild(cp); btns.appendChild(ins);',
    '    pre.after(btns);',
    '  });',
    '  streamEl = null; streamBuf = "";',
    '  scrollBottom();',
    '}',
    '',
    'function appendErrMsg(msg) {',
    '  const row = mkEl("div", "msg err");',
    '  const b = mkEl("div", "bubble");',
    '  b.textContent = msg;',
    '  row.appendChild(b);',
    '  getMsgs().appendChild(row);',
    '  scrollBottom();',
    '}',
    '',
    '// ── Markdown renderer ────────────────────────────────────────────────────',
    '// Uses String.fromCharCode(96) for backtick — avoids ANY escaping problem.',
    'const BT = String.fromCharCode(96);   // backtick',
    'const BBT = BT + BT + BT;             // triple-backtick (code fence)',
    '',
    'function renderMarkdown(raw) {',
    '  const lines = raw.split("\\n");',
    '  let out = "";',
    '  let inCode = false;',
    '  const codeLines = [];',
    '  for (let i = 0; i < lines.length; i++) {',
    '    const line = lines[i];',
    '    if (!inCode && line.trimStart().startsWith(BBT)) {',
    '      inCode = true; codeLines.length = 0;',
    '    } else if (inCode && line.trimStart().startsWith(BBT)) {',
    '      inCode = false;',
    '      out += "<pre><code>" + escHtml(codeLines.join("\\n")) + "</code></pre>";',
    '    } else if (inCode) {',
    '      codeLines.push(line);',
    '    } else {',
    '      out += inlineFmt(line) + "<br>";',
    '    }',
    '  }',
    '  if (inCode) { out += "<pre><code>" + escHtml(codeLines.join("\\n")) + "</code></pre>"; }',
    '  return out;',
    '}',
    '',
    'function inlineFmt(line) {',
    '  // Split on backtick to detect inline code spans',
    '  const parts = line.split(BT);',
    '  return parts.map((p, i) =>',
    '    i % 2 === 0',
    '      ? escHtml(p)',
    '          .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")',
    '          .replace(/\\*([^*\\n]+)\\*/g, "<em>$1</em>")',
    '      : "<code>" + escHtml(p) + "</code>"',
    '  ).join("");',
    '}',
    '',
    'function escHtml(s) {',
    '  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");',
    '}',
    '',
    '// ── Extension message handler ────────────────────────────────────────────',
    'function onMessage(e) {',
    '  const msg = e.data;',
    '  switch (msg.type) {',
    '    case "models": {',
    '      models = msg.models || [];',
    '      const sel = document.getElementById("modelSel");',
    '      sel.innerHTML = "";',
    '      if (!models.length) {',
    '        const o = document.createElement("option");',
    '        o.value = ""; o.textContent = "No models — run Clive: Ollama Pull";',
    '        sel.appendChild(o);',
    '      } else {',
    '        models.forEach(m => {',
    '          const o = document.createElement("option");',
    '          o.value = m; o.textContent = m;',
    '          sel.appendChild(o);',
    '        });',
    '        if (msg.defaultModel) sel.value = msg.defaultModel;',
    '      }',
    '      break;',
    '    }',
    '    case "modelsError":',
    '      document.getElementById("modelSel").innerHTML =',
    '        \'<option value="">Error loading models</option>\';',
    '      appendErrMsg("Could not load models:\\n\\n" + (msg.message || ""));',
    '      break;',
    '    case "token": appendToken(msg.token); break;',
    '    case "chatDone": finalizeAiMsg(); setBusy(false); break;',
    '    case "chatError":',
    '      if (streamEl) { streamEl.innerHTML = ""; streamEl = null; streamBuf = ""; }',
    '      appendErrMsg(msg.message || "Unknown error");',
    '      setBusy(false);',
    '      break;',
    '    case "filesAdded":',
    '      (msg.files || []).forEach(f => { if (!agentFiles.includes(f)) agentFiles.push(f); });',
    '      renderFiles();',
    '      break;',
    '    case "context": updateCtx(msg.fileName, msg.sel); break;',
    '  }',
    '}',
    '',
    '// ── UI helpers ───────────────────────────────────────────────────────────',
    'const getMsgs = () => document.getElementById("msgs");',
    '',
    'function mkEl(tag, cls, text) {',
    '  const el = document.createElement(tag);',
    '  if (cls) el.className = cls;',
    '  if (text !== undefined) el.textContent = text;',
    '  return el;',
    '}',
    'function removeWelcome() { document.getElementById("welcome")?.remove(); }',
    'function scrollBottom() { const m = getMsgs(); m.scrollTop = m.scrollHeight; }',
    'function setBusy(b) {',
    '  busy = b;',
    '  chatTA.disabled = b;',
    '  document.getElementById("sendBtn").disabled = b;',
    '}',
    'function autoResize(el) {',
    '  el.style.height = "auto";',
    '  el.style.height = Math.min(el.scrollHeight, 120) + "px";',
    '}',
    'function updateCtx(fileName, sel) {',
    '  const bar = document.getElementById("ctx");',
    '  if (!fileName) { bar.classList.remove("on"); return; }',
    '  document.getElementById("ctxFile").textContent = fileName;',
    '  document.getElementById("ctxSel").style.display = sel ? "inline" : "none";',
    '  bar.classList.add("on");',
    '}',
].join('\n');
