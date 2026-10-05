# Project docs: Claude + Bob handoff

## Why

Sam wants something like Claude Projects. **Main** holds the specs, docs, and high-level direction as uploaded files. A **branch** made for one part of the project starts with the docs that part needs. If it needs more later, it pulls from main.

How it works (server side, done by Claude):
- Members upload **project docs** to a session: text, markdown, code, or PDF. For a PDF the server stores the extracted text.
- A branch has **pinned docs**, ticked when the branch is created and changeable later by its owner. The branch's AI reads its pinned docs in full.
- For every other doc, each reply gets the passages that best match the latest message (keyword search), plus an index of all doc titles. That is how a branch "calls main" for what it is missing.
- MCP agents get `list_project_docs`, `read_project_doc`, and `search_project_docs`. `create_branch` takes `docIds`, and `get_branch_context` returns `docs`.

The full spec is in ARCHITECTURE.md (§ Current MVP contracts, § Data model, § Building AI context, the WS table, and the MCP table). The REST endpoints are in the README REST table.

## Who owns what

Each file has one owner. **Stay inside your own files.**

| Owner | Files |
|---|---|
| **Claude** | `packages/shared/**`, `apps/server/**`, README.md, ARCHITECTURE.md (everything except § Screens) |
| **Bob** | `apps/desktop/src/renderer/**`, ARCHITECTURE.md § Screens only |
| **Sam** | Approves each checkpoint, runs the two-window check, merges |

Branches: Claude works on `docs-server`, Bob on `docs-desktop` (cut from `docs-server`). Bob rebases onto `docs-server` at each checkpoint.

## The contract (frozen: `packages/shared/src/index.ts`)

**Need something changed? Don't edit it. Write it under Blockers below, and Claude makes the change.**

```ts
Branch.pinnedDocIds: string[]

interface ProjectDoc { id; sessionId; title; kind: 'text' | 'pdf'; content; uploadedBy; createdAt }
type ProjectDocMeta = Omit<ProjectDoc, 'content'> & { chars: number }
interface DocExcerpt { docId; title; text }

UploadDocSchema = { title, text } | { title, pdfBase64 }
CreateBranchSchema gains   docIds?: string[]
UpdateBranchSchema gains   pinnedDocIds?: string[]   // replaces the pins

DOC_MAX_CHARS = 200_000         // text per doc
DOC_UPLOAD_MAX_BYTES = 10 MB    // raw PDF

WS: doc_created   payload ProjectDocMeta
    doc_deleted   payload { sessionId, docId }   (pin changes arrive as branch_updated)
```

REST (every route needs `Authorization: Bearer`, and errors are `{ error: { code, message } }`):

| Method | Path | Body → result |
|---|---|---|
| GET | `/api/sessions/:id/docs` | → `ProjectDocMeta[]` |
| POST | `/api/sessions/:id/docs` | `{ title, text }` or `{ title, pdfBase64 }` → `201 ProjectDocMeta`. Returns `400` if the PDF has no text, or the text is empty or too long. |
| GET | `/api/docs/:id` | → `ProjectDoc` (with content) |
| DELETE | `/api/docs/:id` | → `204`. Uploader or session owner only, otherwise `403`. |
| POST | `/api/sessions/:id/branches` | now also takes `docIds?`. An unknown id returns `400`. |
| PATCH | `/api/branches/:id` | now also takes `pinnedDocIds?`. Owner only. |

## Bob's checklist (desktop, `apps/desktop/src/renderer`)

- [ ] **`lib/api.ts`**
  - `docs.list(sessionId)`, `docs.get(docId)`, `docs.upload(sessionId, body)`, `docs.delete(docId)`.
  - `branches.create(..., docIds?)` and the branch update call with `pinnedDocIds`.
  - Types come from `@tandem/shared`. Don't redefine them.
- [ ] **`features/chat/ProjectDocs.tsx`**: a card under the Project brief card in SessionView's left column.
  - List each doc's title, size (`chars`), and uploader name.
  - Add an **Upload** button using `<input type="file" accept=".md,.markdown,.txt,.json,.yaml,.yml,.csv,.ts,.tsx,.js,.py,.go,.rs,.java,.sql,.html,.css,.pdf">`.
    - For a text file, call `file.text()` and send `{ title: file.name, text }`.
    - For a PDF, read its `arrayBuffer()`, base64 it, and send `{ title: file.name, pdfBase64 }`. Refuse anything over `DOC_UPLOAD_MAX_BYTES` before sending.
    - Show the server's error message on a 400 (for example, a scanned PDF with no text).
- [ ] **Doc viewer**: clicking a doc opens a read-only modal shaped like `BriefPanel.tsx`, showing the content from `docs.get`. The uploader or the session owner also sees **Delete**.
- [ ] **Live updates**: handle `doc_created` and `doc_deleted` in SessionView's WS event switch (next to `brief_updated`), and load the list from `docs.list` on open and on reconnect.
- [ ] **Branch dialog** (`SessionView.tsx`, `handleBranch`): add a "Pin docs to this branch" checkbox list (none ticked by default) and pass the ticked ids as `docIds`.
- [ ] **Pinned docs control**: the branch owner gets a "Pinned docs (N)" button in the branch header. It opens the same checkbox list and saves with `pinnedDocIds`. Other members see the count read-only. Main has no owner, so it shows nothing.
- [ ] **ARCHITECTURE.md § Screens**: describe the Project docs card, the viewer, the branch-dialog checkboxes, and the pinned-docs control.
- [ ] `npm run typecheck` and `npm test` pass.
- [ ] Against the `docs-server` server (`npm run dev`): upload a `.md` and a `.pdf` and they appear in the list. Create a branch with one ticked, and the branch shows "Pinned docs (1)".

## Checkpoints

- [x] **CP0: contract frozen (Claude).** The shared types and schemas, migrations `0005_session_brief` and `0006_project_docs`, and this file. *Gate:* `npm run typecheck` passes.
- [x] **CP1a: server API (Claude).** The docs service, REST, PDF extraction, pins, WS events, and integration tests. *Gate:* `npm test` passes, and curl uploads, lists, and gets a `.md` and a `.pdf`.
- [x] **CP2: AI context and MCP (Claude).** Retrieval, the context builder, the 3 MCP tools, and unit tests. *Gate:* an MCP `search_project_docs` call over curl returns the expected passage.
- [ ] **CP1b: desktop UI (Bob).** Everything in Bob's checklist. *Gate:* typecheck passes, and the manual check above works.
- [ ] **CP3: integration (both).** Bob has rebased onto `docs-server`, and typecheck and tests pass on the merged branch. Claude runs the single-window flow and Sam runs the two-window live check. *Then* tick build step 16 in ARCHITECTURE.md.

## Rules

- Stay inside the files you own. **Never change `packages/shared` without asking here first.**
- **Never touch `.env` files.** Don't read them, check them, overwrite them, move them, or recreate them. See AGENTS.md § Hard rules.
- **Migrations:** `0004_free_models` is journaled with a timestamp of 2026-10-05. The migrator skips any migration whose timestamp is older than the last one applied. After running `drizzle-kit generate`, set the new journal entry's `"when"` to a value after the previous entry. Claude did this for 0005 and 0006. The integration test now runs the real migrations, so a missing migration fails `npm test`.
- Run typecheck and tests before you tick a box. If something is blocked, write it under Blockers instead of working around it.

## Blockers

_None yet._
