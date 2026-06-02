# Building PostBoy

PostBoy bundles a local LLM via [`llama-cpp-2`](https://crates.io/crates/llama-cpp-2). It uses platform-native GPU backends so the chatbot runs on the user's GPU when one is available, with automatic CPU fallback otherwise:

| OS              | Backend | Notes                                                   |
| --------------- | ------- | ------------------------------------------------------- |
| macOS           | Metal   | Ships with the OS — no extra setup.                     |
| Windows / Linux | Vulkan  | Universal across NVIDIA / AMD / Intel; SDK required.    |

`yarn tauri dev` and `yarn tauri build` are wrapped by `scripts/tauri-env.cjs`, which on Windows activates the MSVC toolchain (`vcvars64.bat`) and applies the env tweaks needed for the Vulkan-enabled `llama-cpp-sys-2` build to succeed.

---

## macOS

1. Install Xcode command-line tools: `xcode-select --install`
2. `yarn install`
3. `yarn tauri dev`

That's it — Metal is built in.

---

## Windows (one-time setup)

The Windows toolchain has three prereqs. After this you should never need to think about them again — the wrapper script handles everything else.

### 1. Visual Studio with C++

Install **Visual Studio 2022 Community** (or newer) and check **"Desktop development with C++"**. The wrapper finds VS automatically via `vswhere.exe`.

### 2. Vulkan SDK

Install from <https://vulkan.lunarg.com/sdk/home>. The wrapper script auto-discovers the SDK in this order: the current shell's `VULKAN_SDK` env var, the system / user env var (read directly via PowerShell so a stale shell still works), and finally the default install path `C:\VulkanSDK\<version>`. So a shell that pre-dates the install will still pick it up.

### 3. Enable Long Paths (one-time, requires admin)

`llama-cpp-sys-2` builds shaders via a deeply nested CMake `ExternalProject`. Combined with MSBuild `.tlog` files, the resulting paths exceed Windows' default 260-char `MAX_PATH` limit. Fix it once:

```pwsh
# Run from an elevated PowerShell (UAC prompt).
Set-ItemProperty `
  -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' `
  -Name 'LongPathsEnabled' -Value 1 -Type DWord
```

A reboot (or `gpupdate /force` plus a fresh shell) is recommended so all processes pick up the new flag.

### 4. Run

```pwsh
yarn install
yarn tauri dev
```

The wrapper will:

- Find the latest VS install and source `vcvars64.bat`.
- Put `%VULKAN_SDK%\Bin` on `PATH`.
- Set `CARGO_TARGET_DIR=C:\t\pb` (short root, keeps nested build paths short).
- Set `COMPlus_AppContextSwitchOverrides` so MSBuild's CPPTasks (.NET Framework) honour long paths.

#### First-build flakiness (Windows only)

The very first `cargo` build of `llama-cpp-sys-2 v0.1.146` sometimes fails with `MSB8066: Custom build for 'vulkan-shaders-gen-build.rule' exited with code 1` because MSBuild parallelises the inner `vulkan-shaders-gen` ExternalProject's configure / build / install steps. **The wrapper detects this exact failure signature and retries up to 3 times automatically** — you should see a `[tauri-env]` retry message and the build will recover. This is a known upstream quirk independent of our setup; subsequent builds are incremental and fast.

---

## Verifying GPU offload at runtime

When the chatbot loads a model, `llama.cpp` logs which backend it picked. Look for lines like:

```
ggml_vulkan: Found 1 Vulkan devices: NVIDIA GeForce RTX 4060 ...
llm_load_tensors: offloaded 33/33 layers to GPU
```

on Windows / Linux, or:

```
ggml_metal_init: picking default device: Apple M3 Pro
```

on macOS. If you see only CPU tensors, your GPU/driver wasn't picked up — check that the corresponding SDK is installed and visible.
