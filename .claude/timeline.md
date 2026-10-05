# Tandem session timeline

## 2026-10-04 — Explain Bob's branching, add the project brief

- Walked through how Bob's prototype does conversation branching: a message tree where each branch is a head pointer, and AI context is the root-to-head path (fork history plus the branch's own messages, never siblings').
- Fixed the AI context so the model sees speaker names ("Alice: ..."), and dropped the `as unknown as boolean` casts (committed separately as 2f43ac2).
- Decided the product vision: main is the spec hub and branches are workstreams. Added a per-session project brief that every branch's AI reads live, so branches forked before a spec edit still see it. Any member can edit; a stale save gets a 409. It's also exposed over MCP (`get_branch_context`, `update_brief`).
- The desktop brief panel typechecks but hasn't been clicked through in the running app yet.
- See: ARCHITECTURE.md (Context contract, Building AI context, MCP tools), apps/server/src/ai/context.ts, apps/desktop/src/renderer/features/chat/BriefPanel.tsx

## 2026-10-04 — Documents per branch, brief becomes a summary of main

- Replaced "one brief holds all specs" with two parts: session **documents** (ARCHITECTURE.md, TODO.md, …; New/Upload in main) and a **brief** that is an AI summary of main (direction, decisions, who's on what, open questions).
- Main's AI reads every document; each branch ticks the ones its task needs (pre-ticked from its parent branch, so sub-branches inherit). The brief refreshes on demand and every 20 main messages. Agents get `refresh_brief`, `list_documents`, `read_document`, `write_document`.
- Verified with tests (44 pass), a real-model brief refresh, and an Electron UI run; fixed a pre-existing duplicate-branch bug and kept model errors from surfacing as the caller's 401.
- See: ARCHITECTURE.md (Building AI context, MCP tools), apps/server/src/services/documents.ts, apps/server/src/services/brief.ts, apps/desktop/src/renderer/features/chat/TextEditorPanel.tsx
