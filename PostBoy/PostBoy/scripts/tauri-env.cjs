#!/usr/bin/env node
/**
 * Cross-platform `tauri` wrapper.
 *
 * On Windows: activates the MSVC build environment (vcvars64.bat) and applies
 * the env tweaks needed for the Vulkan-enabled `llama-cpp-sys-2` build to work
 * cleanly:
 *   - VULKAN_SDK is on PATH so cmake's FindVulkan finds it.
 *   - CARGO_TARGET_DIR is redirected to a short root (default C:\t\pb) so
 *     llama.cpp's deeply nested ExternalProject + MSBuild .tlog paths stay
 *     under Windows' effective MAX_PATH limit.
 *   - COMPlus_AppContextSwitchOverrides opts MSBuild's CPPTasks (.NET
 *     Framework) into long-path filesystem APIs.
 *
 * On macOS / Linux: passes straight through to the local `tauri` binary; no
 * environment massaging is needed (Metal ships with macOS, Vulkan works on
 * Linux without MAX_PATH issues).
 *
 * See BUILDING.md for the one-time host prereqs (Vulkan SDK install,
 * `LongPathsEnabled` registry value on Windows).
 */

const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const args = process.argv.slice(2);
const isWin = process.platform === 'win32';

function findTauriBin() {
  const bin = path.resolve(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    isWin ? 'tauri.cmd' : 'tauri',
  );
  if (!fs.existsSync(bin)) {
    console.error(`[tauri-env] tauri CLI not found at ${bin}.`);
    console.error('[tauri-env] Run `yarn install` first.');
    process.exit(1);
  }
  return bin;
}

function fail(msg) {
  console.error(`[tauri-env] ${msg}`);
  process.exit(1);
}

/**
 * Best-effort lookup of `VULKAN_SDK` on Windows.
 *
 * 1. Trust `process.env.VULKAN_SDK` if set (current shell already has it).
 * 2. Otherwise read the Machine then User env vars directly via PowerShell —
 *    this works even when the current shell predates the Vulkan SDK install
 *    (Windows doesn't propagate env-var changes to existing processes).
 * 3. As a last resort, scan the default install path `C:\VulkanSDK\<ver>` and
 *    pick the highest version.
 *
 * Returns the resolved path (verified to exist) or null.
 */
function resolveVulkanSdk() {
  const verify = (p) => (p && fs.existsSync(p) ? p : null);

  const fromEnv = verify(process.env.VULKAN_SDK);
  if (fromEnv) return fromEnv;

  const readScopedEnv = (scope) => {
    try {
      return execSync(
        `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('VULKAN_SDK','${scope}')"`,
        { encoding: 'utf8' },
      ).trim();
    } catch {
      return '';
    }
  };
  const fromMachine = verify(readScopedEnv('Machine'));
  if (fromMachine) return fromMachine;
  const fromUser = verify(readScopedEnv('User'));
  if (fromUser) return fromUser;

  const root = 'C:\\VulkanSDK';
  if (fs.existsSync(root)) {
    const versions = fs
      .readdirSync(root)
      .filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d))
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 4; i++) {
          if (pa[i] !== pb[i]) return pb[i] - pa[i];
        }
        return 0;
      });
    for (const v of versions) {
      const candidate = verify(path.join(root, v));
      if (candidate) return candidate;
    }
  }

  return null;
}

function setupWindowsEnv() {
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  );
  if (!fs.existsSync(vswhere)) {
    fail(
      'vswhere.exe not found. Install Visual Studio with the "Desktop development with C++" workload. See BUILDING.md.',
    );
  }

  let vsRoot;
  try {
    vsRoot = execSync(`"${vswhere}" -latest -property installationPath`, {
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    fail(`vswhere.exe failed: ${err.message}`);
  }
  if (!vsRoot) {
    fail('No Visual Studio installation found. See BUILDING.md.');
  }

  const vcvars = path.join(vsRoot, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (!fs.existsSync(vcvars)) {
    fail(`vcvars64.bat not found at ${vcvars}. Reinstall VS C++ build tools.`);
  }

  // Source vcvars64.bat by running it inside cmd and capturing the resulting
  // environment. Use `call` so cmd's /s flag strips Node's outer quotes cleanly
  // and the path-with-spaces stays as one token.
  let envDump;
  try {
    envDump = execSync(`call "${vcvars}" >nul 2>&1 && set`, {
      shell: 'cmd.exe',
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    fail(`Failed to source vcvars64.bat: ${err.message}`);
  }
  for (const line of envDump.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      process.env[line.slice(0, idx)] = line.slice(idx + 1);
    }
  }

  if (!process.env.VULKAN_SDK) {
    const resolved = resolveVulkanSdk();
    if (resolved) {
      process.env.VULKAN_SDK = resolved;
      console.log(`[tauri-env] Using VULKAN_SDK=${resolved}`);
    }
  }
  if (!process.env.VULKAN_SDK) {
    fail(
      'VULKAN_SDK is not set and no install was found at C:\\VulkanSDK. Install the Vulkan SDK from https://vulkan.lunarg.com/sdk/home and re-run.',
    );
  }
  if (!process.env.PATH.split(';').some((p) => p.toLowerCase() === `${process.env.VULKAN_SDK.toLowerCase()}\\bin`)) {
    process.env.PATH = `${process.env.VULKAN_SDK}\\Bin;${process.env.PATH}`;
  }

  if (!process.env.CARGO_TARGET_DIR) {
    process.env.CARGO_TARGET_DIR = 'C:\\t\\pb';
  }

  if (!process.env.COMPlus_AppContextSwitchOverrides) {
    process.env.COMPlus_AppContextSwitchOverrides =
      'Switch.System.IO.UseLegacyPathHandling=false;Switch.System.IO.BlockLongPaths=false';
  }
}

if (isWin) {
  setupWindowsEnv();
}

const tauri = findTauriBin();

/**
 * Run tauri once. On Windows we tee stdout/stderr through a small ring buffer
 * so we can detect the upstream `llama-cpp-sys-2` MSBuild flake (MSB8066) and
 * retry — this only fires on a *failed* build that matches the exact upstream
 * signature, so real Rust compile errors propagate immediately. On macOS/Linux
 * we just pipe stdio through and forward the exit code.
 */
function runTauri() {
  return new Promise((resolve) => {
    // Node ≥18.20 refuses to spawn .cmd/.bat files without shell:true (CVE-2024-27980).
    // On macOS/Linux `tauri` is a real ELF/Mach-O so shell isn't needed.
    const child = spawn(tauri, args, {
      env: process.env,
      shell: isWin,
      stdio: isWin ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    });

    const onSig = (sig) => {
      if (!child.killed) child.kill(sig);
    };
    process.on('SIGINT', onSig);
    process.on('SIGTERM', onSig);

    let tail = '';
    if (isWin) {
      const TAIL_LIMIT = 64 * 1024;
      const capture = (src, sink) => {
        src.on('data', (chunk) => {
          sink.write(chunk);
          tail = (tail + chunk.toString('utf8')).slice(-TAIL_LIMIT);
        });
      };
      capture(child.stdout, process.stdout);
      capture(child.stderr, process.stderr);
    }

    child.on('error', (err) => {
      console.error(`[tauri-env] failed to launch tauri: ${err.message}`);
      cleanup();
      resolve({ code: 1, tail });
    });
    child.on('exit', (code) => {
      cleanup();
      resolve({ code: code === null ? 1 : code, tail });
    });

    function cleanup() {
      process.off('SIGINT', onSig);
      process.off('SIGTERM', onSig);
    }
  });
}

(async () => {
  // Upstream `llama-cpp-sys-2`'s vulkan-shaders-gen ExternalProject hits an
  // MSBuild parallelism race on Windows (MSB8066) on first build. The build
  // *itself* is correct — re-running succeeds because cached configure outputs
  // are now in place. We retry up to 2 times only when this exact failure
  // signature shows up, so genuine errors aren't masked.
  const FLAKY_RE = /MSB8066: Custom build for .*vulkan-shaders-gen/;
  const MAX_ATTEMPTS = isWin ? 3 : 1;

  for (let attempt = 1; ; attempt++) {
    const { code, tail } = await runTauri();
    if (code === 0 || attempt >= MAX_ATTEMPTS || !FLAKY_RE.test(tail)) {
      process.exit(code);
    }
    console.error(
      `\n[tauri-env] llama-cpp-sys-2 hit the known MSBuild MSB8066 flake (attempt ${attempt}/${MAX_ATTEMPTS}). Retrying...\n`,
    );
  }
})();
