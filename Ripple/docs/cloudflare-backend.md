# Cloudflare Backend — Implementation Plan

> **Status:** designed, not built. Resume on personal machine.
>
> **Why this doc exists:** the implementation was paused because the dev machine where this was designed is on a restricted corp network — any traffic to `*.cloudflare.com` / `*.workers.dev` was deemed risky. The Cloudflare account was created from a phone but CLI work (`wrangler login`, `wrangler deploy`, R2/D1 provisioning) must happen from an unrestricted machine.
>
> **How to use this doc:** open it with an AI assistant on your personal laptop. The doc is self-contained: design, decisions, every command, every file's full contents, every gotcha. Steps are gated — do not skip ahead. Each "verify" line is your checkpoint; if the verify fails, stop and debug before moving on.

---

## 1. What this backend does

Three responsibilities, in one Cloudflare Worker:

1. **Distribute Windows binaries.** Tauri builds `Ripple-<version>-x64-setup.exe` (or `.msi`). Source code stays private. Anyone with the download URL can pull a release; the Worker logs every download to D1.
2. **Tauri auto-updater endpoint.** Installed apps poll `/updates/{platform}/{current_version}`; Worker returns either `204 No Content` (already up to date) or a JSON manifest pointing at the new binary + an Ed25519 signature.
3. **Optional GitHub OAuth login.** If a user is logged in when they hit `/download/latest`, the download row gets a `user_id`. Login is never required for any feature.

That's the entire scope. No payments, no team accounts, no rate limiting, no admin dashboard. v1 ships these three things and nothing else.

## 2. Why this stack

| Component | Choice | Why this and not the alternative |
|---|---|---|
| Compute | **Cloudflare Worker** | V8 isolate, ~5ms cold start, free tier covers 100k req/day. Alternatives (Fly.io machines, Railway, Render) all have cold starts measured in seconds and require credit cards. |
| Storage (binaries) | **Cloudflare R2** | S3-compatible API, **zero egress fees**, 10 GB free. S3 charges $0.09/GB egress — at 100 users × 200 MB each that's $1.80, fine, but R2 stays $0 forever at this scale. |
| Storage (user/event data) | **Cloudflare D1** (SQLite) | Same network as the Worker, no separate auth. Free tier: 5 GB, 5M reads/day, 100k writes/day. We'll use < 0.1% of that for the lifetime of the project at <10 users. |
| Auth | **Hand-rolled GitHub OAuth + signed-cookie session** | Clerk/Auth0 are overkill for a single provider + <10 users. Lucia/Auth.js are nice but pull deps. ~80 lines of `crypto.subtle` ships the same thing. |
| Framework | **None — raw `fetch` handler** | Hono/itty-router are great when you have >5 routes. We have 5. Direct `switch` on `url.pathname` is honest and zero-dep. |
| Schema migrations | **`schema.sql` applied manually with `wrangler d1 execute`** | Migration tools (Drizzle, Prisma) earn their keep when schema churns. v1 has 3 tables; if we change them, we re-run the script. |
| Auto-updater | **Tauri's built-in updater plugin + static JSON manifest** | This is the Tauri-blessed path. Manifest is signed with an Ed25519 keypair; private key stays on your machine, public key bakes into the app. |

### Scale assumptions baked in

Everything below is sized for **<10 active users in the first 6 months**. If that 10x's, the design still holds (we'd just maybe add a KV cache in front of D1 reads, no architecture change). If it 1000x's, you'll want CDN caching on the binary download and Durable Objects for the download counters — that's a problem to solve when it exists.

## 3. Architecture

```
┌──────────────────┐                                     ┌──────────────────┐
│ Tauri app (user) │                                     │  R2 bucket       │
│  - download .exe │                                     │  ripple-releases │
│  - check updates │                                     │  (private)       │
│  - log in opt.   │                                     └──────────────────┘
└────────┬─────────┘                                              ▲
         │                                                        │
         │  HTTPS to *.workers.dev                                │ R2 binding
         ▼                                                        │ (no public access)
┌─────────────────────────────────────────────────────────────────┴────┐
│  Cloudflare Worker: ripple-backend                                   │
│                                                                      │
│  GET  /healthz                          → 200 "ok"                   │
│                                                                      │
│  GET  /download/latest                  → log event → stream binary  │
│  GET  /download/:version                → log event → stream binary  │
│                                                                      │
│  GET  /updates/:platform/:version       → Tauri manifest JSON or 204 │
│                                                                      │
│  GET  /auth/github                      → 302 to github.com OAuth    │
│  GET  /auth/callback?code=&state=       → exchange → upsert user     │
│                                            → set session cookie      │
│                                            → 302 to /me              │
│  GET  /me                               → JSON {id, login, avatar}   │
│                                            or 401                    │
│  POST /auth/logout                      → clear cookie → 204         │
└──────────────────────────────────────┬───────────────────────────────┘
                                       │ D1 binding
                                       ▼
                          ┌─────────────────────────────┐
                          │  D1: ripple-db              │
                          │                             │
                          │  users(id, github_id,       │
                          │        login, avatar_url,   │
                          │        created_at)          │
                          │                             │
                          │  releases(version, platform,│
                          │        r2_key, size_bytes,  │
                          │        sha256, sig,         │
                          │        notes, created_at)   │
                          │                             │
                          │  downloads(id, version,     │
                          │        platform, user_id?,  │
                          │        ip_hash, user_agent, │
                          │        created_at)          │
                          └─────────────────────────────┘
```

### Why downloads stream through the Worker instead of pre-signed URLs

R2's Worker binding has no native presigning method. You can either:
1. Stream the file through the Worker (uses CPU time + bandwidth, both unmetered on free tier under our load).
2. Use the S3-compatible API + `aws4fetch` to presign and `302` to it.

Option 1 is ~5 lines simpler, free at our scale, and lets us log the download *after* the user actually started the transfer (not just clicked). Going with option 1. At ~100 MB/binary and <10 daily downloads, we're nowhere near any limit.

## 4. Decisions explicitly *not* made yet (deferred to v2)

| Decision | Why deferred |
|---|---|
| Google OAuth (in addition to GitHub) | Audience is devs. Add when a non-dev complains. |
| Email/password fallback | Same reason. Plus email = SMTP = a whole new dependency. |
| Rate limiting | 10 users won't DOS you. Cloudflare's free Bot Fight Mode is on by default and is enough. |
| Email notifications on release | Add when you have >5 real users who actually care about updates. |
| Code signing certificate (Windows SmartScreen) | $200–400/yr. Ship unsigned, accept the SmartScreen "More info → Run anyway" friction until you have paying users. |
| Custom domain | `*.workers.dev` works fine. Tauri app calls it directly; users never see the URL. Add a domain only when the URL appears somewhere user-visible (landing page, support docs). |
| CI/CD for the Worker | Manual `wrangler deploy` from your laptop is fine until you have a teammate. |

## 5. Step-by-step implementation

Each step has a **who**, an **action**, and a **verify**. Do not proceed past a step whose verify failed.

### Step 1 — Cloudflare account ✅

**Done.** Account created from phone. Email verified.

### Step 2 — Install wrangler CLI + log in

**You.** From your personal (unrestricted) machine:

```bash
npm install -g wrangler
wrangler --version    # expect: ⛅️ wrangler 4.x.x or higher
wrangler login        # opens browser, click "Allow"
wrangler whoami       # expect: your email + Account ID
```

**Verify:** `wrangler whoami` prints your email and a 32-char hex Account ID. **Copy that Account ID** — you'll paste it into `wrangler.toml` in step 4.

**Gotcha:** if `wrangler` isn't found after install, your global npm bin isn't on PATH. On Windows, add `%APPDATA%\npm` to PATH; on macOS/Linux, check `npm config get prefix` and add `<that>/bin`.

### Step 3 — Clone the repo on the personal machine

**You.** You'll edit files in this repo, commit, push. The actual implementation lives in a new top-level `cloudflare/` directory (sibling of `Ripple/`).

```bash
git clone https://github.com/moodysaroha/PostBoyFork.git
cd PostBoyFork
git checkout -b feat/cloudflare-backend
mkdir cloudflare
cd cloudflare
```

**Verify:** `pwd` shows `…/PostBoyFork/cloudflare` and `ls ..` shows `Ripple/` (the Tauri app) as a sibling.

### Step 4 — Initialize the Worker project

**You.** Create the files below verbatim. Replace `YOUR_ACCOUNT_ID` with the Account ID from step 2.

#### `cloudflare/package.json`

```json
{
  "name": "ripple-backend",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail",
    "db:schema": "wrangler d1 execute ripple-db --remote --file=./schema.sql",
    "upload": "tsx scripts/upload-release.ts"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260101.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "wrangler": "^4.0.0"
  }
}
```

#### `cloudflare/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts"]
}
```

#### `cloudflare/wrangler.toml`

```toml
name = "ripple-backend"
main = "src/index.ts"
compatibility_date = "2026-06-01"
account_id = "YOUR_ACCOUNT_ID"

# Plain env vars (non-secret). Secrets go via `wrangler secret put`.
[vars]
GITHUB_CLIENT_ID = ""               # filled in step 9 after creating OAuth app
COOKIE_NAME = "ripple_session"
COOKIE_MAX_AGE_SECONDS = "2592000"  # 30 days
# Updater signs manifests with this Ed25519 public key (paste in step 20).
TAURI_UPDATER_PUBKEY = ""

[[r2_buckets]]
binding = "RELEASES"                # accessible in code as env.RELEASES
bucket_name = "ripple-releases"

[[d1_databases]]
binding = "DB"                      # accessible in code as env.DB
database_name = "ripple-db"
database_id = "FILLED_AFTER_STEP_5" # `wrangler d1 create` prints this
```

**Run:**

```bash
cd cloudflare
npm install
```

**Verify:** `node_modules/` exists, no install errors.

### Step 5 — Create the R2 bucket

**You.**

```bash
wrangler r2 bucket create ripple-releases
```

**Verify:** prints `Created bucket 'ripple-releases'`. Also visible at https://dash.cloudflare.com → R2.

### Step 6 — Create the D1 database

**You.**

```bash
wrangler d1 create ripple-db
```

The command prints something like:

```
✅ Successfully created DB 'ripple-db'
[[d1_databases]]
binding = "DB"
database_name = "ripple-db"
database_id = "abcd1234-ef56-7890-abcd-1234567890ef"
```

**Action:** copy the `database_id` and paste it into `cloudflare/wrangler.toml` replacing `FILLED_AFTER_STEP_5`.

**Verify:** `wrangler d1 list` shows `ripple-db` with the same UUID.

### Step 7 — Apply the schema

#### `cloudflare/schema.sql`

```sql
-- ============================================================
-- Ripple backend schema. Apply with:
--   wrangler d1 execute ripple-db --remote --file=./schema.sql
-- Idempotent: safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id   INTEGER NOT NULL UNIQUE,
  login       TEXT    NOT NULL,
  avatar_url  TEXT,
  created_at  INTEGER NOT NULL  -- unix epoch seconds
);

CREATE TABLE IF NOT EXISTS releases (
  version     TEXT    NOT NULL,  -- "0.1.0" — semver, no leading v
  platform    TEXT    NOT NULL,  -- "windows-x86_64"
  r2_key      TEXT    NOT NULL,  -- object key in R2 bucket
  size_bytes  INTEGER NOT NULL,
  sha256      TEXT    NOT NULL,  -- hex
  sig         TEXT    NOT NULL,  -- Tauri Ed25519 signature (base64)
  notes       TEXT,              -- release notes (markdown)
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (version, platform)
);

CREATE INDEX IF NOT EXISTS idx_releases_created
  ON releases (platform, created_at DESC);

CREATE TABLE IF NOT EXISTS downloads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     TEXT    NOT NULL,
  platform    TEXT    NOT NULL,
  user_id     INTEGER REFERENCES users(id),  -- nullable; anonymous downloads allowed
  ip_hash     TEXT,                          -- SHA256(ip + daily_salt), for de-dup not tracking
  user_agent  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_downloads_version
  ON downloads (version, created_at DESC);
```

**Run:**

```bash
npm run db:schema
```

**Verify:**

```bash
wrangler d1 execute ripple-db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Expect rows for `users`, `releases`, `downloads`.

### Step 8 — Create the GitHub OAuth app

**You.** Browser only — no CLI for this.

1. Go to https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Application name:** `Ripple` (this is what users see on the consent screen)
   - **Homepage URL:** `https://ripple-backend.<your-cloudflare-username>.workers.dev` (you'll know the exact URL after step 15; for now put your workers.dev base — you can edit it later)
   - **Authorization callback URL:** `https://ripple-backend.<your-cloudflare-username>.workers.dev/auth/callback`
3. Click **Register application**.
4. On the resulting page, copy the **Client ID** (visible immediately).
5. Click **Generate a new client secret** → copy the secret value **once** (you can't see it again).

**Verify:** you have two strings: a ~20-char hex `client_id` and a ~40-char `client_secret`.

**Gotcha:** if you don't yet know your exact `*.workers.dev` URL (because you haven't deployed yet), use a placeholder like `https://ripple-backend.example.workers.dev/auth/callback`, do step 15 to learn the real URL, then come back here and edit the GitHub app's callback URL. OAuth will fail until callback URL matches exactly.

### Step 9 — Store secrets in Cloudflare

**You.** Three secrets:

```bash
# From step 8:
wrangler secret put GITHUB_CLIENT_SECRET
# (paste the secret when prompted, press Enter)

# 32 random bytes, base64-encoded — used to sign session cookies (HMAC-SHA256)
# Generate one:
node -e "console.log(crypto.randomBytes(32).toString('base64'))"
# Copy the output, then:
wrangler secret put SESSION_SIGNING_KEY
# (paste it)

# Daily salt for IP hashing (so we can de-dup downloads without storing raw IPs)
# Same generation:
node -e "console.log(crypto.randomBytes(16).toString('base64'))"
wrangler secret put IP_HASH_SALT
```

Also fill in the **public** GitHub client ID in `wrangler.toml` (`GITHUB_CLIENT_ID` under `[vars]`). It's safe in version control — it's the *secret* that must never be committed.

**Verify:** `wrangler secret list` shows three entries: `GITHUB_CLIENT_SECRET`, `SESSION_SIGNING_KEY`, `IP_HASH_SALT`.

### Step 10 — Source files

#### `cloudflare/src/env.ts`

```ts
// Strongly-typed environment + small shared helpers.

export interface Env {
  // Bindings (configured in wrangler.toml).
  RELEASES: R2Bucket;
  DB: D1Database;

  // Plain vars.
  GITHUB_CLIENT_ID: string;
  COOKIE_NAME: string;
  COOKIE_MAX_AGE_SECONDS: string;
  TAURI_UPDATER_PUBKEY: string;

  // Secrets (wrangler secret put …).
  GITHUB_CLIENT_SECRET: string;
  SESSION_SIGNING_KEY: string;  // base64
  IP_HASH_SALT: string;         // base64
}

export const now = (): number => Math.floor(Date.now() / 1000);

/** Build an absolute URL on the current worker host. */
export function originOf(req: Request): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

// --------- HMAC cookie sign/verify -----------------------------------------
// Cookie format: <base64url(payload_json)>.<base64url(hmac)>

const enc = new TextEncoder();
const dec = new TextDecoder();

async function importHmacKey(b64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Uint8Array.from(atob(std), c => c.charCodeAt(0));
}

export async function signCookie<T>(payload: T, signingKeyB64: string): Promise<string> {
  const key = await importHmacKey(signingKeyB64);
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return `${body}.${b64urlEncode(mac)}`;
}

export async function verifyCookie<T>(
  cookie: string,
  signingKeyB64: string,
): Promise<T | null> {
  const dot = cookie.indexOf(".");
  if (dot < 0) return null;
  const body = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  const key = await importHmacKey(signingKeyB64);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(mac),
    enc.encode(body),
  );
  if (!ok) return null;
  try {
    return JSON.parse(dec.decode(b64urlDecode(body))) as T;
  } catch {
    return null;
  }
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function setCookieHeader(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  // Secure + HttpOnly always. SameSite=Lax because OAuth callback is a top-level GET.
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function hashIp(ip: string, saltB64: string): Promise<string> {
  const data = enc.encode(`${ip}:${saltB64}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
```

#### `cloudflare/src/db.ts`

```ts
import type { Env } from "./env";

export interface UserRow {
  id: number;
  github_id: number;
  login: string;
  avatar_url: string | null;
  created_at: number;
}

export interface ReleaseRow {
  version: string;
  platform: string;
  r2_key: string;
  size_bytes: number;
  sha256: string;
  sig: string;
  notes: string | null;
  created_at: number;
}

export async function upsertUser(
  env: Env,
  githubId: number,
  login: string,
  avatarUrl: string | null,
  createdAt: number,
): Promise<UserRow> {
  await env.DB.prepare(
    `INSERT INTO users (github_id, login, avatar_url, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET
       login = excluded.login,
       avatar_url = excluded.avatar_url`,
  )
    .bind(githubId, login, avatarUrl, createdAt)
    .run();

  const row = await env.DB.prepare(
    `SELECT id, github_id, login, avatar_url, created_at
       FROM users WHERE github_id = ?`,
  )
    .bind(githubId)
    .first<UserRow>();

  if (!row) throw new Error("upsertUser: row missing after insert");
  return row;
}

export async function getUserById(env: Env, id: number): Promise<UserRow | null> {
  return await env.DB.prepare(
    `SELECT id, github_id, login, avatar_url, created_at FROM users WHERE id = ?`,
  )
    .bind(id)
    .first<UserRow>();
}

export async function getLatestRelease(
  env: Env,
  platform: string,
): Promise<ReleaseRow | null> {
  return await env.DB.prepare(
    `SELECT * FROM releases WHERE platform = ?
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(platform)
    .first<ReleaseRow>();
}

export async function getRelease(
  env: Env,
  version: string,
  platform: string,
): Promise<ReleaseRow | null> {
  return await env.DB.prepare(
    `SELECT * FROM releases WHERE version = ? AND platform = ?`,
  )
    .bind(version, platform)
    .first<ReleaseRow>();
}

export async function logDownload(
  env: Env,
  args: {
    version: string;
    platform: string;
    userId: number | null;
    ipHash: string | null;
    userAgent: string | null;
    createdAt: number;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO downloads (version, platform, user_id, ip_hash, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      args.version,
      args.platform,
      args.userId,
      args.ipHash,
      args.userAgent,
      args.createdAt,
    )
    .run();
}
```

#### `cloudflare/src/auth.ts`

```ts
import {
  Env,
  getCookie,
  setCookieHeader,
  clearCookieHeader,
  signCookie,
  verifyCookie,
  originOf,
  now,
} from "./env";
import { getUserById, upsertUser, UserRow } from "./db";

interface SessionPayload {
  uid: number;          // users.id
  iat: number;          // issued at (unix seconds)
}

// GET /auth/github → 302 to github.com/login/oauth/authorize
export function startGitHubLogin(req: Request, env: Env): Response {
  const state = crypto.randomUUID();   // CSRF token; we round-trip via cookie
  const redirect = `${originOf(req)}/auth/callback`;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Set-Cookie": setCookieHeader("ripple_oauth_state", state, 600), // 10 min
    },
  });
}

// GET /auth/callback?code=&state=
export async function completeGitHubLogin(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = getCookie(req, "ripple_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  // Exchange code → access token.
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${originOf(req)}/auth/callback`,
    }),
  });
  if (!tokenRes.ok) return new Response("Token exchange failed", { status: 502 });

  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) {
    return new Response(`GitHub error: ${tokenJson.error ?? "no token"}`, { status: 502 });
  }

  // Fetch user profile.
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "User-Agent": "ripple-backend",
      Accept: "application/vnd.github+json",
    },
  });
  if (!userRes.ok) return new Response("Profile fetch failed", { status: 502 });

  const profile = (await userRes.json()) as {
    id: number;
    login: string;
    avatar_url?: string;
  };

  const user = await upsertUser(
    env,
    profile.id,
    profile.login,
    profile.avatar_url ?? null,
    now(),
  );

  const session: SessionPayload = { uid: user.id, iat: now() };
  const cookie = await signCookie(session, env.SESSION_SIGNING_KEY);
  const maxAge = parseInt(env.COOKIE_MAX_AGE_SECONDS, 10);

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/me",
      "Set-Cookie": [
        setCookieHeader(env.COOKIE_NAME, cookie, maxAge),
        clearCookieHeader("ripple_oauth_state"),
      ].join(", "),
    },
  });
}

// Returns the logged-in user (or null). Cheap: HMAC verify + 1 D1 read.
export async function currentUser(req: Request, env: Env): Promise<UserRow | null> {
  const raw = getCookie(req, env.COOKIE_NAME);
  if (!raw) return null;
  const session = await verifyCookie<SessionPayload>(raw, env.SESSION_SIGNING_KEY);
  if (!session) return null;
  return await getUserById(env, session.uid);
}

export function logout(env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearCookieHeader(env.COOKIE_NAME) },
  });
}
```

#### `cloudflare/src/download.ts`

```ts
import { Env, hashIp, now } from "./env";
import { getLatestRelease, getRelease, logDownload, ReleaseRow } from "./db";
import { currentUser } from "./auth";

const PLATFORM_DEFAULT = "windows-x86_64";

// GET /download/latest        → latest release for default platform
// GET /download/:version      → specific version
export async function handleDownload(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  version: "latest" | string,
): Promise<Response> {
  const platform = PLATFORM_DEFAULT; // single-platform v1

  const release: ReleaseRow | null =
    version === "latest"
      ? await getLatestRelease(env, platform)
      : await getRelease(env, version, platform);

  if (!release) return new Response("No release available", { status: 404 });

  const obj = await env.RELEASES.get(release.r2_key);
  if (!obj) {
    // Schema row exists but R2 object missing — operational error.
    return new Response("Release file missing", { status: 502 });
  }

  // Log the download. We do this BEFORE returning so the row is committed
  // even if the client cancels mid-transfer (intentional — partial pulls
  // still count). Use ctx.waitUntil so we don't block the response on
  // logging if D1 is slow.
  const user = await currentUser(req, env);
  const ip = req.headers.get("CF-Connecting-IP") ?? "";
  const ipHash = ip ? await hashIp(ip, env.IP_HASH_SALT) : null;
  ctx.waitUntil(
    logDownload(env, {
      version: release.version,
      platform: release.platform,
      userId: user?.id ?? null,
      ipHash,
      userAgent: req.headers.get("User-Agent"),
      createdAt: now(),
    }),
  );

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(release.size_bytes),
      "Content-Disposition": `attachment; filename="Ripple-${release.version}-${release.platform}.exe"`,
      "X-Ripple-Version": release.version,
      "X-Ripple-SHA256": release.sha256,
    },
  });
}

// GET /updates/:platform/:current_version
// Tauri updater expects:
//   - 204 No Content  → already up to date
//   - 200 + JSON      → update available; JSON shape below
// https://v2.tauri.app/plugin/updater/#static-json-file
export async function handleUpdateCheck(
  req: Request,
  env: Env,
  platform: string,
  currentVersion: string,
): Promise<Response> {
  const latest = await getLatestRelease(env, platform);
  if (!latest) return new Response(null, { status: 204 });
  if (latest.version === currentVersion) return new Response(null, { status: 204 });
  if (compareSemver(latest.version, currentVersion) <= 0) {
    return new Response(null, { status: 204 });
  }

  const origin = new URL(req.url).origin;
  const manifest = {
    version: latest.version,
    notes: latest.notes ?? "",
    pub_date: new Date(latest.created_at * 1000).toISOString(),
    platforms: {
      [tauriPlatformKey(platform)]: {
        signature: latest.sig,
        url: `${origin}/download/${latest.version}`,
      },
    },
  };

  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/json" },
  });
}

// Tauri expects platform keys like "windows-x86_64", "darwin-aarch64", etc.
// Our DB already uses that convention, so this is identity — but keep it
// behind a helper in case we ever store a friendlier name.
function tauriPlatformKey(platform: string): string {
  return platform;
}

// Tiny semver comparator. Returns >0 if a > b, <0 if a < b, 0 if equal.
// Handles "x.y.z" only — no pre-release tags. Sufficient for our v1.
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}
```

#### `cloudflare/src/index.ts`

```ts
import { Env } from "./env";
import { startGitHubLogin, completeGitHubLogin, currentUser, logout } from "./auth";
import { handleDownload, handleUpdateCheck } from "./download";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health check.
    if (path === "/healthz") return new Response("ok");

    // Downloads.
    if (path === "/download/latest" && req.method === "GET") {
      return handleDownload(req, env, ctx, "latest");
    }
    const dlMatch = path.match(/^\/download\/([0-9]+\.[0-9]+\.[0-9]+)$/);
    if (dlMatch && req.method === "GET") {
      return handleDownload(req, env, ctx, dlMatch[1]!);
    }

    // Tauri auto-updater.
    const upMatch = path.match(/^\/updates\/([^/]+)\/([0-9]+\.[0-9]+\.[0-9]+)$/);
    if (upMatch && req.method === "GET") {
      return handleUpdateCheck(req, env, upMatch[1]!, upMatch[2]!);
    }

    // Auth.
    if (path === "/auth/github" && req.method === "GET") {
      return startGitHubLogin(req, env);
    }
    if (path === "/auth/callback" && req.method === "GET") {
      return completeGitHubLogin(req, env);
    }
    if (path === "/auth/logout" && req.method === "POST") {
      return logout(env);
    }
    if (path === "/me" && req.method === "GET") {
      const user = await currentUser(req, env);
      if (!user) return new Response("Unauthorized", { status: 401 });
      return new Response(
        JSON.stringify({
          id: user.id,
          login: user.login,
          avatar_url: user.avatar_url,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
```

#### `cloudflare/scripts/upload-release.ts`

```ts
// Local helper. Run with: npx tsx scripts/upload-release.ts <file> <version>
//
// Steps:
//   1. Compute SHA-256 of the binary.
//   2. Read the signature file (.sig) Tauri produces alongside the bundle.
//   3. Upload binary to R2 via wrangler.
//   4. Insert a row into the releases table via wrangler d1 execute.
//
// Requires: wrangler logged in, R2 bucket + D1 already created (steps 5-7).

import { createReadStream, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { basename } from "node:path";

const [, , filePath, version] = process.argv;
if (!filePath || !version) {
  console.error("Usage: tsx scripts/upload-release.ts <binary-path> <version>");
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Version must be x.y.z");
  process.exit(1);
}

const sigPath = `${filePath}.sig`;
const platform = "windows-x86_64";

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", c => hash.update(c))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

const size = statSync(filePath).size;
const sha = await sha256(filePath);
const sig = readFileSync(sigPath, "utf8").trim();
const r2Key = `${platform}/Ripple-${version}-${platform}.exe`;
const createdAt = Math.floor(Date.now() / 1000);

console.log(`Uploading ${basename(filePath)} (${size} bytes) → r2://${r2Key}`);
execSync(
  `wrangler r2 object put ripple-releases/${r2Key} --file="${filePath}" --content-type=application/octet-stream`,
  { stdio: "inherit" },
);

console.log(`Inserting release row (version=${version})`);
const sql = `INSERT INTO releases (version, platform, r2_key, size_bytes, sha256, sig, notes, created_at)
             VALUES ('${version}', '${platform}', '${r2Key}', ${size}, '${sha}', '${sig.replace(/'/g, "''")}', '', ${createdAt});`;
execSync(`wrangler d1 execute ripple-db --remote --command="${sql.replace(/"/g, '\\"')}"`, {
  stdio: "inherit",
});

console.log("Done.");
```

### Step 11 — Deploy

**You.**

```bash
cd cloudflare
npm run deploy
```

The CLI prints your Worker URL, e.g. `https://ripple-backend.<username>.workers.dev`. **Copy that URL.**

**Verify:**

```bash
curl https://ripple-backend.<username>.workers.dev/healthz
# expect: ok
```

### Step 12 — Update the GitHub OAuth callback

**You.** Go back to https://github.com/settings/developers → your Ripple app → edit the **Authorization callback URL** to match the real URL printed in step 11. Save.

**Verify:** open `https://ripple-backend.<username>.workers.dev/auth/github` in a browser → GitHub consent screen appears for "Ripple" → click Authorize → you land on `/me` showing your user JSON.

### Step 13 — Build Tauri release + generate signing keys

**You.** From the existing `Ripple/` directory:

```bash
# One-time: generate the updater keypair. Keep the private key SAFE.
# Store it outside the repo. If lost, no installed app will accept updates.
npx tauri signer generate -w ~/.tauri/ripple-updater.key
```

Copy the printed **public** key. Paste it into `cloudflare/wrangler.toml` under `TAURI_UPDATER_PUBKEY` AND into `Ripple/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

Now configure the updater endpoint in `tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://ripple-backend.<username>.workers.dev/updates/{{target}}/{{current_version}}"
      ],
      "pubkey": "<paste the public key>",
      "dialog": true
    }
  }
}
```

Build a signed release bundle:

```bash
# Sign env vars must be set; Tauri reads them when bundling.
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/ripple-updater.key -Raw
# If you set a password on the key when generating:
# $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-password"

yarn tauri build
```

**Verify:** `Ripple/src-tauri/target/release/bundle/nsis/Ripple_<version>_x64-setup.exe` exists, AND a `.sig` file sits next to it.

### Step 14 — Upload the release

**You.** From the `cloudflare/` directory:

```bash
npx tsx scripts/upload-release.ts \
  "../Ripple/src-tauri/target/release/bundle/nsis/Ripple_0.1.0_x64-setup.exe" \
  0.1.0
```

**Verify:**

```bash
curl -I https://ripple-backend.<username>.workers.dev/download/latest
# expect: 200, Content-Type: application/octet-stream, X-Ripple-Version: 0.1.0
```

```bash
wrangler d1 execute ripple-db --remote --command="SELECT * FROM releases;"
wrangler d1 execute ripple-db --remote --command="SELECT * FROM downloads ORDER BY id DESC LIMIT 5;"
```

Run a full download and confirm the SHA256:

```bash
curl -L -o test.exe https://ripple-backend.<username>.workers.dev/download/latest
sha256sum test.exe
# expect: matches what the upload script printed and what's in the releases table
```

### Step 15 — Wire login into the Tauri app (optional, can defer)

**You + me (when you resume).** Add a "Sign in with GitHub" button somewhere in the app. The flow:

1. Button click → `tauri::api::shell::open(...)` opens `https://ripple-backend.<username>.workers.dev/auth/github` in the user's default browser.
2. User authorizes → lands on `/me` in the browser, sees their JSON.
3. App polls `/me` (from within Tauri's HTTP client, with credentials) — once it gets a 200, store user info locally.

The wrinkle: Tauri runs at `tauri://localhost` (or similar), not on your `*.workers.dev` domain, so cookies set by the Worker don't auto-attach. Two options:
   - **(A)** Use a one-time token instead of cookies: after OAuth, Worker sets a cookie *and* renders a page like "Copy this code into Ripple: `abc123`". User pastes, app sends it back to a `POST /auth/exchange` endpoint to get a long-lived session token.
   - **(B)** Use Tauri's deep linking — register `ripple://` URL handler, OAuth callback redirects to `ripple://auth?token=...`. Cleaner UX but requires more setup.

**Defer this decision until you have v1 deployed and downloading.** Auth is the easiest piece to add later; downloads are the hard part to retrofit.

### Step 16 — Smoke test the updater loop

**You.** Once you have two versions uploaded:

1. Install `Ripple-0.1.0` locally.
2. Build & upload `0.1.1` via step 14.
3. Open Ripple. Within ~10 seconds (Tauri's default poll), the updater dialog should appear: *"A new version 0.1.1 is available. Download and install?"*
4. Click yes. App downloads, verifies Ed25519 signature against the public key baked in at build time, installs, restarts.

**If the signature check fails:** the public key in `tauri.conf.json` doesn't match the private key used to sign during `tauri build`. Regenerate the bundle (step 13) with the right env var.

## 6. Operating it

### Common commands

```bash
# Tail live logs from the deployed Worker
wrangler tail

# Inspect the database
wrangler d1 execute ripple-db --remote --command="SELECT COUNT(*) FROM downloads;"
wrangler d1 execute ripple-db --remote --command="SELECT version, COUNT(*) FROM downloads GROUP BY version;"

# List R2 contents
wrangler r2 object list ripple-releases

# Delete a release (DB + R2)
wrangler d1 execute ripple-db --remote --command="DELETE FROM releases WHERE version='0.1.0';"
wrangler r2 object delete ripple-releases/windows-x86_64/Ripple-0.1.0-windows-x86_64.exe

# Rotate a secret
wrangler secret put SESSION_SIGNING_KEY    # invalidates all existing sessions
```

### Cost monitoring

Cloudflare dashboard → Workers & Pages → Plans. You'll get an email at 80% of free tier on any metric. At <10 users you'll see ~0.1% on every dimension.

### Backups

D1 has automatic point-in-time recovery (last 30 days) on free tier. R2 has no built-in backup — but it's just files. If you care, run `wrangler r2 object list` weekly and download anything new.

## 7. Things to watch out for

| Symptom | Cause | Fix |
|---|---|---|
| OAuth callback returns "Invalid OAuth state" | Cookie didn't persist across the redirect. Usually a SameSite issue or you tested from `localhost`. | Make sure you're testing on the deployed `*.workers.dev` URL, not via `wrangler dev` (cookies behave differently). |
| Updater dialog never appears | (a) `tauri.conf.json` endpoint wrong, (b) public key mismatch, (c) installed version equals latest | `wrangler tail` to see the `/updates/...` request hit. If it returns 204, your installed version is `>=` latest. If it never hits, endpoint URL is wrong. |
| `wrangler deploy` fails with "binding not found" | Forgot to fill `database_id` in `wrangler.toml` after step 6 | Run `wrangler d1 list`, paste UUID into config. |
| Download returns 502 "Release file missing" | DB has a `releases` row but the R2 object was deleted | Either re-upload, or `DELETE FROM releases WHERE version=...`. |
| Cookie `ripple_session` is set but `/me` returns 401 | You rotated `SESSION_SIGNING_KEY` — all old cookies are now invalid by design | Log in again. |
| Tauri build produces no `.sig` file | `TAURI_SIGNING_PRIVATE_KEY` env var not set during build | Export it before `tauri build`. |

## 8. When to revisit decisions

| Trigger | Revisit |
|---|---|
| >100 daily downloads | Add R2 caching headers / CDN; presigned URLs instead of streaming through Worker |
| >2 platforms (macOS, Linux) | Generalize `PLATFORM_DEFAULT`, change `/download/latest` to require `?platform=` |
| Real users want password reset / email | Add a transactional email provider (Resend, Postmark) |
| Multiple admins | Move from manual `wrangler` deploys to GitHub Actions with OIDC |
| Source code goes public | The whole "private repo" reason for R2 evaporates; consider switching to GitHub Releases for binary distribution (simpler, free, no Worker needed) |

---

## Appendix A — Total free-tier usage estimate at 10 users

Assuming 10 users, each downloading 2 releases/month, each launching the app once/day (12 update checks/day per user = 3,600/month):

| Resource | Usage | Free tier | % used |
|---|---|---|---|
| Worker requests | 3,620/month | 3,000,000/month | 0.12% |
| Worker CPU | ~1,000 ms-CPU/month | 10,000,000 ms-CPU/month | 0.01% |
| R2 storage | ~500 MB (10 releases × ~50 MB) | 10 GB | 5% |
| R2 Class B (reads) | 20/month | 10,000,000/month | 0.0002% |
| D1 reads | 3,640/month | 25,000,000/month | 0.01% |
| D1 writes | 240/month | 50,000/month | 0.5% |
| D1 storage | <1 MB | 5 GB | 0.02% |

You will not be charged. You are roughly 4 orders of magnitude away from any paywall.

## Appendix B — File checklist (copy-paste verifying nothing's missed)

When done with step 10, `cloudflare/` should contain:

```
cloudflare/
├── package.json
├── tsconfig.json
├── wrangler.toml          ← account_id + database_id filled in
├── schema.sql
├── src/
│   ├── env.ts
│   ├── db.ts
│   ├── auth.ts
│   ├── download.ts
│   └── index.ts
└── scripts/
    └── upload-release.ts
```

And these external resources should exist:

- ☐ Cloudflare account (step 1)
- ☐ `ripple-releases` R2 bucket (step 5)
- ☐ `ripple-db` D1 database with schema (steps 6–7)
- ☐ GitHub OAuth App with correct callback URL (steps 8, 12)
- ☐ Three secrets stored: `GITHUB_CLIENT_SECRET`, `SESSION_SIGNING_KEY`, `IP_HASH_SALT` (step 9)
- ☐ Worker deployed (step 11)
- ☐ Tauri signing keypair generated, public key in `tauri.conf.json` (step 13)
- ☐ At least one release uploaded (step 14)
