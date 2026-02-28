import * as vscode from 'vscode';
import * as pty from '@lydell/node-pty';
import * as path from 'path';
import * as os from 'os';

export function activate(context: vscode.ExtensionContext): void {
    const cmd = vscode.commands.registerCommand('mira-terminal.open', () => {
        openTerminalTab(context);
    });
    context.subscriptions.push(cmd);
}

export function deactivate(): void {}

function getShellConfig(): { path: string; args: string[] } {
    // Read the full Windows profiles object from settings.json
    const windowsProfiles = vscode.workspace
        .getConfiguration()
        .get<Record<string, { path?: string; args?: string[] }>>('terminal.integrated.profiles.windows') ?? {};

    const gitBash = windowsProfiles['Git Bash'];

    return {
        path: gitBash?.path ?? 'C:\\Program Files\\Git\\bin\\bash.exe',
        args: gitBash?.args ?? ['--login', '-i'],
    };
}

function openTerminalTab(context: vscode.ExtensionContext): void {
    const shell = getShellConfig();

    const panel = vscode.window.createWebviewPanel(
        'miraTerminal',
        'bash',
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, 'node_modules')),
            ],
        }
    );

    // Spawn PTY in extension host (Node.js context)
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

    // Webview messages → PTY
    panel.webview.onDidReceiveMessage((msg: { type: string; data?: string; cols?: number; rows?: number }) => {
        if (msg.type === 'input' && msg.data !== undefined) {
            ptyProcess.write(msg.data);
        } else if (msg.type === 'resize' && msg.cols !== undefined && msg.rows !== undefined) {
            ptyProcess.resize(msg.cols, msg.rows);
        }
    });

    // Cleanup when panel closes
    panel.onDidDispose(() => {
        dataHandler.dispose();
        exitHandler.dispose();
        try { ptyProcess.kill(); } catch { /* already dead */ }
    });

    panel.webview.html = buildWebviewHtml(panel.webview, context.extensionPath);
}

function buildWebviewHtml(webview: vscode.Webview, extensionPath: string): string {
    const uri = (relative: string): vscode.Uri =>
        webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'node_modules', relative)));

    const xtermJs  = uri('@xterm/xterm/lib/xterm.js');
    const xtermCss = uri('@xterm/xterm/css/xterm.css');
    const fitJs    = uri('@xterm/addon-fit/lib/addon-fit.js');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 script-src ${webview.cspSource};
                 style-src ${webview.cspSource} 'unsafe-inline';
                 font-src ${webview.cspSource} data:;">
  <link rel="stylesheet" href="${xtermCss}">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; height: 100vh;
      overflow: hidden;
      background: #1e1e1e;
    }
    #terminal-container {
      width: 100%; height: 100%;
      padding: 4px;
    }
  </style>
</head>
<body>
  <div id="terminal-container"></div>

  <script src="${xtermJs}"></script>
  <script src="${fitJs}"></script>
  <script>
    const vscode = acquireVsCodeApi();

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background:  '#1e1e1e',
        foreground:  '#d4d4d4',
        cursor:      '#aeafad',
        black:       '#1e1e1e',
        red:         '#f44747',
        green:       '#6a9955',
        yellow:      '#d7ba7d',
        blue:        '#569cd6',
        magenta:     '#c586c0',
        cyan:        '#4ec9b0',
        white:       '#d4d4d4',
        brightBlack: '#808080',
        brightRed:   '#f44747',
        brightGreen: '#6a9955',
        brightYellow:'#d7ba7d',
        brightBlue:  '#569cd6',
        brightMagenta:'#c586c0',
        brightCyan:  '#4ec9b0',
        brightWhite: '#d4d4d4',
      },
      scrollback: 10000,
      allowProposedApi: false,
      // Let the PTY handle all input - no local echo
      disableStdin: false,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-container'));

    function fitAndNotify() {
      fitAddon.fit();
      vscode.postMessage({ type: 'resize', cols: term.cols, rows: term.rows });
    }

    // Initial fit after a brief layout pass
    setTimeout(fitAndNotify, 50);
    term.focus();

    // Key input → extension host → PTY
    term.onData(data => {
      vscode.postMessage({ type: 'input', data });
    });

    // Extension host (PTY output) → terminal
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'data') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        term.write('\\r\\n\\x1b[90m[process exited]\\x1b[0m\\r\\n');
      }
    });

    // Resize observer keeps cols/rows in sync with panel size
    const ro = new ResizeObserver(() => fitAndNotify());
    ro.observe(document.getElementById('terminal-container'));
  </script>
</body>
</html>`;
}
