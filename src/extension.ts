import * as vscode from 'vscode';
import * as pty from '@lydell/node-pty';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Cached xterm assets — read from node_modules once per activation
let cachedAssets: { xtermJs: string; xtermCss: string; fitJs: string } | undefined;

// OSC 7 CWD notification: ESC ] 7 ; file://hostname/path BEL-or-ST
// Captures the path portion after the first slash following the hostname.
const OSC7_RE = /\x1b\]7;file:\/\/[^/]*\/([^\x07\x1b]*)(?:\x07|\x1b\\)/;

// PowerShell prompt that emits OSC 7 on every prompt redraw.
// Uses [char] codes to avoid any quoting issues when passed via -Command.
//   [char]0x1b = ESC   [char]0x7 = BEL   [char]92 = \   [char]47 = /
const PWSH_PROMPT_SETUP =
    'function global:prompt {' +
    ' $p=(Get-Location).Path;' +
    ' [Console]::Write([char]0x1b+"]7;file://localhost/"+$p.Replace([char]92,[char]47)+[char]0x7);' +
    ' "PS $p> "' +
    '}';

export function activate(context: vscode.ExtensionContext): void {
    // Status bar item — always visible in the lower-left after git info
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    statusBar.command = 'mira-terminal.open';
    statusBar.text = '$(terminal)';
    statusBar.tooltip = 'Open Mira Terminal (Ctrl+Alt+T)';
    statusBar.show();
    context.subscriptions.push(statusBar);

    const cmd = vscode.commands.registerCommand('mira-terminal.open', () => {
        openTerminalTab(context);
    });
    context.subscriptions.push(cmd);
}

export function deactivate(): void {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadAssets(extensionPath: string): { xtermJs: string; xtermCss: string; fitJs: string } {
    if (!cachedAssets) {
        const read = (...parts: string[]) =>
            fs.readFileSync(path.join(extensionPath, 'node_modules', ...parts), 'utf8');

        cachedAssets = {
            xtermJs:  read('@xterm', 'xterm', 'lib', 'xterm.js'),
            xtermCss: read('@xterm', 'xterm', 'css', 'xterm.css'),
            fitJs:    read('@xterm', 'addon-fit', 'lib', 'addon-fit.js'),
        };
    }
    return cachedAssets;
}

function generateNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

function getShellConfig(): { path: string; args: string[] } {
    if (process.platform === 'win32') {
        const windowsProfiles = vscode.workspace
            .getConfiguration()
            .get<Record<string, { path?: string; args?: string[] }>>('terminal.integrated.profiles.windows') ?? {};

        const gitBash = windowsProfiles['Git Bash'];
        if (gitBash?.path) {
            return {
                path: gitBash.path,
                args: gitBash.args ?? ['--login', '-i'],
            };
        }

        // No Git Bash profile — fall back to Windows PowerShell (built-in)
        return {
            path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
            args: ['-NoLogo'],
        };
    }

    // Linux / macOS — use $SHELL, fall back to /bin/bash
    return {
        path: process.env.SHELL ?? '/bin/bash',
        args: [],
    };
}

// ---------------------------------------------------------------------------
// Terminal panel
// ---------------------------------------------------------------------------

function openTerminalTab(context: vscode.ExtensionContext): void {
    const shell = getShellConfig();

    let assets: { xtermJs: string; xtermCss: string; fitJs: string };
    try {
        assets = loadAssets(context.extensionPath);
    } catch (err) {
        vscode.window.showErrorMessage(`Mira Terminal: failed to load xterm assets: ${err}`);
        return;
    }

    const shellName = path.basename(shell.path, path.extname(shell.path)).toLowerCase();
    const showCwd = vscode.workspace
        .getConfiguration('mira-terminal')
        .get<boolean>('showCwdInTitle', true);
    const autoCopy = vscode.workspace
        .getConfiguration('mira-terminal')
        .get<boolean>('autoCopySelection', false);

    // Build spawn args and extra env for CWD tracking
    let spawnArgs = [...shell.args];
    const extraEnv: Record<string, string> = {};

    if (showCwd) {
        if (shellName === 'bash') {
            // PROMPT_COMMAND runs before every prompt; emits OSC 7 with current $PWD
            extraEnv['PROMPT_COMMAND'] = 'printf "\\033]7;file://localhost%s\\007" "$PWD"';
        } else if (shellName === 'powershell' || shellName === 'pwsh') {
            // Override args to inject the prompt function via -Command
            spawnArgs = ['-NoLogo', '-NoExit', '-Command', PWSH_PROMPT_SETUP];
        }
    }

    const panel = vscode.window.createWebviewPanel(
        'miraTerminal',
        shellName,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    panel.iconPath = new vscode.ThemeIcon('terminal');

    // Spawn PTY in extension host
    let ptyProcess!: pty.IPty;
    try {
        ptyProcess = pty.spawn(shell.path, spawnArgs, {
            name: 'xterm-256color',
            cols: 120,
            rows: 30,
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
            env: {
                ...process.env as Record<string, string>,
                ...extraEnv,
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
                LANG: 'C.UTF-8',
                LC_ALL: 'C.UTF-8',
                LESSCHARSET: 'utf-8',
            },
        });
    } catch (err) {
        vscode.window.showErrorMessage(`Mira Terminal: failed to spawn shell: ${err}`);
        panel.dispose();
        return;
    }

    // PTY output → webview; also parse OSC 7 to update the tab title
    const dataHandler = ptyProcess.onData((data: string) => {
        if (showCwd) {
            const match = OSC7_RE.exec(data);
            if (match) {
                const rawPath = decodeURIComponent(match[1]);
                const basename = path.basename(rawPath) || rawPath;
                const sep = (shellName === 'powershell' || shellName === 'pwsh') ? '\\' : '/';
                panel.title = `${basename}${sep}`;
            }
        }
        panel.webview.postMessage({ type: 'data', data });
    });

    // PTY exit → close panel
    const exitHandler = ptyProcess.onExit(() => {
        panel.webview.postMessage({ type: 'exit' });
        setTimeout(() => panel.dispose(), 500);
    });

    // Webview input/resize → PTY
    panel.webview.onDidReceiveMessage((msg: { type: string; data?: string; cols?: number; rows?: number }) => {
        if (msg.type === 'input' && msg.data !== undefined) {
            ptyProcess.write(msg.data);
        } else if (msg.type === 'resize' && msg.cols !== undefined && msg.rows !== undefined) {
            ptyProcess.resize(msg.cols, msg.rows);
        }
    });

    // Cleanup on panel close
    panel.onDidDispose(() => {
        dataHandler.dispose();
        exitHandler.dispose();
        try { ptyProcess.kill(); } catch { /* already dead */ }
    });

    panel.webview.html = buildWebviewHtml(assets, autoCopy);
}

// ---------------------------------------------------------------------------
// Webview HTML — xterm.js and addon-fit are inlined to avoid any
// webview resource-loading / CSP issues entirely.
// ---------------------------------------------------------------------------

function buildWebviewHtml(assets: { xtermJs: string; xtermCss: string; fitJs: string }, autoCopy: boolean): string {
    const nonce = generateNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 script-src 'nonce-${nonce}';
                 style-src 'unsafe-inline';
                 worker-src blob:;">
  <style>${assets.xtermCss}</style>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
    #terminal-container {
      position: absolute;
      inset: 0;
      padding: 4px;
    }
  </style>
</head>
<body>
  <div id="terminal-container"></div>

  <script nonce="${nonce}">${assets.xtermJs}</script>
  <script nonce="${nonce}">${assets.fitJs}</script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const container = document.getElementById('terminal-container');

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background:          '#1e1e1e',
        foreground:          '#cccccc',
        cursor:              '#cccccc',
        cursorAccent:        '#1e1e1e',
        selectionBackground: '#264f78',
        black:               '#000000',
        red:                 '#cd3131',
        green:               '#0dbc79',
        yellow:              '#e5e510',
        blue:                '#2472c8',
        magenta:             '#bc3fbc',
        cyan:                '#11a8cd',
        white:               '#e5e5e5',
        brightBlack:         '#666666',
        brightRed:           '#f14c4c',
        brightGreen:         '#23d18b',
        brightYellow:        '#f5f543',
        brightBlue:          '#3b8eea',
        brightMagenta:       '#d670d6',
        brightCyan:          '#29b8db',
        brightWhite:         '#e5e5e5',
      },
      scrollback: 10000,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    function fitAndNotify() {
      try {
        fitAddon.fit();
        vscode.postMessage({ type: 'resize', cols: term.cols, rows: term.rows });
      } catch (_) { /* not yet laid out */ }
    }

    // Double rAF: wait for the browser to fully lay out the terminal
    // before fitting — ensures fitAddon gets real pixel dimensions.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fitAndNotify();
      term.focus();
    }));

    // Key input → PTY
    term.onData(data => vscode.postMessage({ type: 'input', data }));

    // Auto-copy selection to clipboard
    if (${autoCopy}) {
      term.onSelectionChange(() => {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        }
      });
    }

    // PTY output → terminal
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'data') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        term.write('\\r\\n\\x1b[90m[process exited]\\x1b[0m\\r\\n');
      }
    });

    // Keep terminal sized to the panel
    const ro = new ResizeObserver(() => fitAndNotify());
    ro.observe(container);
  </script>
</body>
</html>`;
}
