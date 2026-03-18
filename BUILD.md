# Building and Publishing Mira Terminal

## Prerequisites

- Node.js installed
- Logged in to the VS Code Marketplace:
  ```bash
  npx vsce login miranovastudios
  ```
  You'll need a Personal Access Token from https://dev.azure.com — scoped to **Marketplace > Manage**.

## Build Platform VSIXes

Build for current platform.

```bash
npm run build
```

Then install VSIX in VSCode -> CTRL+P -> Extensions: Install from VSIX...


```bash
# Both platforms
npm run package:all

# Or individually
npm run package:linux      # linux-x64
npm run package:windows    # win32-x64
```

This produces:
- `mira-terminal-linux-x64-<version>.vsix`
- `mira-terminal-win32-x64-<version>.vsix`

## Publish to Marketplace

Option A — build and publish in one step:

```bash
npx vsce publish --target linux-x64 win32-x64
```

Option B — publish pre-built VSIXes (after `npm run package:all`):

```bash
npx vsce publish --packagePath \
  mira-terminal-linux-x64-*.vsix \
  mira-terminal-win32-x64-*.vsix
```

## Version Bump

Update `"version"` in `package.json` before publishing a new release.
