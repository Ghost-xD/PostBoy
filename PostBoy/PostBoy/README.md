# PostBoy - Tauri 2.0 Edition

A beautiful, modern API testing tool built with Tauri 2.0, Rust, and SvelteKit. This is a complete rewrite of the original Electron-based PostBoy application.

## 🚀 Features

### Core Functionality
- ✅ **HTTP Client**: Send GET, POST, PUT, DELETE, PATCH, OPTIONS, and HEAD requests
- ✅ **Collections**: Organize and save your API requests
- ✅ **History**: Track all your recent requests
- ✅ **Import/Export**: Share collections with your team
- ✅ **CURL Parser**: Paste CURL commands directly
- ✅ **Multiple Tabs**: Work on multiple requests simultaneously

### Request Builder
- **URL & Method**: Quick method selector and URL input
- **Query Parameters**: Key-value pairs with easy add/remove
- **Headers**: Manage custom headers for each request
- **Body Types**:
  - JSON (with auto-format)
  - XML
  - YAML
  - HTML
  - JavaScript
  - Plain Text
  - Form Data
  - Form URL Encoded
  - GraphQL
  - Binary/File Upload
  - No Body
- **Authorization**:
  - No Auth
  - Basic Auth
  - Bearer Token
  - API Key (header or query param)

### Response Viewer
- **Status Bar**: Status code, response time, size, and timestamp
- **Preview**: Formatted JSON with syntax highlighting
- **Headers**: View all response headers in a clean table
- **Console**: Request/response logs and errors

### UI Features
- **Collapsible Sidebars**: Maximize your workspace
- **Drag-to-Resize**: Adjust panel sizes to your preference
- **Dark Theme**: Beautiful dark UI (light theme coming soon)
- **Keyboard Shortcuts**: Work faster with keyboard navigation

### Database
- **SQLite Database**: Fast, local storage for all your data
- **Schema Migrations**: Automatic database updates
- **Export Collections**: JSON format for easy sharing

## ⌨️ Keyboard Shortcuts

### Actions
- `Ctrl + Enter` - Send request (from anywhere)
- `Ctrl + S` - Save request to collection
- `Ctrl + I` - Focus URL input
- `Enter` (in URL) - Send request

### Navigation
- `Ctrl + H` - Headers tab
- `Ctrl + B` - Body tab
- `Ctrl + P` - Params tab
- `Ctrl + Shift + A` - Authorization tab
- `Ctrl + Shift + C` - Collections sidebar
- `Ctrl + Shift + H` - History sidebar

### Body Type Shortcuts (after Ctrl+B)
- `J` - JSON
- `X` - XML
- `Y` - YAML
- `H` - HTML
- `T` - Text
- `F` - Form Data
- `U` - Form URL Encoded
- `G` - GraphQL
- `N` - No Body

## 🛠️ Tech Stack

### Frontend
- **SvelteKit**: Modern, reactive framework
- **TypeScript**: Type-safe development
- **Vite**: Lightning-fast HMR

### Backend
- **Rust**: High-performance, memory-safe
- **Tauri 2.0**: Lightweight desktop framework
- **reqwest**: Async HTTP client
- **rusqlite**: SQLite database access
- **tokio**: Async runtime

### Plugins
- `tauri-plugin-sql` - Database operations
- `tauri-plugin-dialog` - File dialogs
- `tauri-plugin-fs` - File system access
- `tauri-plugin-shell` - Shell commands
- `tauri-plugin-opener` - Open files/URLs

### Testing
- **Vitest**: Fast unit testing
- **@testing-library/svelte**: Component testing
- **better-sqlite3**: In-memory DB for tests

## 📦 Installation

### Prerequisites
- Node.js 18+ and Yarn
- Rust 1.70+
- Tauri CLI

### Setup
```bash
# Clone the repository
git clone <repo-url>
cd PostBoy/PostBoy

# Install dependencies
yarn install

# Run in development mode
yarn dev

# Build for production
yarn build

# Run tests
yarn test
yarn test:watch  # Watch mode
yarn test:ui     # UI mode
```

## 🗂️ Project Structure

```
PostBoy/PostBoy/
├── src/
│   ├── lib/
│   │   ├── api/          # Tauri command wrappers
│   │   ├── components/   # Svelte components
│   │   ├── stores/       # Svelte stores
│   │   ├── utils/        # Utilities
│   │   └── test/         # Test utilities
│   ├── routes/           # SvelteKit routes
│   └── app.html          # HTML template
├── src-tauri/
│   ├── src/
│   │   ├── database/     # Database schema & ops
│   │   ├── http_client.rs
│   │   └── lib.rs        # Main Rust entry
│   ├── Cargo.toml        # Rust dependencies
│   └── tauri.conf.json   # Tauri configuration
├── static/               # Static assets
├── tests/                # Test files
└── vitest.config.js      # Vitest configuration
```

## 🔄 Migration from Electron

This project is a complete rewrite from the original Electron-based PostBoy. Key changes:

### Architecture Changes
- **IPC**: Electron's `ipcRenderer` → Tauri commands via `@tauri-apps/api/core`
- **HTTP**: Node.js `fetch` → Rust `reqwest`
- **Database**: `better-sqlite3` (Node) → `rusqlite` (Rust)
- **File System**: Node.js `fs` → `tauri-plugin-fs` + Rust `std::fs`

### Performance Improvements
- **Smaller Bundle**: ~10MB vs ~150MB (Electron)
- **Faster Startup**: ~0.5s vs ~2s
- **Lower Memory**: ~50MB vs ~200MB
- **Native Performance**: Rust backend is blazing fast ⚡

### Security Improvements
- **Process Isolation**: Tauri's security model
- **No Node.js Runtime**: Smaller attack surface
- **Type-Safe IPC**: Rust type checking
- **CSP Headers**: Content Security Policy enabled

## 🧪 Testing

Run the test suite:

```bash
# Run all tests
yarn test

# Watch mode (for development)
yarn test:watch

# UI mode (interactive)
yarn test:ui

# Coverage report
yarn test:coverage
```

Test files are located in `src/lib/test/`:
- `api-collection.test.ts` - Collection APIs
- `database-schema.test.ts` - Database operations
- `import-export.test.ts` - Import/export functionality
- `ui-components.test.ts` - UI components
- `tauri.test.ts` - Tauri command wrappers

## 🐛 Known Issues

See [MIGRATION_STATUS.md](./MIGRATION_STATUS.md) for a complete list of implemented features, known issues, and future enhancements.

## 📝 License

[Your License Here]

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines first.

## 📧 Contact

[Your Contact Info]

---

**Built with ❤️ using Tauri 2.0, Rust, and SvelteKit**
