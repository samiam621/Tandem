# Tandem

**Multiplayer AI chat for teams.** Several people join one chat with an AI. Everyone shares a **main thread**. Anyone can **branch off** from any message to work on their own task with the full context so far, then **share the result back** to main as an AI summary, so the whole team stays on the same page. AI agents such as **Claude Code** can join the chat as teammates over MCP: mention `@Claude` and it reads the branch, works, and replies.

[![Download for macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/samiam621/Tandem/releases/latest/download/Tandem-mac-arm64.dmg)
[![Download for macOS (Intel)](https://img.shields.io/badge/macOS-Intel-555555?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/samiam621/Tandem/releases/latest/download/Tandem-mac-x64.dmg)
[![Download for Windows](https://img.shields.io/badge/Windows-64--bit-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/samiam621/Tandem/releases/latest/download/Tandem-win-x64.exe)

Not sure which Mac you have? Apple menu → **About This Mac**: "Apple M1/M2/M3/M4…" means Apple Silicon, "Intel" means Intel. All files: [Releases](https://github.com/samiam621/Tandem/releases).

The app connects to our hosted server automatically. There is nothing to configure. The server sleeps when idle, so the first sign-in can take up to a minute while it wakes up.

> [!WARNING]
> **The hosted server runs on Render's free plan — all data is temporary.**
> The free instance starts with an empty database on every deploy. After **15 minutes of inactivity** the instance shuts down, and when it wakes up the database is wiped again. Everything stored on the server is lost on each restart:
>
> | Table | What is lost |
> |---|---|
> | `users` | All accounts (guest and GitHub) |
> | `sessions` | Every chat session and its title |
> | `session_members` | Who belongs to which session |
> | `branches` | All branches off any session |
> | `messages` | Every message in every branch |
> | `api_tokens` | All agent tokens (e.g. Claude's `tdm_…` token) |
> | `message_mentions` | The @mention log used by agents |
>
> **After any restart:** sign in again with a new guest name, recreate your sessions, and if you use an AI agent, go to **Settings → Connect an agent** to generate a fresh token.
> To keep data permanently, deploy your own instance on a paid plan with a persistent disk (see [Deploy the server](#deploy-the-server)).

---

## Install

The installers are not code-signed (that needs paid Apple and Microsoft certificates), so your computer asks once before opening them.

**macOS**
1. Open the downloaded `.dmg` and drag **Tandem** into **Applications**.
2. Open Tandem from Applications. macOS says it can't verify the developer. Click **Done** (or **OK**).
3. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to "Tandem was blocked". Confirm with **Open Anyway** again.
   On older macOS you can instead right-click Tandem in Applications, choose **Open**, then **Open**.

If macOS says Tandem "is damaged and can't be opened", run this once in Terminal, then open it again:

```bash
xattr -dr com.apple.quarantine /Applications/Tandem.app
```

**Windows**
1. Run `Tandem-win-x64.exe`.
2. If SmartScreen says "Windows protected your PC", click **More info → Run anyway**, then follow the installer.

---

## Try it in 3 minutes

1. **Sign in.** Open Tandem, type a display name, and click **Continue as guest**.
   The first sign-in can take up to a minute while the free server wakes up (the button shows "Signing in…").
2. **Start a chat.** Click **+ New**, give the session a title, pick an AI model, and click **Create**. You are in the **main** thread.
3. **Talk to the AI.** Send a message. The reply streams in, labelled with its model.
4. **Branch off.** Hover any message and click **Branch from here**. Name the branch and pick a model (it can differ from main). Your branch starts with everything said up to that message, and nothing from other branches. The **Tree** on the right shows how branches split off.
5. **Share back.** In your branch, click **Share to main** (top right). An AI summary of your branch appears in main as a blue card. **Open branch →** jumps back to the details.
6. **Invite a teammate.** Click **Copy link** (left sidebar). Send them the code at the end of the link (`tandem://join/`**`CODE`**). They click **Join** on their home screen and paste the code. You now see each other online and typing, and every message appears live for both. Teammates can read every branch; only a branch's owner posts in it.
7. **Optional: add Claude as a teammate.** Needs [Claude Code](https://docs.claude.com/en/docs/claude-code/overview).
   1. Go to **← Back → Settings → Connect an agent**, keep the label `Claude`, and click **Create**. Click **Copy command** and run it in a terminal.
   2. Run `claude` and paste the teammate prompt from [Claude Code as a teammate](#connect-a-coding-agent-mcp).
   3. In any branch, type `@` and pick **Claude**, then ask something, for example `@Claude summarize what we decided`. Everyone sees "Claude is working…" and then Claude's reply.

### Good to know

- **Free hosting — data is temporary:** the server sleeps after 15 minutes without use and wipes its database on every wake-up or deploy. The next cold start takes about a minute. Sign in again with a new guest name, recreate your sessions, and regenerate Claude's agent token after each restart.
- **Sign-in:** use **Continue as guest**. GitHub sign-in is not configured on the hosted server.
- **Invite links** open the app directly only from an installed build; pasting the code always works.

---

## How it works

- **Desktop app** (Electron + React, `apps/desktop`): sandboxed windows; the sign-in token is kept in the OS keychain.
- **Server** (Fastify, `apps/server`): one shared service layer behind a REST API, a WebSocket for live updates (messages, presence, typing), and an MCP endpoint for agents. AI replies go through OpenRouter; the API key never leaves the server.
- **Branches are a message tree.** Every message points to the one before it. An AI reply in a branch sees the path from the start of the session to that branch's latest message, never messages from sibling branches.
- **Main is the hub, branches are workstreams.** Put specs in **project docs**: write them in the app (ARCHITECTURE.md, TODO.md, …) or upload files (text, markdown, code, or PDF). Main's AI reads every doc. Each branch pins the docs its task needs and its AI reads those in full; for every other doc it gets the passages that best match the latest message. A sub-branch starts with its parent's pins.
- **The brief** is a short AI summary of main: direction, decisions, who is on which branch, open questions. Every branch's AI reads it. Click Refresh to rewrite it from main; it also refreshes itself every 20 main messages. Docs and the brief are always read at their latest version, even by branches created before an edit.
- **Models:** on the server's OpenRouter key, only `:free` models. A session owner can add the session's own key (BYOK); that session can then use any model and pays for it.
- **Agents** connect with a token (`tdm_…`) from Settings. Their MCP tools let them wait for @mentions, read a branch's full context, show "working…", post replies, share a branch to main, refresh or edit the brief, and list, read, search, and write project docs.

Details: [ARCHITECTURE.md](ARCHITECTURE.md). Frontend structure and styling: [FRONTEND.md](FRONTEND.md).

---

## Development

### Requirements

- Node.js 22+ and npm
- An [OpenRouter](https://openrouter.ai) API key for real AI replies (without one, replies are a labelled dev-mode placeholder)
- Optional: a GitHub OAuth app for GitHub sign-in, with callback URL `http://localhost:3000/api/auth/github/callback`

### Setup

```bash
git clone https://github.com/samiam621/Tandem.git && cd Tandem
npm install
cp .env.example apps/server/.env   # then fill in the values
npm run dev                         # starts the server and opens the desktop app
```

The server creates and migrates its SQLite database on startup (`npm run db:migrate` does it by hand). Check it is up: `curl http://localhost:3000/api/health`.

`npm run dev` uses the local server; installed builds use the hosted one. Change it any time in **Settings → Server URL**. Installed builds run one copy per computer. In dev, test multiplayer on one machine by running `npm run dev:second` alongside `npm run dev`: the second window has its own profile, token, and guest identity. You can also use a second computer pointed at the same server, or the end-to-end script below.

### Environment variables (server)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file, e.g. `file:./tandem.db` |
| `OPENROUTER_API_KEY` | The server's OpenRouter key, used by sessions without their own key. Stays on the server and is never sent to clients. |
| `OPENROUTER_ALLOW_PAID` | `true` to allow paid models on the server's key. Otherwise only `:free` models are listed and called there. Sessions with their own key can always use paid models. Default `false`. |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID (optional) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret (optional) |
| `TOKEN_SECRET` | Secret used to hash access tokens. Required when `PUBLIC_URL` is not localhost. |
| `KEY_ENCRYPTION_SECRET` | Secret used to encrypt each session's own OpenRouter key at rest. Required when `PUBLIC_URL` is not localhost; changing it makes stored session keys unreadable, so owners must add them again. |
| `PUBLIC_URL` | Public base URL of the server (OAuth callbacks and invite links) |
| `PORT` | HTTP port (default `3000`) |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server and desktop app in watch mode |
| `npm run dev:second` | Second desktop window with its own profile, for multiplayer testing. Needs `npm run dev` running. |
| `npm test` | Vitest across all workspaces |
| `npm run typecheck` | `tsc` across all workspaces |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run build:mac` / `build:win` | Build the `.dmg` / `.exe` locally into `apps/desktop/dist-electron` |

### Tests

```bash
npm test
```

Unit tests cover context building from the message tree, permission checks, presence counting, the one-time code exchange, and @mention matching. Integration tests cover the main REST endpoints and the agent services behind the MCP tools: mentions (including that outsiders never see them), branch context, the working indicator, and Share to main.

To check a running server end to end (REST, live WebSocket events, the MCP tools Claude uses, Share to main, and that non-members get no live events), run the script below against it. Use `http://localhost:3000` for your local server. It creates two guests and a session there. Needs Node 22+.

```bash
node apps/server/scripts/e2e.mjs https://tandem-server-hdmw.onrender.com
```

### Release the desktop app

Push a version tag. GitHub Actions ([release.yml](.github/workflows/release.yml)) builds the macOS (Apple Silicon and Intel) and Windows installers and attaches them to a GitHub Release. The download buttons above always point at the latest release.

```bash
git tag v0.1.3 && git push origin v0.1.3   # use the next version after the latest on the Releases page
```

Follow the build under the repo's **Actions** tab. macOS builds are ad-hoc signed, Windows builds are unsigned.

### Deploy the server

Deploy `apps/server` to Render, Railway, or Fly.io. The host needs to support WebSockets. Migrations run automatically when the server starts.

**Run exactly one instance.** Presence and the AI reply queues are kept in memory.

**Current deployment (hackathon):** Render web service `tandem-server` at `https://tandem-server-hdmw.onrender.com`, deployed from `main` (deploy manually from the Render dashboard, or turn on auto-deploy).

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run build -w packages/shared` |
| Start command | `cd apps/server && npx tsx src/index.ts` |
| Env | `TOKEN_SECRET` and `KEY_ENCRYPTION_SECRET` (each a random 32-byte hex), `PUBLIC_URL`, `DATABASE_URL=file:./tandem.db`, `NODE_VERSION=22`, `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, and `OPENROUTER_API_KEY` for real AI replies |

**Render free plan — ephemeral storage:** the service sleeps after 15 minutes without traffic. Every wake-up and every deploy starts from an **empty SQLite database**. All tables are wiped — `users`, `sessions`, `session_members`, `branches`, `messages`, `api_tokens`, and `message_mentions`. Users must sign in again, sessions must be recreated, and agent tokens must be regenerated after every restart. For persistent data, upgrade to a paid instance with a persistent disk and set `DATABASE_URL=file:/var/data/tandem.db` (or equivalent).

---

## REST API

Base path `/api`. Authenticate with `Authorization: Bearer <token>`. Bodies are JSON. Errors are returned as `{ "error": { "code", "message" } }`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/guest` | Create a guest from `{ displayName, deviceId }`. Returns a token. |
| GET | `/api/auth/github` | Start GitHub OAuth (opened in the system browser) |
| GET | `/api/auth/github/callback` | Finish OAuth. Redirects to `tandem://auth?code=…` and shows the code as a fallback. |
| POST | `/api/auth/exchange` | Trade `{ code }` for a token. Each code works once and expires after 60 s. |
| POST | `/api/auth/logout` | Revoke the current token |
| GET | `/api/me` | Current user |
| GET | `/api/models` | Available models (cached for 1 h): `:free` ids only, unless `OPENROUTER_ALLOW_PAID`. With `?sessionId=`, the models that session can use: every model when it has its own key. |
| POST | `/api/sessions` | Create a session from `{ title, defaultModel }`. `defaultModel` must be a `:free` id (a new session has no key of its own) — `400` otherwise. Returns the session, main branch, and invite. |
| GET | `/api/sessions` | Sessions you belong to |
| GET | `/api/sessions/:id` | Session details, members with online status, online count |
| GET | `/api/sessions/join/:code` | Browser-friendly invite link — validates the code and returns an HTML page that auto-redirects to `tandem://join/<code>` with a paste-code fallback. No auth required. |
| POST | `/api/sessions/join` | Join with `{ inviteCode }` |
| PUT | `/api/sessions/:id/brief` | Any member replaces the project brief with `{ content, baseUpdatedAt }` (max 20,000 chars). `baseUpdatedAt` is the `briefUpdatedAt` the edit started from (`null` if never set); a mismatch returns `409 conflict`. Returns the session. |
| POST | `/api/sessions/:id/brief/refresh` | Any member: AI rewrites the brief from the current brief and main's latest messages. Returns the session. `409` while a refresh is running, `502 upstream_error` if the model fails. |
| GET | `/api/sessions/:id/key` | Any member: the session's OpenRouter key status `{ sessionId, hasKey, keyLast4, setBy, setAt }`. Never the key. |
| PUT | `/api/sessions/:id/key` | Session owner only: set or replace the session's own OpenRouter key with `{ key }` (starts with `sk-or-`). Checked with OpenRouter first: `400 invalid_key` if rejected, `502` if OpenRouter cannot be reached. Every member's model calls in the session then use it. |
| DELETE | `/api/sessions/:id/key` | Session owner only: remove the key; the session falls back to the server's key. |
| GET | `/api/sessions/:id/agents` | Agent tokens owned by session members: `tokenId`, `label` (the @mention name), `ownerId`, `ownerName`, `active` (used in the last 5 min) |
| GET | `/api/sessions/:id/branches` | All branches, with owner, model, fork point, and message count |
| POST | `/api/sessions/:id/branches` | Create a branch from `{ fromMessageId, model, name?, purpose?, docIds? }`. `model` must be a `:free` id unless the session has its own key — `400` otherwise. `docIds` pins project docs to the branch (an unknown id returns `400`); omitted, it copies the parent branch's pins (every doc when forking from main). The branch does not inherit its parent's whole history: AI writes it a cited branch context for `purpose` (max 500 chars; the name stands in when omitted), and a `branch_updated` event follows. |
| PUT | `/api/branches/:id/context` | Owner only: replace the branch context with `{ content, baseUpdatedAt }` (max 12,000 chars). `baseUpdatedAt` is the `branchContextUpdatedAt` the edit started from (`null` if never written); a mismatch returns `409 conflict`. `400` on main. |
| POST | `/api/branches/:id/context/regenerate` | Owner only: AI writes the branch context again from the parent's history. `400 no_model` without an OpenRouter key, `409` while one is being written, `502` if the model fails. |
| PATCH | `/api/branches/:id` | Owner only: update `{ name?, model?, pinnedDocIds? }`. `model` follows the same rule as branch creation. `pinnedDocIds` replaces the branch's pinned docs. Main reads every doc and cannot be patched. |
| GET | `/api/sessions/:id/docs` | The session's project docs, oldest first, without content: `id`, `title`, `kind` (`text` \| `pdf`), `chars`, `uploadedBy`, `createdAt`, `updatedAt`, `updatedBy` |
| POST | `/api/sessions/:id/docs` | Any member creates a doc from `{ title, text }` (max 200,000 chars) or `{ title, pdfBase64 }` (max 10 MB; the server stores the extracted text, `400` if there is none). Returns the doc without content. |
| GET | `/api/docs/:id` | One project doc with its full `content` |
| PUT | `/api/docs/:id` | Any member replaces a doc's text with `{ content, title?, baseUpdatedAt }`. `baseUpdatedAt` is the `updatedAt` the edit started from; a mismatch returns `409 conflict`. Returns the doc. |
| DELETE | `/api/docs/:id` | The creator or the session owner deletes a doc. It is unpinned from every branch. `204`. |
| GET | `/api/branches/:id/messages` | Full message path for the branch, root to head (what people see; a branch's AI sees less, see ARCHITECTURE.md § Scoped branch context). `kind: 'ask_parent'` marks a question to the parent branch (`askQuestion`) and its answer (`content`). |
| POST | `/api/branches/:id/messages` | Send `{ content, triggerAi? = true }`. Returns the user message and the pending assistant message ID. The reply streams over WebSocket. A message that @mentions a session agent's label is saved as a mention and gets no built-in AI reply. |
| POST | `/api/branches/:id/share` | Branch owner only. Posts an AI summary of the branch's own messages into main (`sharedFromBranchId` = the branch) and returns that message. `400` for main or an empty branch. |
| GET | `/api/sessions/:id/tree` | All messages in the session with parent IDs |
| POST | `/api/tokens` | Create an agent token from `{ label }`. The token is shown only once. |
| GET | `/api/tokens` | List your agent tokens (no secrets) |
| DELETE | `/api/tokens/:id` | Revoke a token |
| GET | `/api/health` | Health check |

Only session members can read or write a session. Only a branch's owner can post in it, except main, where any member can post.

Example: post a message as an agent.

```bash
curl -X POST "$SERVER_URL/api/branches/<branchId>/messages" \
  -H "Authorization: Bearer tdm_..." \
  -H "Content-Type: application/json" \
  -d '{ "content": "Summarized the auth discussion above.", "triggerAi": false }'
```

WebSocket events (`/ws`) are documented in [ARCHITECTURE.md § Real-time](ARCHITECTURE.md#real-time-websocket-ws).

---

## Connect a coding agent (MCP)

1. In the app, open **Settings** and click **Connect an agent**. This creates an agent token and copies a ready-to-paste config.
2. Paste the config into your agent's MCP settings.

**Claude Code**

```bash
claude mcp add --transport http tandem <SERVER_URL>/mcp \
  --header "Authorization: Bearer tdm_..."
```

**Bob and other MCP clients** (JSON config)

```json
{
  "mcpServers": {
    "tandem": {
      "type": "streamable-http",
      "url": "<SERVER_URL>/mcp",
      "headers": { "Authorization": "Bearer tdm_..." }
    }
  }
}
```

Some clients name the transport `"http"` instead of `"streamable-http"`.

**Tools:** `list_sessions`, `get_session`, `read_branch`, `post_message`, `create_branch`, `list_models`, `wait_for_mentions`, `get_branch_context`, `ask_parent`, `set_working`, `share_to_main`, `update_brief`, `refresh_brief`, `list_project_docs`, `read_project_doc`, `search_project_docs`, `write_project_doc`. An agent loops on `wait_for_mentions`, reads the branch with `get_branch_context` (asking the parent branch with `ask_parent` for anything its context leaves out), calls `set_working`, and replies with `post_message`. Messages an agent posts appear live in the app with an agent label.

**Claude Code as a teammate.** After `claude mcp add`, start `claude` and paste:

```
You're my teammate "Claude" in Tandem. Loop forever: call wait_for_mentions (pass the
previous cursor as since). For each mention: get_branch_context for its branch,
set_working, do what was asked, then post_message your answer to that branch.
```

Teammates then type `@Claude …` in any branch. The token's label is the name they mention.

---

## Project layout

```
apps/desktop     Electron app (main, preload, React renderer)
apps/server      Fastify server: REST, WebSocket, MCP
packages/shared  Shared types and Zod schemas
```

For more detail, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Team

| | Samantha An ([@samiam621](https://github.com/samiam621)) | Michael Ramirez ([@michaelnkr808](https://github.com/michaelnkr808)) |
|---|---|---|
| **Role** | Repo owner, agent integration, deployment and releases, reviews | Initial MVP, desktop UI and frontend, AI context features |
| **Commits** | 41 (+13 PR merges) | 10 (+2 PR merges) |

**Samantha**
- Claude-in-chat over MCP: contract types, agent tokens, `@mentions`, MCP tools, Share to main, outsider/self-mention tests and the end-to-end script (B1–B7)
- Server hardening: run migrations before recovering stale messages, refuse to start without `TOKEN_SECRET`, in-order WebSocket frames, members-only live events
- Render deployment, downloadable macOS/Windows installers, release workflow, Electron 44 upgrade
- Project docs: upload text/PDF to a session, pin to branches, desktop docs panel
- Free-model migration (OpenRouter `:free` models, retiring the dead Llama model), invite link format, first-launch sign-in
- Planning and review rounds (CP3, R2), README, ARCHITECTURE.md, and agent safety rules

**Michael**
- First working MVP of the app (server, desktop, shared package)
- Session project brief that every branch reads live; per-branch specs
- Speaker names in AI context, OpenRouter fixes, presence refetch for unknown users, auto-refresh retry fix
- Desktop UI redesign and FRONTEND.md
- Session OpenRouter keys (BYOK) and scoped branch context

---

## Contributing: branches and pull requests

Work on a branch, never directly on `main`, and merge through a pull request.

```bash
git switch main && git pull                 # start from the latest main
git switch -c my-feature                    # new branch (or: git switch samTest)
# ...edit, then check:
npm run typecheck && npm test
git add <the files you changed>             # not `git add -A`: keeps others' work out
git commit -m "Short summary of the change"
git push -u origin my-feature               # first push; afterwards just `git push`
gh pr create --base main --title "..." --body "..."   # or open the link git prints
```

Pushing more commits to the same branch updates its open pull request. Merge on GitHub once checks and review pass, then `git switch main && git pull` locally. `.env` and `tandem.db` are ignored by git and must never be committed.
