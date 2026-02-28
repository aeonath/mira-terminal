# Mira Terminal - VSCode Extension

## Project
VSCode extension that opens terminal in a webview tab (not the integrated terminal panel).
- Location: `C:/Work/mira-terminal/`
- Reference implementation: `C:/Work/novi/src/main/services/terminal-service.ts`

## Architecture
- **Extension host** (Node.js): node-pty spawns Git Bash, routes PTY I/O via postMessage
- **Webview**: xterm.js renders terminal, sends input/resize back via postMessage
- xterm.js and addon-fit served from `node_modules/@xterm/` via `webview.asWebviewUri()`

## Key Files
- `src/extension.ts` - all extension logic
- `package.json` - command: `mira-terminal.open`, keybinding: Ctrl+Alt+T

## Build Steps
1. `npm run build` — runs install + compile + vsce package in one step

No native rebuild needed — `@lydell/node-pty` ships prebuilt platform binaries as optionalDependencies.

## Dependencies
- `@lydell/node-pty@^1.0.3` - PTY with prebuilt binaries (no node-gyp, no rebuild needed)
- `@xterm/xterm@^5.5.0` - terminal renderer
- `@xterm/addon-fit@^0.10.0` - auto-resize
- `@vscode/vsce@^3.7.1` - extension packager (devDep)
- `typescript@^5.7.0` (devDep)

## Shell Config
Reads `terminal.integrated.profiles.windows["Git Bash"]` from VSCode settings.
Falls back to `C:\Program Files\Git\bin\bash.exe --login -i`.

## Vim Compatibility
- `TERM=xterm-256color`, `COLORTERM=truecolor`
- Full PTY via node-pty (raw mode, SIGWINCH on resize)
- ResizeObserver → fitAddon.fit() → postMessage resize → ptyProcess.resize()
