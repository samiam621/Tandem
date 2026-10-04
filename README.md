# Tandem

**Multiplayer AI chat for developers.** Several people join one session with AI models at the same time. Everyone shares a main thread. Anyone can branch off from any message into their own thread, using a different model. Coding agents (Bob, Claude Code, and others) can join over MCP to read the conversation and post into it.

- Desktop app for macOS and Windows (Electron)
- Hosted server for sessions, messages, branches, and live presence
- Many models through one OpenRouter integration
- REST API and MCP server for tools and agents

> **Status:** MVP complete. Build plan: [ARCHITECTURE.md](ARCHITECTURE.md).

**Demo server:** Deploy `apps/server` to Render/Railway/Fly.io (see Deploy section below) and set `<SERVER_URL>` in the desktop Settings.

---

## Download and install

Get the latest installer from [GitHub Releases](../../releases).

The builds are **not code-signed**, so your OS will warn you the first time you open the app:

- **macOS**: open the `.dmg`, drag Tandem to Applications, then **right-click the app and choose Open**, and confirm.
- **Windows**: run the `.exe`. When SmartScreen appears, click **More info**, then **Run anyway**.

---

## Development

### Requirements

- Node.js 20+ and npm
- Postgres (production). SQLite works for local development.
- An [OpenRouter](https://openrouter.ai) API key
- A GitHub OAuth app, needed only for GitHub sign-in. Set its callback URL to `http://localhost:3000/api/auth/github/callback`.

### Setup

```bash
git clone <repo-url> tandem && cd tandem
npm install
cp .env.example apps/server/.env   # then fill in the values
npm run db:migrate
npm run dev                         # starts the server and opens the desktop app
```

Check that the server is up: `curl http://localhost:3000/api/health`

To test multiplayer locally, start a second app instance signed in as a different user (for example, a guest).

### Environment variables (server)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string, or a SQLite file path for local dev |
| `OPENROUTER_API_KEY` | OpenRouter key. Stays on the server and is never sent to clients. |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `TOKEN_SECRET` | Secret used to hash access tokens |
| `PUBLIC_URL` | Public base URL of the server (used for OAuth callbacks and invite links) |
| `PORT` | HTTP port (default `3000`) |

The desktop app's server URL defaults to the hosted server. You can change it in **Settings** to point at `http://localhost:3000`.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server and desktop app in watch mode |
| `npm test` | Vitest across all workspaces |
| `npm run typecheck` | `tsc` across all workspaces |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run build:mac` / `build:win` | Build the `.dmg` / `.exe` with electron-builder |

### Tests

```bash
npm test
```

Unit tests cover context building from the message tree, permission checks, presence counting, and the one-time code exchange. Integration tests cover the main REST endpoints.

### Deploy the server

Deploy `apps/server` to Render, Railway, or Fly.io. The host needs to support WebSockets. Migrations run automatically when the server starts.

**Run exactly one instance.** Presence and the AI reply queues are kept in memory.

**Current deployment (hackathon):** Render web service `tandem-server` at `https://tandem-server-hdmw.onrender.com`, deployed from `samTest` with auto-deploy off (deploy manually from the Render dashboard).

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run build -w packages/shared` |
| Start command | `cd apps/server && npx tsx src/index.ts` |
| Env | `TOKEN_SECRET` (random 32-byte hex; the server refuses to start without it when `PUBLIC_URL` is not localhost), `PUBLIC_URL`, `DATABASE_URL=file:./tandem.db`, `NODE_VERSION=22`, `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, and `OPENROUTER_API_KEY` for real AI replies |

On Render's free plan the service sleeps after 15 minutes without traffic, and every restart or deploy **wipes the SQLite database**: users must sign in again and agent tokens must be recreated. For data that survives, use a paid instance with a persistent disk and point `DATABASE_URL` at it (for example `file:/var/data/tandem.db`).

To use it, set **Settings → Server URL** in the desktop app to the public URL.

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
| GET | `/api/models` | Available models (cached for 1 h) |
| POST | `/api/sessions` | Create a session from `{ title, defaultModel }`. Returns the session, main branch, and invite. |
| GET | `/api/sessions` | Sessions you belong to |
| GET | `/api/sessions/:id` | Session details, members with online status, online count |
| POST | `/api/sessions/join` | Join with `{ inviteCode }` |
| GET | `/api/sessions/:id/agents` | Agent tokens owned by session members: `tokenId`, `label` (the @mention name), `ownerId`, `ownerName`, `active` (used in the last 5 min) |
| GET | `/api/sessions/:id/branches` | All branches, with owner, model, fork point, and message count |
| POST | `/api/sessions/:id/branches` | Create a branch from `{ fromMessageId, model, name? }` |
| PATCH | `/api/branches/:id` | Owner only: update `{ name?, model? }` |
| GET | `/api/branches/:id/messages` | Full message path for the branch, root to head |
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

**Tools:** `list_sessions`, `get_session`, `read_branch`, `post_message`, `create_branch`, `list_models`, `wait_for_mentions`, `get_branch_context`, `set_working`, `share_to_main`. An agent loops on `wait_for_mentions`, reads the branch with `get_branch_context`, calls `set_working`, and replies with `post_message`. Messages an agent posts appear live in the app with an agent label.

---

## Project layout

```
apps/desktop     Electron app (main, preload, React renderer)
apps/server      Fastify server: REST, WebSocket, MCP
packages/shared  Shared types and Zod schemas
```

For more detail, see [ARCHITECTURE.md](ARCHITECTURE.md).
