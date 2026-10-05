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

- [x] **`lib/api.ts`**
  - `docs.list(sessionId)`, `docs.get(docId)`, `docs.upload(sessionId, body)`, `docs.delete(docId)`.
  - `branches.create(..., docIds?)` and the branch update call with `pinnedDocIds`.
  - Types come from `@tandem/shared`. Don't redefine them.
- [x] **`features/chat/ProjectDocs.tsx`**: a card under the Project brief card in SessionView's left column.
  - List each doc's title, size (`chars`), and uploader name.
  - Add an **Upload** button using `<input type="file" accept=".md,.markdown,.txt,.json,.yaml,.yml,.csv,.ts,.tsx,.js,.py,.go,.rs,.java,.sql,.html,.css,.pdf">`.
    - For a text file, call `file.text()` and send `{ title: file.name, text }`.
    - For a PDF, read its `arrayBuffer()`, base64 it, and send `{ title: file.name, pdfBase64 }`. Refuse anything over `DOC_UPLOAD_MAX_BYTES` before sending.
    - Show the server's error message on a 400 (for example, a scanned PDF with no text).
- [x] **Doc viewer**: clicking a doc opens a read-only modal shaped like `BriefPanel.tsx`, showing the content from `docs.get`. The uploader or the session owner also sees **Delete**.
- [x] **Live updates**: handle `doc_created` and `doc_deleted` in SessionView's WS event switch (next to `brief_updated`), and load the list from `docs.list` on open and on reconnect.
- [x] **Branch dialog** (`SessionView.tsx`, `handleBranch`): add a "Pin docs to this branch" checkbox list (none ticked by default) and pass the ticked ids as `docIds`.
- [x] **Pinned docs control**: the branch owner gets a "Pinned docs (N)" button in the branch header. It opens the same checkbox list and saves with `pinnedDocIds`. Other members see the count read-only. Main has no owner, so it shows nothing.
- [x] **ARCHITECTURE.md § Screens**: describe the Project docs card, the viewer, the branch-dialog checkboxes, and the pinned-docs control.
- [x] `npm run typecheck` and `npm test` pass.
- [x] Against the `docs-server` server (`npm run dev`): upload a `.md` and a `.pdf` and they appear in the list. Create a branch with one ticked, and the branch shows "Pinned docs (1)". *(Run by Claude on 2026-10-05 in the real app, with a scratch profile and server.)*

## Checkpoints

- [x] **CP0: contract frozen (Claude).** The shared types and schemas, migrations `0005_session_brief` and `0006_project_docs`, and this file. *Gate:* `npm run typecheck` passes.
- [x] **CP1a: server API (Claude).** The docs service, REST, PDF extraction, pins, WS events, and integration tests. *Gate:* `npm test` passes, and curl uploads, lists, and gets a `.md` and a `.pdf`.
- [x] **CP2: AI context and MCP (Claude).** Retrieval, the context builder, the 3 MCP tools, and unit tests. *Gate:* an MCP `search_project_docs` call over curl returns the expected passage.
- [x] **CP1b: desktop UI (Bob).** Everything in Bob's checklist. *Gate:* typecheck passes, and the manual check above works.
- [ ] **CP3: integration (both).** *Claude's part done on 2026-10-05: typecheck passes and 48 tests pass on `docs-server`, and the single-window flow passed in the real app (upload .md and .pdf, viewer, branch with one pin, an answer from the pinned doc plus an excerpt of the unpinned PDF, edit pins). Waiting on: fix B1 (Bob), then Sam's two-window check.* Bob has rebased onto `docs-server`, and typecheck and tests pass on the merged branch. Claude runs the single-window flow and Sam runs the two-window live check. *Then* tick build step 16 in ARCHITECTURE.md.

## Round 2: close the open items (Bob builds, Claude reviews, Sam merges)

**Ownership for this round only:** Bob may also edit the files named in R2-A and R2-C. Those are normally Claude's. Everything else follows the usual table.

### R2-A: production hotfix PR to `main` (Bob). Do this first: it doesn't wait for the docs feature.

Production is broken in two ways.
- **Missing brief columns.** A fresh database never gets the brief columns, and Render's database is fresh on every deploy, so creating a session fails.
- **Retired default model.** `meta-llama/llama-3.3-70b-instruct:free` is no longer free on OpenRouter ("This model is unavailable for free").

- [ ] Branch `fix/prod-brief-and-model` from `origin/main`, then run `git cherry-pick 2568859`. Claude has checked that it applies cleanly onto `origin/main`.
- [ ] Replace `meta-llama/llama-3.3-70b-instruct:free` with **`qwen/qwen3.8-27b:free`** in these files. It is listed by OpenRouter as of 2026-10-05, and it answered correctly in Claude's end-to-end run.
  - `apps/server/src/ai/models.ts`: `DEV_FREE_MODELS`, with name `'Qwen3.8 27B (Free)'`
  - `apps/server/scripts/e2e.mjs`: both places
  - `packages/shared/src/index.ts`: the comment only
  - `packages/shared/src/index.test.ts`
  - **Do not** edit `drizzle/0004_free_models.sql`, because migrations that have already been applied must never change.
- [ ] `npm run typecheck` and `npm test` pass. Then run `git grep -n "llama-3.3-70b-instruct" -- . ':!*/dist/*' ':!apps/server/drizzle/*'`, and only `BOB.md` should match.
- [ ] Push, then open the PR to `main`. Its title is "Fix fresh-DB brief columns and retire the dead default model". In the body, say what each fix does and paste the test output.

### R2-B: desktop fixes on `docs-server` (Bob)

- [ ] **B1:** in the Pinned docs modal, make each checkbox a controlled input with `checked={pb.pinnedDocIds.includes(doc.id)}`. Disable all of them while a PATCH is in flight. On an error, show the message in the modal.
- [ ] **N1:** in the `branch_created` handler, skip a branch that is already in the list, the same guard `doc_created` uses. Then a new branch appears once.
- [ ] **N3:** show the uploader's display name on each doc in the card. Members are already in SessionView state.
- [ ] Leave **N2** (refetch after reconnect) alone: it's a separate fix.

### R2-C: retire the stored model ids on `docs-server` (Bob, after R2-A is merged)

- [ ] Run `git merge origin/main` into `docs-server`. The hotfix contains the same `0005` change, so it should merge cleanly. If `_journal.json` conflicts, keep the version on `docs-server`.
- [ ] Add a custom migration **0007_retire_llama**. From `apps/server`, run `npx drizzle-kit generate --custom --name retire_llama`, then **set its `"when"` in `_journal.json` to `1791200000003`**. Use this SQL:
  ```sql
  UPDATE branches SET model = 'qwen/qwen3.8-27b:free' WHERE model = 'meta-llama/llama-3.3-70b-instruct:free';
  --> statement-breakpoint
  UPDATE sessions SET default_model = 'qwen/qwen3.8-27b:free' WHERE default_model = 'meta-llama/llama-3.3-70b-instruct:free';
  ```
  This is needed because main branches have no owner and can't be PATCHed. Without it, old local sessions stay stuck on the dead model.
- [ ] `npm run typecheck` and `npm test` pass. Commit, push, and tick the boxes here.

### R2 review gates (Claude)

- [ ] **R2-A PR:** read the diff. Check the cherry-pick matches `2568859`. On the PR branch, check that a fresh scratch DB gets the `brief*` columns, and that typecheck and tests pass.
- [ ] **R2-B:** rerun the desktop driver flow. Rapidly untick two pins and confirm the UI matches the server. Create a branch and confirm it's listed once. Confirm the uploader name is shown.
- [ ] **R2-C:** run the migrations on a copy of Sam's local `tandem.db`. Confirm no branch or session keeps the llama id, and confirm a reply on an old session's main branch works.
- [ ] Write the review results here. Any blocker goes back to Bob.

### Sam's steps

- [ ] Tell Bob to start R2-A, then R2-B and R2-C.
- [ ] After Claude approves the hotfix PR, merge it to `main`. Once Render redeploys, create a session on the hosted app and send a message. Both should work.
- [ ] After Claude approves R2-B and R2-C: run the two-window check (`npm run dev` and `npm run dev:second`, both signed in, same session). Upload a doc in one window and watch it appear in the other. Then change pins in one window and watch the count update in the other.
- [ ] Tick build step 16 in ARCHITECTURE.md (CP3), then open and merge the `docs-server` PR.

## Rules

- Stay inside the files you own. **Never change `packages/shared` without asking here first.**
- **Never touch `.env` files.** Don't read them, check them, overwrite them, move them, or recreate them. See AGENTS.md § Hard rules.
- **Migrations:** `0004_free_models` is journaled with a timestamp of 2026-10-05. The migrator skips any migration whose timestamp is older than the last one applied. After running `drizzle-kit generate`, set the new journal entry's `"when"` to a value after the previous entry. Claude did this for 0005 and 0006. The integration test now runs the real migrations, so a missing migration fails `npm test`.
- Run typecheck and tests before you tick a box. If something is blocked, write it under Blockers instead of working around it.

## Blockers

- **B1 (Bob): the Pinned docs modal loses edits when you toggle quickly.** It's in `SessionView.tsx`, in the pinned-docs panel.
  - **What happens:** each `onChange` builds `next` from the `pb` captured at render, and the checkboxes use `defaultChecked`. Two toggles before the first PATCH returns, so the second PATCH overwrites the first. The checkboxes then disagree with the server.
  - **Reproduced:** with both docs pinned, unticking both quickly showed both unticked while the server kept one pinned.
  - **Fix:** use `checked={pb.pinnedDocIds.includes(doc.id)}` (a controlled input) and disable the checkboxes while a save is in flight. On an error, show the message instead of only reverting.

## Review notes (not blocking)

- **N1:** a new branch appears **twice** in its creator's branch list. `handleBranch` appends the REST result, and the `branch_created` handler appends again without a dedupe. This bug predates the docs work (it's on `main`), but it's a one-line fix in Bob's file: guard `branch_created` the way `doc_created` is guarded.
- **N2:** after a WebSocket reconnect, nothing refetches: not docs, not the brief, not messages. `useWebSocket` has no reconnect callback, even though ARCHITECTURE.md § Real-time says the client refetches. This predates the docs work, so it should be a separate fix.
- **N3:** the docs card shows kind and size but not the uploader name, which Bob's checklist asked for. It's minor; add it or drop it from the spec.
- **N4:** the pinned-docs control lives in the sidebar branch list instead of the branch header. It works, and § Screens describes it correctly, so no change is needed.
