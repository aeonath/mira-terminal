# Mira Terminal

VSCode Extension | MiraNova Studios

A VSCode extension that opens a full terminal in a dedicated editor tab — powered by a real PTY via `node-pty` and rendered with `xterm.js`. Designed to play well with vim, TUI applications, and anything that needs a proper pseudo-terminal.

---

## Features

- **Terminal as an editor tab** — opens alongside your files in the main editor area, not the bottom panel
- **Full PTY support** — real pseudo-terminal via `@lydell/node-pty`; vim, htop, and other TUI apps work correctly
- **xterm.js rendering** — `xterm-256color`, true color, 10,000 line scrollback
- **Auto-resize** — terminal cols/rows stay in sync with the panel size via `ResizeObserver` + `SIGWINCH`
- **Shell from your settings** — reads the `Git Bash` profile from `terminal.integrated.profiles.windows`; falls back to `C:\Program Files\Git\bin\bash.exe`
- **Multiple tabs** — run the command multiple times to open independent terminal sessions
- **Context preserved** — switching tabs does not kill the shell (`retainContextWhenHidden`)
- **Status bar button** — terminal icon always visible in the lower-left status bar for one-click access

---

## Requirements

- VSCode `^1.96.0`
- Windows (PowerShell is used by default; [Git for Windows](https://git-scm.com/download/win) optional for Git Bash support)

---

## Installation

### From VSIX (recommended for local builds)

1. Build the `.vsix` package (npm run build)
2. Open VSCode
3. Open the Extensions view (`Ctrl+Shift+X`)
4. Click the `...` menu → **Install from VSIX...**
5. Select the generated `mira-terminal-0.2.1.vsix`

---

## Usage

| Action | How |
|---|---|
| Open a terminal tab | `Ctrl+Alt+T` |
| Open via status bar | Click `$(terminal)` icon in the lower-left status bar |
| Open via command palette | `Ctrl+Shift+P` → **Mira Terminal: Open Mira Terminal** |
| Open from terminal panel | Click `$(terminal)` in the integrated terminal title bar, or right-click a terminal tab |
| Open another terminal | Run the command again — each invocation is an independent session |
| Close the terminal | Close the tab or type `exit` in the shell |

The terminal opens in the active editor column. The shell starts in the current workspace folder, or your home directory if no workspace is open.

---

## Shell Configuration

Mira Terminal reads your VSCode `settings.json` to determine which shell to launch.

### Default (no configuration required)

| Platform | Default shell |
|---|---|
| Windows | `powershell.exe -NoLogo` |
| Linux / macOS | `$SHELL` environment variable, falling back to `/bin/bash` |

### Using Git Bash

First, install [Git for Windows](https://git-scm.com/download/win). Then add the following to your VSCode `settings.json` (`Ctrl+Shift+P` → **Preferences: Open User Settings (JSON)**):

```json
"terminal.integrated.defaultProfile.windows": "Git Bash",
"terminal.integrated.profiles.windows": {
    "Git Bash": {
        "path": "C:\\Program Files\\Git\\bin\\bash.exe",
        "args": ["--login", "-i"],
        "icon": "terminal-bash"
    }
}
```

Mira Terminal will pick up the `Git Bash` profile automatically on next launch — no extension restart needed.

---

## Building

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- npm

### Steps

```bash
# Clone or navigate to the project directory
cd mira-terminal

# Install dependencies, compile TypeScript, and package the VSIX in one step
npm run build
```

This runs:
1. `npm install` — installs all dependencies (including prebuilt `@lydell/node-pty` binaries for your platform)
2. `npm run compile` — compiles TypeScript to `out/`
3. `vsce package` — bundles everything into `mira-terminal-0.2.1.vsix`

### Individual scripts

```bash
npm run compile   # TypeScript only
npm run watch     # TypeScript in watch mode
npm run package   # compile + vsce package (skips npm install)
```

> **Note:** No native module rebuild step is required. `@lydell/node-pty` ships prebuilt platform binaries as optional npm dependencies — no compiler toolchain (Python, node-gyp, C++ build tools) needed.

---

## Project Structure

```
mira-terminal/
├── src/
│   └── extension.ts       # All extension logic
├── out/                   # Compiled JavaScript (generated, gitignored)
├── node_modules/          # Dependencies (gitignored)
├── package.json           # Extension manifest and scripts
├── tsconfig.json          # TypeScript configuration
├── .vscodeignore          # Files excluded from the VSIX bundle
├── .npmignore             # Files excluded from npm operations
└── .gitignore
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  VSCode Extension Host (Node.js)                    │
│                                                     │
│  extension.ts                                       │
│  ├── reads shell config from VSCode settings        │
│  ├── spawns Git Bash via @lydell/node-pty           │
│  ├── PTY output  ──postMessage──►  Webview          │
│  └── Webview input/resize  ◄──────  PTY write/resize│
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│  Webview (Chromium sandbox)                         │
│                                                     │
│  xterm.js Terminal                                  │
│  ├── renders PTY output                             │
│  ├── captures key input  ──postMessage──►  Host     │
│  └── ResizeObserver  ──postMessage──►  pty.resize() │
└─────────────────────────────────────────────────────┘
```

PTY output flows from the extension host to the webview via `panel.webview.postMessage()`. Key input and resize events flow back via `webview.onDidReceiveMessage`. xterm.js and its addon are read from `node_modules` using `fs.readFileSync` at panel creation time and **inlined directly into the HTML** with a per-session nonce — no external resource loading, no `localResourceRoots`, no CSP source-matching issues.

---

## Vim & TUI Compatibility

- `TERM=xterm-256color` and `COLORTERM=truecolor` are set in the PTY environment
- Window resize events (`SIGWINCH`) are sent to the shell whenever the panel resizes
- The PTY handles all input in raw mode — no local echo, no line buffering
- `xterm-256color` terminfo is used for full escape sequence support

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@lydell/node-pty` | `^1.0.3` | Pseudo-terminal — spawns and manages the shell process |
| `@xterm/xterm` | `^5.5.0` | Terminal renderer in the webview |
| `@xterm/addon-fit` | `^0.10.0` | Resizes the xterm instance to fit its container |

### Dev dependencies

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.7.0` | TypeScript compiler |
| `@types/vscode` | `^1.96.0` | VSCode API type definitions |
| `@types/node` | `^22.0.0` | Node.js type definitions |
| `@vscode/vsce` | `^3.7.1` | VSCode extension packager |

---

## Extension Settings

Access via **Preferences → Settings → Extensions → Mira Terminal**, or add directly to `settings.json`.

| Setting | Type | Default | Description |
|---|---|---|---|
| "mira-terminal.showCwdInTitle" | boolean | `true` | Show the current working directory (folder name) in the terminal tab title |
| "mira-terminal.autoCopySelection" | boolean | `true` | Automatically copy selected text to the clipboard when text is highlighted in the terminal |

### `mira-terminal.showCwdInTitle`

When enabled the tab title updates to `shell — foldername` as you navigate, e.g.:

```
mira-terminal/    ← bash / Git Bash
mira-terminal\    ← PowerShell
```

To enable, add this to your `settings.json`:

```json
"mira-terminal.showCwdInTitle": true
```

**How it works:**
- **Bash / Git Bash** — injects `PROMPT_COMMAND` into the PTY environment so the shell emits an [OSC 7](https://iterm2.com/documentation-escape-codes.html) CWD sequence before each prompt
- **PowerShell** — overrides the `prompt` function via `-Command` to emit the same OSC 7 sequence
- The extension host parses the sequence and updates the tab; no terminal output is modified

> **Note for bash users:** If your `.bashrc` or `.bash_profile` sets its own `PROMPT_COMMAND`, it will overwrite the injected one. In that case, append the following to your profile to restore CWD tracking:
> ```bash
> PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND; }printf '\033]7;file://localhost%s\007' \"$PWD\""
> ```

### `mira-terminal.autoCopySelection`

When enabled, any text you highlight in the terminal is immediately copied to the system clipboard — no `Ctrl+C` required. This mirrors the selection-to-clipboard behaviour found in many Linux terminal emulators.

To enable, add this to your `settings.json`:

```json
"mira-terminal.autoCopySelection": true
```

---

## Roadmap

- [x] Display current working directory in the tab title
- [x] Auto-copy highlighted text to clipboard
- [ ] Configurable font size and color theme
- [ ] Persistent terminal sessions across VSCode restarts

---

## License

MIT © 2026 MiraNova Studios — see [LICENSE](LICENSE) for full text.
