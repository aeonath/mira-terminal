const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const target = process.argv[2];
if (!target) {
  console.error("Usage: node build-target.js <target>");
  console.error("  e.g. node build-target.js win32-x64");
  process.exit(1);
}

const platformPackages = {
  "linux-x64": "@lydell/node-pty-linux-x64",
  "win32-x64": "@lydell/node-pty-win32-x64",
  "darwin-x64": "@lydell/node-pty-darwin-x64",
  "darwin-arm64": "@lydell/node-pty-darwin-arm64",
};

const wanted = platformPackages[target];
if (!wanted) {
  console.error(`Unknown target: ${target}`);
  console.error(`Valid targets: ${Object.keys(platformPackages).join(", ")}`);
  process.exit(1);
}

const root = path.join(__dirname, "..");
const vscodeignore = path.join(root, ".vscodeignore");
const nodeModules = path.join(root, "node_modules", "@lydell");

// Get the installed version of @lydell/node-pty to match
const ptyPkg = JSON.parse(
  fs.readFileSync(path.join(nodeModules, "node-pty", "package.json"), "utf8")
);
const ptyVersion = ptyPkg.version;

// Ensure the wanted package is installed at the matching version
const wantedDir = wanted.replace("@lydell/", "");
const wantedPath = path.join(nodeModules, wantedDir);
let needsInstall = true;
if (fs.existsSync(wantedPath)) {
  const installedPkg = JSON.parse(
    fs.readFileSync(path.join(wantedPath, "package.json"), "utf8")
  );
  needsInstall = installedPkg.version !== ptyVersion;
}
if (needsInstall) {
  console.log(`Installing ${wanted}@${ptyVersion}...`);
  execSync(`npm install ${wanted}@${ptyVersion} --force --no-save`, {
    stdio: "inherit",
    cwd: root,
  });
}

// Read current .vscodeignore
const originalIgnore = fs.readFileSync(vscodeignore, "utf8");

// Build ignore lines for all OTHER platform packages
const excludeLines = [];
for (const [t, pkg] of Object.entries(platformPackages)) {
  if (t !== target) {
    const dir = pkg.replace("@lydell/", "");
    excludeLines.push(`node_modules/@lydell/${dir}/**`);
  }
}

// Also exclude build script from the vsix
excludeLines.push("scripts/**");

// Write updated .vscodeignore
const updatedIgnore =
  originalIgnore.trimEnd() + "\n" + excludeLines.join("\n") + "\n";
fs.writeFileSync(vscodeignore, updatedIgnore);

try {
  console.log(`\nCompiling TypeScript...`);
  execSync("npx tsc -p ./", { stdio: "inherit", cwd: root });

  console.log(`\nPackaging for ${target}...`);
  execSync(`npx vsce package --target ${target}`, {
    stdio: "inherit",
    cwd: root,
  });

  console.log(`\nDone! Built ${target} package.`);
} finally {
  // Restore original .vscodeignore
  fs.writeFileSync(vscodeignore, originalIgnore);
}
