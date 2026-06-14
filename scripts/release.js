#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/release.js <version>');
  console.error('Example: node scripts/release.js 0.0.2');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'Ripple');

const files = [
  {
    path: path.join(appRoot, 'package.json'),
    update(content) {
      return content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
    }
  },
  {
    path: path.join(appRoot, 'src-tauri', 'tauri.conf.json'),
    update(content) {
      return content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
    }
  },
  {
    path: path.join(appRoot, 'src-tauri', 'Cargo.toml'),
    update(content) {
      return content.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
    }
  }
];

console.log(`\nBumping version to ${version}...\n`);

for (const file of files) {
  const content = fs.readFileSync(file.path, 'utf-8');
  const updated = file.update(content);
  fs.writeFileSync(file.path, updated);
  console.log(`  ✓ ${path.relative(root, file.path)}`);
}

console.log(`\nCommitting and tagging v${version}...`);

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

run('git add -A');
run(`git commit -m "release: v${version}"`);
run(`git tag v${version}`);

console.log(`\nPushing to origin...`);

run('git push origin main --tags');

console.log(`\n✓ Released v${version} — GitHub Actions will build the installers.\n`);
