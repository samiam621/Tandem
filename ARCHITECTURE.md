# Tandem Architecture

Tandem is a desktop app (Mac and Windows) where several developers share one AI chat session. Everyone sees a shared **main thread**. Anyone can **branch** from any message into their own thread, and each branch can have its own agent roster. Coding agents can join over **MCP**. The shipped MVP supports chat, branching, and MCP participants; durable agent runs and tool execution are the next milestone described here, not shipped behavior.

MVP deadline: **October 18, 2026**. To ship: the server at a public URL, Mac and Windows installers on GitHub Releases, and a README.

---

## Current MVP contracts

These describe the shipped MVP and should remain compatible as agent chat is added.

| Area | Decision |
|---|---|
| Platforms | Mac (`.dmg`) and Windows (`.exe`). Linux only if it builds with no extra work. |
| Branch visibility | Every session member can **read** every branch. Only the branch owner can **post** in it. Any member can post in main. |
| Identity | GitHub sign-in through the system browser, or guest. A guest gets a random device ID saved locally and picks a display name. One user = one account or one device ID. |
| Token storage | The server issues an access token. The desktop app encrypts it with Electron `safeStorage` (the OS keychain) and keeps the ciphertext in `electron-store`. |
| Models | The MVP's automatic reply uses the branch's model through OpenRouter's OpenAI-compatible API, with streaming. |
| API key | One `OPENROUTER_API_KEY`, held only on the server. Users do not bring their own keys. |
| MCP identity | MCP clients act as their token's user. Their messages carry that user's `author_id` and `author_type = agent`; this is distinct from a configured, first-class Tandem agent. |
| Context | Model context is built from the current branch's root-to-head path; sibling-branch messages are excluded. |

## Agent chat target

An agent is a configured participant, not just a model choice. It has a stable identity, model and system prompt, and an explicit set of tools. A branch has an ordered roster of agents and optionally one default agent. User messages route to explicitly mentioned agents; if there are no mentions, the branch default is used. If neither applies, no agent responds, allowing people to talk without triggering automation. The existing MVP auto-reply behavior is retained as a default-agent configuration during migration.

Runs are durable database records. A run represents one agent's work triggered by a message and may contain multiple model steps, tool calls, and bounded handoffs to other agents. It posts visible progress and final output into the same branch message tree. Each run is scoped to one branch and one initiating user; its context is a snapshot of the branch path at the trigger point plus its own run events. It never reads sibling-branch messages.

Agent definitions and tools are session-scoped and managed by their owner. Branching copies the source branch's roster (including its default) at the fork; later roster changes affect only that branch. Tool access is explicit per agent and checked by the server on every call. Tool inputs and outputs are bounded, validated against schemas, and recorded with the run. Secrets are never included in prompts, messages, or ordinary logs.

The orchestration and persistence contract is independent of where a tool executes. The executor may eventually be server-hosted or supplied by a connected client; neither arbitrary shell execution on the server nor implicit trust in an MCP client is assumed. The execution boundary and approval policy must be decided before enabling real tools.

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
│        db/ (Drizzle)      presence (in memory)     runs/ (durable worker) │
│        Postgres / SQLite                         ai/ (OpenRouter stream)   │
│                                                                             │
│  event bus ──► ws/ broadcaster ──► every socket joined to the session       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Service layer is the single source of logic

REST routes, WebSocket handlers, and MCP tools all call the same functions in `apps/server/src/services/`. Each service function takes an **actor** (`{ userId, tokenKind: 'desktop' | 'agent' }`). It checks permissions, writes to the database, and emits a typed event on an in-process **event bus**. The WebSocket layer subscribes to the bus and sends each event to every socket in that session.

This is how a message posted with curl or MCP shows up live in the desktop app. The broadcast comes from the service, not from the transport that called it.

### The server runs as one instance (MVP)

MVP presence, per-branch AI queues, and one-time auth codes live in memory. Deploy **exactly one** server instance. Durable runs move queue state and run progress into the database; an in-memory notification may wake a worker, but it is not the source of truth. This makes queued work recoverable after a process restart, but does not by itself make multiple server instances safe. Multi-instance workers require database-backed claims/leases and coordination, and shared presence still needs Redis or an equivalent.

---

## Repo layout

npm workspaces monorepo, TypeScript everywhere (strict, ESM).

```
apps/
  desktop/                 Electron + electron-vite + React + Tailwind
    src/main/               window, menus, protocol handler, safeStorage, notifications
    src/preload/            narrow contextBridge API
    src/renderer/
      app/                  routes, app shell, auth/session providers
      features/
        auth/               sign-in, guest flow, GitHub exchange
        sessions/           home, create/join session
        chat/               message list, composer, branch navigation
        agents/             agent roster, mentions, run controls/status
        settings/           account, tokens, server URL
      components/           reusable UI components
      lib/                  typed REST client, WebSocket client, formatting
    electron-builder.yml   .dmg / .exe packaging, tandem:// scheme registration
  server/
    src/routes/             REST adapters: validate → authorize/service → serialize
    src/ws/                 WebSocket auth, session membership, event broadcaster
    src/mcp/                MCP transport and tool definitions
    src/services/           business logic: auth, sessions, branches, messages, agents
    src/runs/               durable run lifecycle, queue/worker, recovery, cancellation
    src/tools/              tool registry, schema validation, executor interface
    src/ai/                 model-provider interface, OpenRouter adapter, streaming
    src/db/                 Drizzle schema, migrations, repositories/queries
    src/lib/                shared server utilities (tokens, rate limits, validation)
    src/events.ts           typed domain events and in-process publisher
packages/
  shared/
    src/
      schemas/              Zod request/response and tool-input schemas
      types/                domain and API types
      events/               WebSocket event contracts
      mcp/                  shared MCP tool input/output contracts
```

This is the target organization, not a requirement to move all existing MVP files at once. Keep the current paths working and introduce these boundaries as features are built. Shared Zod schemas validate requests on the server and provide types to the client; do not duplicate domain rules in the renderer. Routes and transport adapters stay thin. Put permission checks and state transitions in services, database access behind `db/`, and provider/executor-specific code behind interfaces. Split a feature into more files only when it has distinct responsibilities; avoid one-file-per-type and generic `utils` dumping grounds.

---

## Data model

Messages form a **tree**. Each message stores `parent_id`, the message before it. A branch is just a message whose parent is an older message. No other structure is needed.

| Table | Fields |
|---|---|
| `users` | id, kind (`github` \| `guest` \| `agent`), display_name, github_id?, device_id?, avatar_url, created_at |
| `sessions` | id, title, owner_id, default_model, invite_code (unique), created_at |
| `session_members` | session_id, user_id, joined_at, last_seen_at — PK (session_id, user_id) |
| `branches` | id, session_id, owner_id (null for main), is_main, name, model, fork_message_id (null for main), head_message_id, created_at |
| `agents` | id, session_id, owner_id, name, model, system_prompt, created_at, updated_at, archived_at? |
| `tools` | id, session_id, owner_id, name, description, input_schema, executor_kind, config_ref?, enabled, created_at |
| `agent_tools` | agent_id, tool_id — PK (agent_id, tool_id) |
| `branch_agents` | branch_id, agent_id, position, is_default — PK (branch_id, agent_id); at most one default per branch |
| `messages` | id, session_id, branch_id, parent_id?, author_type (`user` \| `assistant` \| `agent` \| `tool`), author_id, agent_label? (MCP token label at post time), shared_from_branch_id? (Share to main summary), agent_id?, run_id?, tool_call_id?, kind (`text` \| `tool_call` \| `tool_result`), model?, content, status (`pending` \| `streaming` \| `done` \| `error`), created_at |
| `message_mentions` | message_id, token_id, created_at — the agent token mentioned as `@label`, resolved when the message is accepted. *Hackathon: agents are MCP tokens; agent_id replaces token_id once first-class agents exist.* |
| `runs` | id, session_id, branch_id, trigger_message_id, context_head_message_id, agent_id, agent_config_snapshot, initiated_by, parent_run_id?, status (`queued` \| `running` \| `waiting_tool` \| `cancel_requested` \| `succeeded` \| `failed` \| `cancelled`), attempt, lease_owner?, lease_expires_at?, heartbeat_at?, hop_count, token_budget, token_usage, error?, created_at, started_at?, finished_at? |
| `run_steps` | id, run_id, sequence, kind (`model` \| `tool` \| `handoff`), status, request_metadata, result_metadata?, token_usage?, started_at?, finished_at? |
| `tool_calls` | id, run_id, step_id, tool_id, tool_name_snapshot, status (`queued` \| `awaiting_approval` \| `running` \| `succeeded` \| `failed` \| `cancelled`), arguments, result?, error?, idempotency_key, created_at, started_at?, finished_at? |
| `api_tokens` | id, user_id, kind (`desktop` \| `agent`), token_hash, label, created_at, last_used_at |

Persisted request/result fields must be redacted of credentials and bounded in size. Tool configuration stores a secret reference, not secret values. Define JSON fields as validated shared schemas; do not treat arbitrary JSON as trusted executable instructions.

### Rules

- Each session has exactly one main branch, created in the same transaction as the session.
- A new branch starts with `head_message_id = fork_message_id`. Its first message gets `parent_id = head`, which is the fork point.
- Every new message gets `parent_id = branch.head_message_id`. In the same transaction, the branch head moves to the new message.
- A branch's **parent branch** is the branch that holds its `fork_message_id`. This is how the sidebar draws branches as an indented tree.
- Creating a branch snapshots the source branch's agent roster in the same transaction. Roster edits and default-agent changes are branch-local.
- An agent and tool must belong to the same session as the branch/run. Only the agent owner may edit its definition; the branch owner manages that branch's roster. Both operations are authorized in services, not only in the UI.
- Tool-call and tool-result messages are linked to their durable `tool_calls` record. They are visible in the timeline but are converted to the model's structured tool protocol by the context builder; they are not treated as ordinary user-authored prose.
- `runs`, `run_steps`, and `tool_calls` are the source of truth for work state. WebSocket events are notifications, not durable state.

### Building AI context

```
path = []
m = branch.head_message_id
while m: path.push(m); m = m.parent_id
path.reverse()
context = path.filter(status == 'done')   // skip pending/error assistant messages
```

The context builder is a pure function over the branch path, run snapshot, and linked tool events. User messages become `user` (prefixed with the author's display name); agent/assistant messages use the corresponding assistant role and agent identity; completed tool calls/results become the provider's structured tool messages. Pending, failed, or cancelled work is not silently presented as a successful tool result. The key acceptance check remains that a branch sees its fork history and its own events, never sibling-branch messages.

### Routing and message ordering

When a user posts, one transaction inserts the user message, resolves and stores any agent mentions, updates the branch head, and creates a queued run for each selected agent. Explicit mentions select agents in the order they appear in the message; absent mentions, the branch default is selected. With no selected agent, the message remains a human-only post. During MVP compatibility, the default-agent configuration represents the old automatic single-model reply.

Runs for a branch execute serially in enqueue order, so messages and outputs form a deterministic parent chain. A run snapshots its starting context and roster/configuration when queued. Later edits do not silently change work already in progress. Different branches may run concurrently. Branch ownership rules apply to user-initiated posts and roster edits; agent output is attributed to its run and is authorized by the run's initiating actor and branch assignment.

### Durable run lifecycle

1. **Queue:** In the same transaction as the triggering message, persist the run and initial queued state. The database is authoritative; an in-memory wake-up queue is optional.
2. **Claim:** A worker claims a queued run and records a lease/heartbeat before marking it running. The first release may use a single server worker, but transitions must be defined so a later database-backed multi-worker claim can be added safely.
3. **Execute:** Persist each model step and tool call before making the external request. Stream deltas and step-state events to the session. Persist output and usage as the step completes.
4. **Tool call:** Validate the tool is enabled for this agent and session, validate arguments against its schema, enforce timeout/output limits and any approval rule, then dispatch through the executor boundary. Persist result or explicit failure before the next model step.
5. **Handoff:** A handoff creates a child run linked by `parent_run_id`, with the same branch and triggering message. It is allowed only for a rostered/authorized agent and within the configured hop limit.
6. **Finish:** Set exactly one terminal status (`succeeded`, `failed`, or `cancelled`), persist final output/error and usage, and emit a final event. Retries must not duplicate visible messages or tool side effects.

Runs are not deleted on process restart. Queued work resumes; a run with an expired worker lease is reconciled and either safely retried or marked failed. An in-flight external request may have completed even if its response was lost; steps therefore need idempotency keys where supported, and non-idempotent tools must not be blindly replayed. Persisted cancellation requests are checked between model/tool steps, and executors receive cancellation when supported. A stop request is idempotent and may be issued by any session member, as specified by the roadmap.

Every run has server-enforced maximum hops, tool-call count, elapsed time, and token budget. Rate limits apply per initiating user and branch. Tool allowlists, schemas, session/branch scope, timeouts, and output-size limits are enforced server-side. Fail closed on unknown tools or malformed arguments; record a clear run failure rather than returning success-shaped output.

### Streaming a run

Model and tool progress is persisted before its event is broadcast. WebSocket clients treat events as hints to refresh durable run/message state after reconnect; they must not rely on receiving every delta. Keep event payloads bounded and do not broadcast credentials or unredacted tool configuration.

The current MVP single-reply worker can be migrated into this lifecycle as a run containing one model step and one assistant output. This keeps one ordering, recovery, event, and error model rather than maintaining a separate legacy queue.

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

Each app window opens one socket. The first frame must be `{ "type": "auth", "payload": { "token" } }`, or the server closes the socket after 5 s. Every frame is `{ type, payload }`. The client reconnects with exponential backoff and, after reconnecting, re-sends `join_session` and refetches the open branch. The server handles each socket's frames strictly in order, so a `join_session` sent right after `auth` waits for auth to finish. It ignores `join_session` for sessions the user is not a member of, and `typing` for sessions the socket has not joined.

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
| `wait_for_mentions` | since?, timeoutSeconds = 25 (max 50) | `{ mentions, cursor }`: @mentions of this agent token after `since` in the user's sessions; waits until one arrives or the timeout passes. Agents loop, passing `cursor` back as `since`. |
| `get_branch_context` | branchId, limit = 200 | session, branch with owner, `forkedFrom`, the root-to-head path (including history inherited from the fork), and the session's other branches |
| `share_to_main` | branchId | branch owner only: posts an AI summary of the branch's own messages into main, linked by `shared_from_branch_id`; returns that message |
| `set_working` | branchId, working = true | re-sends a `typing` event with the agent's label every 3 s ("Claude is working…") until the agent posts on that branch, turns it off, or 5 min pass |

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
- [x] **11. Deploy and package**: public server URL, `.dmg` and `.exe` on a GitHub Release, README finished. *(README complete; `npm run build:mac` / `build:win` produce the installers. Public server: deployed on Render at `https://tandem-server-hdmw.onrender.com` (free plan, see README § Deploy the server); verified end to end over REST, WebSocket and MCP. Installers: pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the macOS (arm64, x64) and Windows installers and attaches them to a GitHub Release; installed builds default to the hosted server.)*
- [ ] **12. Optional**: tree visual, local MCP mode.
- [ ] **13. Agent foundation**: decide tool-execution and approval boundaries; add agent/tool/branch-roster schemas and migrations, permission checks, shared contracts, and branch-roster snapshot tests.
- [ ] **14. Durable runs**: add run/step/tool-call persistence, branch queue ordering, worker leases and restart recovery, cancellation, budgets, and idempotency tests; migrate the MVP automatic reply to a single-step run.
- [ ] **15. Agent experience**: add mention resolution, roster management, run/tool activity events and UI, stop controls, and end-to-end tests for handoff, failure, reconnect, and permission enforcement.
