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
| Models | The automatic reply uses the branch's model through OpenRouter's OpenAI-compatible API, with streaming. OpenRouter is the only model provider. On the server's key a model must be a `:free` id (`isFreeModelId` in `packages/shared`) unless `OPENROUTER_ALLOW_PAID=true`; a session with its own key can use any model. The server checks this when a session or branch is given a model and again before every call. |
| API keys | Each session can use its creator's own OpenRouter key (BYOK). The creator sets it; every member's model calls in that session use it. The key is held only on the server, encrypted at rest, and never sent to any client, including the creator's. A session with no key falls back to the server's `OPENROUTER_API_KEY`. |
| MCP identity | MCP clients act as their token's user. Their messages carry that user's `author_id` and `author_type = agent`; this is distinct from a configured, first-class Tandem agent. |
| Context | Model context is built from the session's brief (a summary of main), the project docs pinned to the branch (in full, up to a budget; main reads every doc), an index of all docs, keyword-matched excerpts of the unpinned docs, and the branch's history; brief and docs are always the latest version, and sibling-branch messages are excluded. Main's history is its full path. Every other branch is **scoped**: it does not inherit its parent's raw history, but gets a cited **branch context** written at fork time for the branch's purpose, the last few messages before the fork verbatim, and its own messages. A branch's agent fetches anything missing from the branch one level up with `ask_parent`. See § Scoped branch context. |

## Agent chat target

An agent is a configured participant, not just a model choice. It has a stable identity, model and system prompt, and an explicit set of tools. A branch has an ordered roster of agents and optionally one default agent. User messages route to explicitly mentioned agents; if there are no mentions, the branch default is used. If neither applies, no agent responds, allowing people to talk without triggering automation. The existing MVP auto-reply behavior is retained as a default-agent configuration during migration.

Runs are durable database records. A run represents one agent's work triggered by a message and may contain multiple model steps, tool calls, and bounded handoffs to other agents. It posts visible progress and final output into the same branch message tree. Each run is scoped to one branch and one initiating user; its context is a snapshot of the branch's history (§ Scoped branch context) at the trigger point plus its own run events. It never reads sibling-branch messages.

Agent definitions and tools are session-scoped and managed by their owner. Branching copies the source branch's roster (including its default) at the fork; later roster changes affect only that branch. Tool access is explicit per agent and checked by the server on every call. Tool inputs and outputs are bounded, validated against schemas, and recorded with the run. Secrets are never included in prompts, messages, or ordinary logs.

The orchestration and persistence contract is independent of where a tool executes. The executor may eventually be server-hosted or supplied by a connected client; neither arbitrary shell execution on the server nor implicit trust in an MCP client is assumed. The approval policy must be decided before enabling real tools.

### Keys and execution boundary

The goal is a multiplayer coding-agent platform: in a session, people start agents that work on one part of the project while teammates and their agents work on others. The split:

- **The server runs the agent loop and holds the key.** Runs, model steps, budgets, and ordering stay server-side as described in § Durable run lifecycle. Model calls use the session's OpenRouter key, decrypted only in `apps/server/src/ai/` at call time.
- **Tools run on the initiator's machine.** Code tools (read, edit, search, shell) are dispatched over the WebSocket to the desktop app of the run's initiating user, which is the branch owner. The executor lives in the Electron main process, never the renderer, and works in a git worktree the user picked for that branch, so parallel agents on different branches do not collide. If the executor is offline, the run waits in `waiting_tool` and can be cancelled.
- **Server-side tools** touch only Tandem data (documents, brief, branches, Share to main, `ask_parent`) and run in services like any other write.

**Session keys.** Only the session owner can set, replace, or remove the key, and the API only ever returns its last four characters. Keys are encrypted with AES-256-GCM under a server secret (`KEY_ENCRYPTION_SECRET`). Setting a key checks it with OpenRouter first (`GET /api/v1/key`), so a typo fails then rather than on the next reply. Removing the key falls back to the server key immediately; runs already in progress finish their current step and fail on the next. With its own key, a session may use paid models; on the server key, `OPENROUTER_ALLOW_PAID` still applies. A `session_key_updated` event tells members, so their model lists refresh.

*Not built yet:* because every member spends the owner's credits, the owner should be able to set a spend limit for the session, enforced per run through `token_budget` and across runs from recorded usage, and see usage per member. Until then, the owner caps spending with a credit limit on the key itself in OpenRouter, which the key panel points out. An OpenRouter OAuth (PKCE) "Connect OpenRouter" flow can replace pasting the key, using the same `tandem://` callback as GitHub sign-in.

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
    src/ai/                 model-provider interface, OpenRouter adapter, streaming, model list
                            (only `:free` models are listed or called unless OPENROUTER_ALLOW_PAID=true)
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
| `sessions` | id, title, owner_id, default_model, invite_code (unique), created_at, brief (markdown summary of main, default ''), brief_updated_at?, brief_updated_by? (a user id, or `system` (`BRIEF_AUTO_REFRESH_AUTHOR`) for an automatic refresh) |
| `session_keys` | session_id (PK), key_ciphertext (`v1:iv:tag:ciphertext`, AES-256-GCM), key_last4, set_by, set_at. Read and decrypted only in `apps/server/src/ai/keys.ts`; clients see `hasKey`, `keyLast4`, `setBy`, and `setAt`. A spend limit column comes with the spend limit. |
| `session_members` | session_id, user_id, joined_at, last_seen_at — PK (session_id, user_id) |
| `branches` | id, session_id, owner_id (null for main), is_main, name, model, fork_message_id (null for main), head_message_id, created_at, pinned_doc_ids (JSON array of the project docs this branch's AI reads in full, default `[]`; unused on main, which reads all), purpose? (what the branch is for, given at fork; null on main), branch_context? (cited markdown; null on main), branch_context_updated_at?, branch_context_updated_by? |
| `project_docs` | id, session_id, title, kind (`text` \| `pdf`), content (the text; extracted for a PDF), uploaded_by (the creator), created_at, updated_at, updated_by. Specs and docs such as ARCHITECTURE.md or TODO.md, written in the app or uploaded; any member edits the text, and `updated_at` is the optimistic version. |
| `agents` | id, session_id, owner_id, name, model, system_prompt, created_at, updated_at, archived_at? |
| `tools` | id, session_id, owner_id, name, description, input_schema, executor_kind, config_ref?, enabled, created_at |
| `agent_tools` | agent_id, tool_id — PK (agent_id, tool_id) |
| `branch_agents` | branch_id, agent_id, position, is_default — PK (branch_id, agent_id); at most one default per branch |
| `messages` | id, session_id, branch_id, parent_id?, author_type (`user` \| `assistant` \| `agent` \| `tool`), author_id, agent_label? (MCP token label at post time), shared_from_branch_id? (Share to main summary), agent_id?, run_id?, tool_call_id?, kind (`text` \| `ask_parent` \| `tool_call` \| `tool_result`; `text` and `ask_parent` exist today), ask_question? and asked_branch_id? (on `ask_parent`: the question and the branch that answered; content holds the answer), model?, content, status (`pending` \| `streaming` \| `done` \| `error`), created_at |
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
- A branch's `pinned_doc_ids` may only name project docs of its own session. They are set when it is created; without a choice, it copies its parent branch's pins (every doc when forking from main). Only the branch owner changes them later. Deleting a doc removes it from every branch's pins in the same transaction.
- A new branch is created with a `purpose`. Its `branch_context` starts empty, is generated after the branch exists, and only the branch owner edits it afterwards.
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

The context builder is a pure function over the branch path, run snapshot, and linked tool events. A short system prompt opens the context and explains the multiplayer format. Then come the shared parts of the context, each its own system message, ordered so the parts that change least come first:

1. The **project docs** the branch reads, in full, under `### <title>` headings, truncated at `PINNED_DOCS_MAX_CHARS` (40,000) with a marker. Main reads every doc; any other branch reads its pinned docs.
2. An index of every doc's title, with the pinned ones marked.
3. The **branch context** (every branch except main, with its purpose).
4. The session's **brief**.
5. Up to `DOC_EXCERPTS_K` (3) passages of the unpinned docs that best match the latest non-assistant message. Docs are split on blank lines into passages of about 1,500 characters, ranked by the summed IDF of the query terms they contain; a passage with no matching term is never added. This is how a branch starts with the slice of the docs it was given and still pulls in what it is missing. They come last because they change with every message.

These are read live at reply time, not from the path, so a branch forked before an edit still sees the latest version. For every branch except main, the path is replaced as described in § Scoped branch context.

**Main is the hub; branches are workstreams.** Documents hold the specs (ARCHITECTURE.md, TODO.md, …); a branch picks the ones its task needs, so a frontend branch is not handed the whole backend spec. The brief is not a spec: it is a short AI summary of main (direction, decisions, who is on what branch, open questions). It is rewritten from the current brief, the branch list, the document names, and main's latest 60 messages when a member clicks Refresh (or an agent calls `refresh_brief`), and automatically once 20 finished messages have landed in main since its last update (only when a model is configured, so a dev stub never replaces it). A failed automatic attempt waits for another 20 main messages before it tries again. A refresh is saved against the version it read, so a teammate's edit made during generation wins. Members can also edit the brief by hand. User messages become `user` (prefixed with the author's display name, or an agent's token label); agent/assistant messages use the corresponding assistant role and agent identity; completed tool calls/results become the provider's structured tool messages. Pending, failed, or cancelled work is not silently presented as a successful tool result. The key acceptance checks: main sees its full path; every other branch sees its branch context, the fork tail, and its own events, never its parent's earlier raw messages; and no branch ever sees sibling-branch messages.

### Scoped branch context

Main is the full record. Every other branch carries only what its work needs and asks the branch one level up for the rest.

**At fork.** The **Branch from here** form asks for a purpose ("Frontend: settings page") next to the doc checkboxes. After the branch is created, one model call writes `branch_context` from the purpose, the brief, the parent branch's history up to the fork point (for main, its path; for any other branch, its own branch context, fork tail, and messages), and the session's doc titles. It keeps the decisions, constraints, interfaces, and open questions relevant to the purpose and drops the rest. It is written to be short; docs are not copied into it, since the branch reads its pinned docs in full and gets excerpts of the rest. The generated context is shown to the owner, who can edit it before or after the agent starts; a save is checked against `branch_context_updated_at` like the brief. If generation fails, the branch is still usable: its context is empty, the owner can write it by hand or retry, and `ask_parent` still works.

**Citations.** Every point in `branch_context` names its source, so the child knows where it came from and where to look next:

- a document, by name and, where it applies, heading: `[FRONTEND.md § Styling]`
- a discussion, by author, branch, and date: `[Sam in main, Oct 2]`

A cited doc the branch does not read in full stays reachable: the agent can read it with `read_project_doc`, or ask about it with `ask_parent`. Citations are plain text in the markdown, so the owner can edit them like the rest of the context. The generator is told to cite only documents that exist and messages it was given; the server checks document citations against the session's doc titles and drops unknown ones.

**History for a branch other than main**, in context order after the brief and documents:

1. `branch_context`, as its own system message.
2. The **fork tail**: the last 6 finished messages on the path ending at the fork point, verbatim, so the message the branch forked from still reads in context. The branch context is a summary, and a summary loses exact wording that the next message may depend on. For example, main ends with the AI offering "Option A: reuse the card layout. Option B: a full-page form," and someone branches from that message to say "Go with B." Without the tail, the branch would know a styling choice was discussed but not what B was. The tail keeps that last exchange word for word, the way a forwarded email quotes the last few lines of the thread.
3. The branch's own messages, from its first message to its head.

**`ask_parent`.** Every branch except main gives its agents the server-side tool `ask_parent(question)`. It is a handoff: a call to the **parent branch's agent** (a child run linked by `parent_run_id` once durable runs exist), whose context is the parent branch's live history, the brief, and the parent's documents (every document, for main). It answers the question only, briefly, with citations in the same format, and returns that answer as the tool result. If the parent does not know, its agent can call `ask_parent` itself, so a question climbs one level at a time and ends at main, which holds the full record. Because each level reads its parent live, answers also catch decisions made after the fork. The question and the answer are saved in the asking branch as one message of kind `ask_parent` (the question in `ask_question`, the answering branch in `asked_branch_id`), so people see what was pulled in and later replies keep it. When the branch's own AI asks mid-reply, that message goes just before its reply; when a person's agent asks over MCP, it is appended at the branch head. Questions a parent passes further up are not recorded on the intermediate branches. Agents are told to call `ask_parent` instead of guessing about project decisions. A question climbs at most 4 levels, and one reply or answer makes at most 3 `ask_parent` calls; with durable runs these become the run's hop limit and token budget. Each branch's context is built in a stable order so repeated asks reuse the prompt cache. The built-in AI is offered `ask_parent` through OpenRouter tool calling; a model without tool support is called again without it.

**Existing branches.** Branches created before this shipped have no purpose or `branch_context`. When the server starts, each branch without a branch context (including one whose write failed) gets one, one at a time, using the branch name as its purpose; the owner can review it. A session without a model (no key) is skipped. Until a branch's context is written, its first reply waits for the write in progress.

**Cache order.** For both modes, the context builder puts content that changes least first, so branches forked from the same point share a cached prefix.

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
| S→C | `brief_updated` | sessionId, brief, briefUpdatedAt, briefUpdatedBy |
| S→C | `doc_created` | doc metadata (id, sessionId, title, kind, chars, uploadedBy, createdAt, updatedAt, updatedBy), never the content |
| S→C | `doc_updated` | doc metadata after a save, never the content; clients with the doc open refetch it |
| S→C | `doc_deleted` | sessionId, docId (affected branches also get `branch_updated`) |
| S→C | `session_key_updated` | sessionId, hasKey, keyLast4, setBy, setAt (never the key) |

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
| `create_branch` | fromMessageId, model, name?, purpose?, docIds? | new branch; `docIds` are pinned, and omitted copies the parent branch's pins; its branch context is written for `purpose` (the name stands in when omitted) |
| `list_models` | sessionId? | model IDs and names: `:free` only (unless `OPENROUTER_ALLOW_PAID=true`), or every model for a session with its own key |
| `wait_for_mentions` | since?, timeoutSeconds = 25 (max 50) | `{ mentions, cursor }`: @mentions of this agent token after `since` in the user's sessions; waits until one arrives or the timeout passes. Agents loop, passing `cursor` back as `since`. |
| `get_branch_context` | branchId, limit = 200 | session, the session's `brief` and `briefUpdatedAt`, `docs` (the project docs the branch reads, in full; every doc on main) and `otherDocs` (metadata of the rest), branch with owner and `pinnedDocIds`, `forkedFrom`, `purpose`, `branchContext`, the branch's history as its AI sees it (main: root to head; any other branch: the fork tail, then its own messages, each with `kind` and `askQuestion`), and the session's other branches |
| `ask_parent` | branchId, question | branch owner only, not main: the parent branch's AI answers from its live history (climbing toward main if it must); returns `{ answer, answeredBy: { branchId, branchName } }` and records the exchange in the branch as an `ask_parent` message |
| `share_to_main` | branchId | branch owner only: posts an AI summary of the branch's own messages into main, linked by `shared_from_branch_id`; returns that message |
| `update_brief` | sessionId, content, baseUpdatedAt | any member: replaces the session's brief; `baseUpdatedAt` must match the stored `briefUpdatedAt` (null if never set), otherwise a conflict error |
| `refresh_brief` | sessionId | any member: AI rewrites the brief from main's latest messages; returns the session |
| `list_project_docs` | sessionId | the session's project docs: id, title, kind, chars, updatedAt, updatedBy (no content) |
| `read_project_doc` | docId, offset = 0, limit = 20000 | title, kind and `updatedAt`, `text` from `offset`, `totalChars`, for reading long docs in slices |
| `search_project_docs` | sessionId, query, k = 5 (max 10) | best-matching passages with docId and title, the same ranking the context builder uses |
| `write_project_doc` | sessionId, docId?, title?, content, baseUpdatedAt? | any member: without `docId`, creates a text doc (`title` required); with it, replaces the doc's text, and `baseUpdatedAt` must match its `updatedAt`, otherwise a conflict error |
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
  - **Left**: title, Copy invite link, online count, a **Brief** card that opens the summary of main to read, edit, or **Refresh from main**, a **Docs** list (New; Upload for text, code, or PDF files up to 10 MB, a PDF sent as base64 and stored as its extracted text; each doc opens to read, edit, or delete; any member edits, and a save from an outdated version is refused with the draft kept; only the creator or the session owner deletes; on a non-main branch each doc has a checkbox for whether it is pinned to this branch, which only the owner can change), and the member list with online dots and agent badges. Below that, the branch tree, with main at the top.
  - **Center**: messages for the selected branch, each with author, time, and model for AI messages. Markdown and code blocks render with syntax highlighting. Hovering a message shows **Branch from here**; its form asks for the branch's purpose and lists the docs with checkboxes, pre-ticked from the parent branch's pins. A new branch opens with its generated branch context, which the owner can read and edit. A typing indicator shows who is typing in this branch.
  - **Bottom**: the composer, plus a model dropdown for the branch owner. Non-owners see a disabled composer with a **Branch from latest message** button.
  - **Right** (build last): the message tree visual.
- **Settings**: account and Sign out, **Connect an agent** (creates a token and copies the MCP config), the list of agent tokens with revoke, and the server URL.

### Native behavior

- Minimum window size 1000×650.
- Menus: File (New session, Join session, Settings), Edit, and View (toggle tree panel).
- A native notification appears for new messages in main or in your own branch while the window is unfocused.

---

## Out of scope (MVP)

Branch merging, editing or deleting messages, file types other than text and PDF, model tool use beyond `ask_parent`, roles beyond owner and member, billing, code signing and notarization, auto-updates, Linux builds, and local models.

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
- [ ] **13. Agent foundation**: session OpenRouter keys (set/replace/remove by the owner, encrypted at rest, spend limit, fallback to the server key) *(built and tested except the spend limit and usage per member)*; decide the tool approval policy; add agent/tool/branch-roster schemas and migrations, permission checks, shared contracts, and branch-roster snapshot tests.
- [ ] **14. Durable runs**: add run/step/tool-call persistence, branch queue ordering, worker leases and restart recovery, cancellation, budgets, and idempotency tests; migrate the MVP automatic reply to a single-step run.
- [ ] **16. Project docs**: upload text and PDF docs to a session, pin them to branches, and add excerpts of the unpinned docs to each reply. Also add MCP list, read, and search. ✅ A doc uploaded in main appears live in a second window. A branch created with one doc ticked answers from it, and a question about an unticked doc gets that doc's matching passage in context. An MCP `search_project_docs` call returns the passage. *(Server: Claude. Desktop: Bob. See PROJECT_DOCS.md.)*
- [ ] **15. Agent experience**: add mention resolution, roster management, run/tool activity events and UI, stop controls, and end-to-end tests for handoff, failure, reconnect, and permission enforcement.
- [ ] **16. Scoped branch context**: `purpose` and `branch_context` on branches; cited branch-context generation at fork with owner editing and document-citation checks; scoped history in the context builder; `ask_parent` as a handoff to the parent branch's agent, climbing toward main; migration of existing branches. ✅ A frontend branch's context holds the frontend decisions from main, each cited, and none of main's raw history; a grandchild branch's agent answers a question its parent cannot by calling `ask_parent` until it reaches main, and each exchange shows in the timeline. Context-builder tests cover main, a child, a grandchild, and the fork tail. *(Built ahead of steps 14–15, with ask_parent as a direct call rather than a durable child run. Tests cover the context builder, citations, permissions, and recording; the acceptance check needs a real model and is not yet run.)*
