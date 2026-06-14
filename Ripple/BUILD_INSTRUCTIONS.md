## Production Build (EXE)

### Build the application:

```bash
cd Ripple
yarn tauri build
```

This will:
1. Build the frontend (SvelteKit)
2. Build the Rust backend
3. Create installers in `src-tauri/target/release/bundle/`

### Output locations:

- **Windows**:
  - MSI installer: `src-tauri/target/release/bundle/msi/Ripple_1.0.0_x64_en-US.msi`
  - NSIS installer: `src-tauri/target/release/bundle/nsis/Ripple_1.0.0_x64-setup.exe`
  - Portable EXE: `src-tauri/target/release/Ripple.exe`

- **macOS**:
  - DMG: `src-tauri/target/release/bundle/dmg/Ripple_1.0.0_x64.dmg`
  - APP: `src-tauri/target/release/bundle/macos/Ripple.app`

- **Linux**:
  - DEB: `src-tauri/target/release/bundle/deb/ripple_1.0.0_amd64.deb`
  - AppImage: `src-tauri/target/release/bundle/appimage/ripple_1.0.0_amd64.AppImage`

## Build Configuration

The build is configured in `src-tauri/tauri.conf.json`:
- Bundle targets: MSI, NSIS, DEB, AppImage, DMG
- Version: 1.0.0
- Identifier: com.ripple.app

## Troubleshooting

### Rust Compilation Issues

```bash
# Clean and rebuild
cargo clean
yarn tauri build
```

### Frontend Build Issues

```bash
# Clear node_modules and reinstall
rm -rf node_modules
yarn install
yarn tauri build
```

## Quick Build Commands

```bash
# Development
yarn tauri dev

# Production build (all platforms configured)
yarn tauri build

# Build specific target
yarn tauri build --target msi    # Windows MSI only
yarn tauri build --target nsis   # Windows NSIS only
yarn tauri build --target deb    # Linux DEB only
```

## Code Signing (Optional)

For distribution, you may want to sign your application:

### Windows
- Configure in `tauri.conf.json` under `bundle.windows.signTool`
- Requires a code signing certificate

### macOS
- Configure in `tauri.conf.json` under `bundle.macOS.signing`
- Requires an Apple Developer account

### Linux
- AppImage signing available
- Configure in `tauri.conf.json`

## Environment Variables

```bash
# Enable debug build (faster compilation, larger binary)
export TAURI_DEBUG=1
yarn tauri build

# Specify target architecture
export TAURI_TARGET=x86_64-pc-windows-msvc
yarn tauri build
```

## Distribution

After building:

1. Test the installer on a clean machine
2. The executable/installer is ready for distribution
3. No additional runtime dependencies needed (Tauri bundles WebView2)

## File Locations After Install

- **Windows**: `%APPDATA%\com.ripple.app\`
- **macOS**: `~/Library/Application Support/com.ripple.app/`
- **Linux**: `~/.local/share/com.ripple.app/`

Database: `ripple.db` in the above directories.

## Build Size

- Portable EXE: ~8-10 MB (Windows)
- Installer: ~12-15 MB (includes runtime)
- Much smaller than Electron (typically 50-100 MB)
