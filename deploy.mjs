#!/usr/bin/env node

/**
 * PostBoy deploy script — two-step build and deploy.
 *
 * Usage:
 *   node deploy.mjs build                   # bump patch + build
 *   node deploy.mjs build --bump=minor      # bump minor (0.0.19 → 0.1.0)
 *   node deploy.mjs build --bump=major      # bump major (0.0.19 → 1.0.0)
 *   node deploy.mjs push                    # deploy deploy/ folder to server
 *   node deploy.mjs push --dry-run          # show what would be pushed
 *   node deploy.mjs release                 # bump + build, commit tauri.conf, tag vX.Y.Z, push tag (→ GitHub Actions)
 *   node deploy.mjs release --skip-build    # tag + push only (version already in tauri.conf)
 *   node deploy.mjs release --dry-run
 *
 * Environment variables (all have defaults):
 *   UPDATE_SERVER  — HTTP URL the app uses to check for updates (default: http://10.5.5.108)
 *   DEPLOY_HOST    — SSH hostname/IP (default: 10.5.5.108)
 *   DEPLOY_USER    — SSH user (default: gaurav.saroha)
 *   DEPLOY_PATH    — Remote folder on the server (default: C:/postboy-updates)
 *   RELEASE_REMOTE — Git remote for tag push (default: origin)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

const UPDATE_SERVER = process.env.UPDATE_SERVER || 'http://10.5.5.108';
const DEPLOY_HOST = process.env.DEPLOY_HOST || '10.5.5.108';
const DEPLOY_USER = process.env.DEPLOY_USER || 'gaurav.saroha';
const DEPLOY_PATH = process.env.DEPLOY_PATH || 'C:/postboy-updates';

const TAURI_DIR = join('PostBoy', 'PostBoy');
const TAURI_CONF = join(TAURI_DIR, 'src-tauri', 'tauri.conf.json');
const NSIS_DIR = join(TAURI_DIR, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const MSI_DIR = join(TAURI_DIR, 'src-tauri', 'target', 'release', 'bundle', 'msi');
const DEPLOY_DIR = join('deploy');

const args = process.argv.slice(2);
const command = args[0];

if (!command || !['build', 'push', 'release'].includes(command)) {
  console.error('Usage:');
  console.error('  node deploy.mjs build              # bump version + build + stage artifacts');
  console.error('  node deploy.mjs build --bump=minor  # bump minor version');
  console.error('  node deploy.mjs build --bump=major  # bump major version');
  console.error('  node deploy.mjs push               # SCP deploy/ to server');
  console.error('  node deploy.mjs push --dry-run     # show what would be pushed');
  console.error('  node deploy.mjs release            # build + commit version + tag v*.*.* + push (GitHub Actions)');
  console.error('  node deploy.mjs release --skip-build  # tag + push only');
  console.error('  node deploy.mjs release --dry-run');
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function log(msg) {
  console.log(`\n--- ${msg} ---`);
}

function fileSize(path) {
  return (statSync(path).size / 1024 / 1024).toFixed(1);
}

function bumpVersion(ver, type) {
  const parts = ver.split('.').map(Number);
  while (parts.length < 3) parts.push(0);
  if (type === 'major')      { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (type === 'minor') { parts[1]++; parts[2] = 0; }
  else                       { parts[2]++; }
  return parts.join('.');
}

function extractVersionFromFilename(filename) {
  const match = filename.match(/PostBoy_([\d.]+)_/);
  return match ? match[1] : null;
}

function findArtifacts() {
  if (!existsSync(NSIS_DIR)) {
    console.error(`ERROR: NSIS bundle directory not found at ${NSIS_DIR}`);
    console.error('Run "node deploy.mjs build" first.');
    process.exit(1);
  }

  const nsisFiles = readdirSync(NSIS_DIR);
  const nsisExe = nsisFiles.find(f => f.endsWith('-setup.exe'));
  const nsisExeSig = nsisFiles.find(f => f.endsWith('-setup.exe.sig'));

  if (!nsisExe || !nsisExeSig) {
    console.error('ERROR: Missing NSIS artifacts in ' + NSIS_DIR);
    console.error('Found:', nsisFiles.join(', '));
    process.exit(1);
  }

  let msiFile = null, msiSig = null;
  if (existsSync(MSI_DIR)) {
    const msiFiles = readdirSync(MSI_DIR);
    msiFile = msiFiles.find(f => f.endsWith('.msi'));
    msiSig = msiFiles.find(f => f.endsWith('.msi.sig'));
  }

  return { nsisExe, nsisExeSig, msiFile, msiSig };
}

// ─── BUILD ──────────────────────────────────────────────────────────────────

if (command === 'build') {
  const bumpArg = args.find(a => a.startsWith('--bump='));
  const bumpType = bumpArg ? bumpArg.split('=')[1] : 'patch';

  const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf-8'));
  const oldVer = conf.version;
  const newVer = bumpVersion(oldVer, bumpType);
  conf.version = newVer;
  writeFileSync(TAURI_CONF, JSON.stringify(conf, null, 2) + '\n');
  log(`Version bumped: ${oldVer} → ${newVer} (${bumpType})`);

  for (const dir of [NSIS_DIR, MSI_DIR]) {
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        try { unlinkSync(join(dir, f)); } catch {}
      }
    }
  }

  log('Building PostBoy with UPDATE_SERVER=' + UPDATE_SERVER);
  const env = { ...process.env, UPDATE_SERVER };

  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    let pathFromEnv = env.TAURI_SIGNING_PRIVATE_KEY_PATH
      || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH;
    if (!pathFromEnv && process.platform === 'win32') {
      try {
        pathFromEnv = execSync(
          'powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'TAURI_SIGNING_PRIVATE_KEY_PATH\',\'User\')"',
          { encoding: 'utf-8' }
        ).trim() || undefined;
      } catch {}
    }
    const keyPaths = [
      pathFromEnv,
      join('~', '.tauri', 'postboy.key'),
      join(homedir(), '.tauri', 'postboy.key'),
    ].filter(Boolean);
    const found = keyPaths.find(p => existsSync(p));
    if (found) {
      env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(found, 'utf-8').trim();
      console.log(`Using signing key: ${found}`);
    } else {
      console.error('ERROR: No signing key found. Set TAURI_SIGNING_PRIVATE_KEY env var.');
      console.error('Or place key at: ~/.tauri/postboy.key');
      process.exit(1);
    }
  }

  if (!env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    let pw = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
    if (!pw && process.platform === 'win32') {
      try {
        pw = execSync(
          'powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'TAURI_SIGNING_PRIVATE_KEY_PASSWORD\',\'User\')"',
          { encoding: 'utf-8' }
        ).trim() || undefined;
      } catch {}
    }
    if (pw) env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = pw;
  }

  const buildCmd = process.platform === 'win32' ? 'yarn tauri build' : 'npx tauri build';
  run(buildCmd, { cwd: TAURI_DIR, env });

  // Stage artifacts into deploy/
  const { nsisExe, nsisExeSig, msiFile, msiSig } = findArtifacts();
  const artifactVersion = extractVersionFromFilename(nsisExe);

  if (artifactVersion !== newVer) {
    console.error(`ERROR: Version mismatch — config says ${newVer} but artifact is ${artifactVersion}`);
    process.exit(1);
  }

  const serverBase = UPDATE_SERVER.replace(/\/$/, '');
  const signature = readFileSync(join(NSIS_DIR, nsisExeSig), 'utf-8').trim();
  const latestJson = {
    version: newVer,
    notes: `PostBoy v${newVer}`,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        url: `${serverBase}/${nsisExe}`
      }
    }
  };

  if (existsSync(DEPLOY_DIR)) {
    for (const f of readdirSync(DEPLOY_DIR)) {
      try { unlinkSync(join(DEPLOY_DIR, f)); } catch {}
    }
  } else {
    mkdirSync(DEPLOY_DIR, { recursive: true });
  }

  writeFileSync(join(DEPLOY_DIR, 'latest.json'), JSON.stringify(latestJson, null, 2));
  copyFileSync(join(NSIS_DIR, nsisExe), join(DEPLOY_DIR, nsisExe));
  copyFileSync(join(NSIS_DIR, nsisExeSig), join(DEPLOY_DIR, nsisExeSig));
  if (msiFile) copyFileSync(join(MSI_DIR, msiFile), join(DEPLOY_DIR, msiFile));
  if (msiSig) copyFileSync(join(MSI_DIR, msiSig), join(DEPLOY_DIR, msiSig));

  log(`Build complete — v${newVer}`);
  console.log(`Artifacts staged in ${DEPLOY_DIR}/`);
  console.log(`  - latest.json (version: ${newVer})`);
  console.log(`  - ${nsisExe} (${fileSize(join(DEPLOY_DIR, nsisExe))} MB)`);
  console.log(`  - ${nsisExeSig}`);
  if (msiFile) console.log(`  - ${msiFile} (${fileSize(join(DEPLOY_DIR, msiFile))} MB)`);
  if (msiSig) console.log(`  - ${msiSig}`);
  console.log(`\nRun "node deploy.mjs push" to deploy to server.`);
}

// ─── PUSH ───────────────────────────────────────────────────────────────────

if (command === 'push') {
  const dryRun = args.includes('--dry-run');

  if (!existsSync(DEPLOY_DIR) || !existsSync(join(DEPLOY_DIR, 'latest.json'))) {
    console.error('ERROR: No staged artifacts found in deploy/');
    console.error('Run "node deploy.mjs build" first.');
    process.exit(1);
  }

  const latestJson = JSON.parse(readFileSync(join(DEPLOY_DIR, 'latest.json'), 'utf-8'));
  const jsonVersion = latestJson.version;
  const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf-8'));
  const confVersion = conf.version;

  const deployFiles = readdirSync(DEPLOY_DIR);
  const nsisExe = deployFiles.find(f => f.endsWith('-setup.exe'));
  const nsisExeSig = deployFiles.find(f => f.endsWith('-setup.exe.sig'));
  const msiFile = deployFiles.find(f => f.endsWith('.msi') && !f.endsWith('.msi.sig'));
  const msiSig = deployFiles.find(f => f.endsWith('.msi.sig'));

  if (!nsisExe || !nsisExeSig) {
    console.error('ERROR: Missing installer artifacts in deploy/');
    process.exit(1);
  }

  const artifactVersion = extractVersionFromFilename(nsisExe);

  log('Version check');
  console.log(`  tauri.conf.json : ${confVersion}`);
  console.log(`  latest.json     : ${jsonVersion}`);
  console.log(`  artifact        : ${artifactVersion}`);

  if (jsonVersion !== artifactVersion || jsonVersion !== confVersion) {
    console.error(`\nERROR: Version mismatch detected!`);
    if (jsonVersion !== confVersion) console.error(`  latest.json (${jsonVersion}) ≠ tauri.conf.json (${confVersion})`);
    if (jsonVersion !== artifactVersion) console.error(`  latest.json (${jsonVersion}) ≠ artifact (${artifactVersion})`);
    console.error('Rebuild with "node deploy.mjs build" to fix.');
    process.exit(1);
  }

  const filesToUpload = [
    join(DEPLOY_DIR, 'latest.json'),
    join(DEPLOY_DIR, nsisExe),
    join(DEPLOY_DIR, nsisExeSig),
  ];
  if (msiFile) filesToUpload.push(join(DEPLOY_DIR, msiFile));
  if (msiSig) filesToUpload.push(join(DEPLOY_DIR, msiSig));

  log(`Deploying v${jsonVersion} to ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}`);
  filesToUpload.forEach(f => console.log(`  ${f}`));

  if (dryRun) {
    console.log('\nDRY RUN — nothing was uploaded.');
  } else {
    const target = `${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/`;
    const scpFiles = filesToUpload.map(f => `"${f}"`).join(' ');
    run(`scp ${scpFiles} "${target}"`);

    const serverBase = UPDATE_SERVER.replace(/\/$/, '');
    log('Done');
    console.log(`\nUpdate server: ${serverBase}/latest.json`);
    console.log('Existing users will see the update banner on next app launch.');
    console.log(`\nFirst-time install (EXE): ${serverBase}/${nsisExe}`);
    if (msiFile) console.log(`First-time install (MSI): ${serverBase}/${msiFile}`);
    console.log('Share these URLs with new users to download the installer.');
  }
}
