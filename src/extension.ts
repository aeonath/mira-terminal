import * as vscode from 'vscode';
import * as pty from '@lydell/node-pty';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Cached xterm assets — read from node_modules once per activation
let cachedAssets: { xtermJs: string; xtermCss: string; fitJs: string } | undefined;

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
    const windowsProfiles = vscode.workspace
        .getConfiguration()
        .get<Record<string, { path?: string; args?: string[] }>>('terminal.integrated.profiles.windows') ?? {};

    const gitBash = windowsProfiles['Git Bash'];
    return {
        path: gitBash?.path ?? 'C:\\Program Files\\Git\\bin\\bash.exe',
        args: gitBash?.args ?? ['--login', '-i'],
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

    const panel = vscode.window.createWebviewPanel(
        'miraTerminal',
        'bash',
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            // Assets are inlined — no localResourceRoots needed
        }
    );

    panel.iconPath = new vscode.ThemeIcon('terminal');

    // Spawn PTY in extension host
    let ptyProcess!: pty.IPty;
    try {
        ptyProcess = pty.spawn(shell.path, shell.args, {
            name: 'xterm-256color',
            cols: 120,
            rows: 30,
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
            env: {
                ...process.env as Record<string, string>,
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

    // PTY output → webview
    const dataHandler = ptyProcess.onData((data: string) => {
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

    panel.webview.html = buildWebviewHtml(assets);
}

// ---------------------------------------------------------------------------
// Webview HTML — xterm.js and addon-fit are inlined to avoid any
// webview resource-loading / CSP issues entirely.
// ---------------------------------------------------------------------------

function buildWebviewHtml(assets: { xtermJs: string; xtermCss: string; fitJs: string }): string {
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
        background:    '#1e1e1e',
        foreground:    '#d4d4d4',
        cursor:        '#aeafad',
        black:         '#1e1e1e',
        red:           '#f44747',
        green:         '#6a9955',
        yellow:        '#d7ba7d',
        blue:          '#569cd6',
        magenta:       '#c586c0',
        cyan:          '#4ec9b0',
        white:         '#d4d4d4',
        brightBlack:   '#808080',
        brightRed:     '#f44747',
        brightGreen:   '#6a9955',
        brightYellow:  '#d7ba7d',
        brightBlue:    '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan:    '#4ec9b0',
        brightWhite:   '#d4d4d4',
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
