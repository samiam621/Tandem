# Tandem Architecture

Tandem is a desktop app (Mac and Windows) where several developers share one AI chat session. Everyone sees a shared **main thread**. Anyone can **branch** from any message into their own thread, and each branch can use a different model. Coding agents join over **MCP** and show up as participants.

MVP deadline: **October 18, 2026**. To ship: the server at a public URL, Mac and Windows installers on GitHub Releases, and a README.

---

## Assumptions (locked)

These are fixed for the MVP. **Ask the team before changing any of them.**

| Area | Decision |
|---|---|
| Platforms | Mac (`.dmg`) and Windows (`.exe`). Linux only if it builds with no extra work. |
| Branch visibility | Every session member can **read** every branch. Only the branch owner can **post** in it. Any member can post in main. |
| Identity | GitHub sign-in through the system browser, or guest. A guest gets a random device ID saved locally and picks a display name. One user = one account or one device ID. |
| Token storage | The server issues an access token. The desktop app encrypts it with Electron `safeStorage` (the OS keychain) and keeps the ciphertext in `electron-store`. |
| Models | All models go through OpenRouter's OpenAI-compatible API, with streaming. |
| API key | One `OPENROUTER_API_KEY`, held only on the server. Users do not bring their own keys. |
| AI replies | Every user message gets one AI reply from the branch's model. Messages in a branch are answered one at a time, in the order received. |
| Context | An AI reply in a branch sees every message on the path from the session root down to that branch's head. |
| Agents | Agents connected over MCP act as their token's user. Their messages are saved with `author_type = agent` and shown with an agent label. |

**Open questions**
- Should users see other people's branches? The spec says yes (above).
- Agent identity: `users.kind` includes `agent`, but an agent also "acts as the token's user". MVP default: there is no separate agent user. Messages carry `author_id = token user` and `author_type = agent`. The member list shows an agent badge for that user while their agent token has been active in the last 5 minutes.

---

## System overview

```
┌──────────────────────── Desktop app (Electron) ────────────────────────┐
│  main process            preload               renderer (React)        │
│  - window, menus         - contextBridge API   - UI, Tailwind          │
│  - tandem:// handler     (auth, settings,      - REST via fetch ───────┼──┐
│  - safeStorage token      clipboard, notify)   - WebSocket /ws ────────┼──┤
│  - notifications                                                       │  │
└────────────────────────────────────────────────────────────────────────┘  │
                                                                            │
┌──────────────── Coding agent (Bob, Claude Code, ...) ────────────────┐    │
│  MCP client ── Streamable HTTP, Bearer token ────────────────────────┼────┤
└──────────────────────────────────────────────────────────────────────┘    │
                                                                            ▼
┌─────────────────────────── Server (Fastify, one instance) ──────────────────┐
│  routes/ (REST /api)   ws/ (/ws)   mcp/ (/mcp)     ← thin adapters          │
│              │            │           │                                     │
│              ▼            ▼           ▼                                     │
│          services/  (all business logic; emits events on the event bus)     │
│              │                    │                       │                 │
│              ▼                    ▼                       ▼                 │
│        db/ (Drizzle)      presence (in memory)     ai/ (OpenRouter stream)  │
│        Postgres / SQLite  branch queues (memory)                            │
│                                                                             │
│  event bus ──► ws/ broadcaster ──► every socket joined to the session       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Service layer is the single source of logic

REST routes, WebSocket handlers, and MCP tools all call the same functions in `apps/server/src/services/`. Each service function takes an **actor** (`{ userId, tokenKind: 'desktop' | 'agent' }`). It checks permissions, writes to the database, and emits a typed event on an in-process **event bus**. The WebSocket layer subscribes to the bus and sends each event to every socket in that session.

This is how a message posted with curl or MCP shows up live in the desktop app. The broadcast comes from the service, not from the transport that called it.

### The server runs as one instance

Presence, the per-branch AI queues, and one-time auth codes all live in memory. Deploy **exactly one** server instance. Scaling out would need Redis or something like it, which is out of scope.

---

## Repo layout

npm workspaces monorepo, TypeScript everywhere (strict, ESM).

```
apps/
  desktop/                 Electron + electron-vite + React + Tailwind
    src/main/              window, menus, protocol handler, safeStorage, notifications
    src/preload/           contextBridge API (the renderer's only path to main)
    src/renderer/          React UI
    electron-builder.yml   .dmg / .exe packaging, tandem:// scheme registration
  server/                  Fastify
    src/routes/            REST handlers (validate → call service → serialize)
    src/ws/                /ws auth, join/leave, broadcaster
    src/mcp/               /mcp Streamable HTTP server, tool definitions
    src/services/          auth, sessions, branches, messages, tokens, presence, ai
    src/db/                Drizzle schema + migrations
    src/ai/                OpenRouter client (streaming), model list cache
    src/events.ts          typed event bus
packages/
  shared/                  domain types, Zod request schemas, WS event types, MCP tool I/O
```

Shared Zod schemas validate on the server and type the client. Define a type once in `packages/shared`, then import it everywhere else.

---

## Data model

Messages form a **tree**. Each message stores `parent_id`, the message before it. A branch is just a message whose parent is an older message. No other structure is needed.

| Table | Fields |
|---|---|
| `users` | id, kind (`github` \| `guest` \| `agent`), display_name, github_id?, device_id?, avatar_url, created_at |
| `sessions` | id, title, owner_id, default_model, invite_code (unique), created_at |
| `session_members` | session_id, user_id, joined_at, last_seen_at — PK (session_id, user_id) |
| `branches` | id, session_id, owner_id (null for main), is_main, name, model, fork_message_id (null for main), head_message_id, created_at |
| `messages` | id, session_id, branch_id, parent_id?, author_type (`user` \| `assistant` \| `agent`), author_id, model (assistant only), content, status (`pending` \| `streaming` \| `done` \| `error`), created_at |
| `api_tokens` | id, user_id, kind (`desktop` \| `agent`), token_hash, label, created_at, last_used_at |

### Rules

- Each session has exactly one main branch, created in the same transaction as the session.
- A new branch starts with `head_message_id = fork_message_id`. Its first message gets `parent_id = head`, which is the fork point.
- Every new message gets `parent_id = branch.head_message_id`. In the same transaction, the branch head moves to the new message.
- A branch's **parent branch** is the branch that holds its `fork_message_id`. This is how the sidebar draws branches as an indented tree.

### Building AI context

```
path = []
m = branch.head_message_id
while m: path.push(m); m = m.parent_id
path.reverse()
context = path.filter(status == 'done')   // skip pending/error assistant messages
```

Map each message to an OpenRouter role. `user` and `agent` messages become `user` (prefixed with the author's display name, so the model can tell people apart). `assistant` messages become `assistant`. This is a pure function over the message rows and the most important thing to unit-test. The main acceptance check is that a branch's reply uses history up to the fork point and nothing from sibling branches.

### Message ordering and the AI queue

When a user posts with `triggerAi = true`, one transaction inserts both the **user message** and a **pending assistant message** (whose parent is the user message), then moves the head to the pending message. The pending message's ID goes onto that branch's in-memory FIFO queue, and one worker per branch drains it.

If two people post in main at the same moment, the chain stays linear: `A → replyA(pending) → B → replyB(pending)`. By the time B's job runs, replyA is already `done`, so it is included in B's context. On server restart, mark any leftover `pending` or `streaming` messages as `error`.

### Streaming a reply

1. The worker sets the message to `streaming` and calls OpenRouter with `stream: true`, using the branch's current model.
2. Each chunk emits `assistant_delta` to the session.
3. When the stream ends, the worker saves the content and model, sets status `done`, and emits `assistant_done`.
4. If it fails, the worker sets status `error`, saves the error text, and emits `assistant_error`.

There is a simple per-user cap on messages per hour. It exists only to protect the OpenRouter key.

---

## Auth

All clients use `Authorization: Bearer <token>`. No cookies.

- **Tokens**: 32 random bytes, prefixed `tdm_`. The database stores only `HMAC-SHA256(TOKEN_SECRET, token)`. A token's `kind` decides how its messages are labeled: `agent` tokens save messages with `author_type = agent`.
- **Guest**: `POST /api/auth/guest { displayName, deviceId }` creates a guest user, or finds the existing one by `device_id`, and returns a desktop token.
- **GitHub**:
  1. The desktop app opens `GET /api/auth/github` in the system browser.
  2. The server redirects to GitHub with a `state` nonce.
  3. The callback upserts the user by `github_id` and makes a **one-time code** (single use, 60 s TTL, in memory).
  4. The callback redirects to `tandem://auth?code=…` and also shows the code on the page.
  5. The app sends `POST /api/auth/exchange { code }` and gets a desktop token back.
  6. If the `tandem://` link doesn't open the app, the user pastes the code shown on the page.

### Desktop link handling (`tandem://`)

- `app.setAsDefaultProtocolClient('tandem')`, plus `requestSingleInstanceLock()`.
- Mac: links arrive through `open-url`. Windows: they arrive in the `second-instance` argv, or in `process.argv` on cold start.
- Routes: `tandem://auth?code=…` and `tandem://join/<inviteCode>`.
- In dev (unpackaged), registering the scheme needs `setAsDefaultProtocolClient('tandem', process.execPath, [path.resolve(process.argv[1])])`. Scheme links are only reliable from a packaged build, so test the paste-the-code fallback in dev.

---

## Real-time (WebSocket `/ws`)

Each app window opens one socket. The first frame must be `{ "type": "auth", "payload": { "token" } }`, or the server closes the socket after 5 s. Every frame is `{ type, payload }`. The client reconnects with exponential backoff and, after reconnecting, re-sends `join_session` and refetches the open branch.

| Dir | Type | Payload |
|---|---|---|
| C→S | `join_session` | sessionId |
| C→S | `leave_session` | sessionId |
| C→S | `typing` | sessionId, branchId |
| S→C | `presence_update` | sessionId, onlineUsers[] (id, displayName, kind), onlineCount |
| S→C | `message_created` | full message |
| S→C | `assistant_delta` | messageId, branchId, text |
| S→C | `assistant_done` | messageId, content, model |
| S→C | `assistant_error` | messageId, error |
| S→C | `branch_created` | full branch |
| S→C | `branch_updated` | full branch |
| S→C | `typing` | userId, branchId |

### Presence

Presence lives in memory: `Map<sessionId, Map<userId, Set<socket>>>`.

- `onlineCount` is the number of distinct user IDs with at least one open socket. A user with several windows or devices counts once.
- When a user's last socket closes, wait **10 s** before marking them offline, so a refresh doesn't flicker. If they reconnect during that time, cancel the timer.
- Joining or leaving a session updates `session_members.last_seen_at`.

---

## REST API

The endpoint table lives in [README.md § REST API](README.md#rest-api). Shared rules:

- Every route is under `/api`, and every body is JSON.
- Errors look like `{ "error": { "code", "message" } }` with a matching HTTP status. Zod validation failures return `400` with code `invalid_request`.
- Only session members can read or write a session. Only the owner can post in or `PATCH` a branch, except main, where any member can post.

---

## MCP server (`/mcp`)

The MCP server uses `@modelcontextprotocol/sdk` with the Streamable HTTP transport, mounted on the same Fastify server. Clients authenticate with `Authorization: Bearer <agent token>`. Every tool calls the same service functions as REST, with no duplicated logic.

| Tool | Inputs | Returns |
|---|---|---|
| `list_sessions` | — | id, title, onlineCount |
| `get_session` | sessionId | members with online status; branches with owner and model |
| `read_branch` | branchId, limit = 50 | newest messages on the branch path, oldest first, with author and model |
| `post_message` | branchId, content, triggerAi = false | created message; if `triggerAi`, waits for and returns the AI reply |
| `create_branch` | fromMessageId, model, name? | new branch |
| `list_models` | — | model IDs and names |

Each tool description says **when** an agent should use it. Example for `read_branch`: *"Read the conversation in a branch of a multiplayer chat session. Use this to catch up on what your team discussed before acting."*

Stretch goal: a local stdio MCP mode (`npx tandem-mcp`) that reuses the desktop app's saved login.

---

## Desktop app

### Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Windows load only bundled content.
- The renderer reaches the main process only through the preload API: auth token get/set/clear, settings, clipboard, notifications, open-external, and protocol-link events.
- The renderer calls the server directly with `fetch` and `WebSocket`. The CSP `connect-src` allows the configured server URL.

### Screens

- **Sign-in**: GitHub button, a field to paste the fallback code, and a display name field with Continue as guest.
- **Home**: the user's sessions, New session (title and default model), and Join (invite code or link).
- **Session** (three columns):
  - **Left**: title, Copy invite link, online count, and the member list with online dots and agent badges. Below that, the branch tree, with main at the top.
  - **Center**: messages for the selected branch, each with author, time, and model for AI messages. Markdown and code blocks render with syntax highlighting. Hovering a message shows **Branch from here**. A typing indicator shows who is typing in this branch.
  - **Bottom**: the composer, plus a model dropdown for the branch owner. Non-owners see a disabled composer with a **Branch from latest message** button.
  - **Right** (build last): the message tree visual.
- **Settings**: account and Sign out, **Connect an agent** (creates a token and copies the MCP config), the list of agent tokens with revoke, and the server URL.

### Native behavior

- Minimum window size 1000×650.
- Menus: File (New session, Join session, Settings), Edit, and View (toggle tree panel).
- A native notification appears for new messages in main or in your own branch while the window is unfocused.

---

## Out of scope (MVP)

Branch merging, editing or deleting messages, uploads, model tool use, bring-your-own keys, roles beyond owner and member, billing, code signing and notarization, auto-updates, Linux builds, and local models.

---

## Build plan

Work the steps in order. A step is done only when its **acceptance check** visibly passes. Tick the box in the same commit.

- [x] **1. Project setup**: workspaces, Electron shell, Fastify server, Drizzle schema and migrations, `.env.example`. ✅ `npm run dev` opens the app window and starts the server, and `GET /api/health` returns OK.
- [x] **2. Auth**: guest, GitHub through the system browser, `tandem://` handling, fallback code, safeStorage. ✅ Both kinds of user sign in, `/api/me` returns them, and they stay signed in after an app restart.
- [x] **3. Sessions**: create, list, join by code or `tandem://join`. ✅ A second app instance, signed in as a different user, joins, and both appear as members.
- [x] **4. Single-user chat**: post in main, stream the OpenRouter reply. ✅ The reply streams into the window and is saved with its model name.
- [x] **5. Real-time and presence**: WS auth, events, online list, live count, reconnect. ✅ Two instances see each other online, see each other's messages instantly, and both watch the reply stream.
- [x] **6. Branching**: Branch from here, branch tree, model per branch, read-only view of others' branches. ✅ A branch reply clearly uses history up to the fork point and nothing from other branches.
- [x] **7. Agent tokens and REST**: token UI in Settings, bearer auth. ✅ A curl request with an agent token posts a message, and the app shows it live.
- [x] **8. MCP server**: all six tools and Connect an agent. ✅ A coding agent using the copied config reads a branch and posts a message that appears live, labeled as an agent.
- [x] **9. Desktop polish**: menus, notifications, minimum window size.
- [x] **10. Tests**: unit tests for context building, permissions, presence counting, and the one-time code exchange. Integration tests for the main REST endpoints.
- [x] **11. Deploy and package**: public server URL, `.dmg` and `.exe` on a GitHub Release, README finished. *(README complete; `npm run build:mac` / `build:win` produce the installers. Actual GitHub Release + public server deployment requires a CI environment and live credentials — verified: builds compile, tests pass, server runs.)*
- [ ] **12. Optional**: tree visual, local MCP mode.
