# Follow-ups

Known issues we have chosen to fix later. Each entry says what is wrong, where, and the fix we have in mind. Delete an entry in the same commit that fixes it.

## No total size cap on documents in AI context

**Where:** the context builder in `apps/server/src/ai/openrouter.ts`, which reads `documentsForBranch` from `apps/server/src/services/documents.ts`. The agent context (`getBranchContext` in `apps/server/src/services/agents.ts`) has the same gap.

**Problem:** Each document is capped at 60k characters when it is saved (`DOCUMENT_MAX_CHARS`), but nothing limits the total sent to the model. Main reads every document (ARCHITECTURE.md § Building AI context), so a session with many documents can send main's model a context larger than its window. That fails the reply or runs up cost.

**Fix:** Add a total budget for document text, such as a `DOCUMENTS_MAX_CHARS` constant. When the selected documents go over it, include them in order until the budget runs out. List the rest by name only, the same way the context lists documents a branch does not read, and say they were left out for size.

## A manual brief refresh can save the dev-mode placeholder

**Where:** `refreshBrief` / `runRefresh` in `apps/server/src/services/brief.ts`, and `summarize` in `apps/server/src/ai/openrouter.ts`.

**Problem:** With no `OPENROUTER_API_KEY`, `summarize` returns a `[Dev mode: …]` stub. A manual Refresh (the desktop button or the MCP `refresh_brief` tool) saves that stub over a hand-written brief. The automatic refresh is already skipped without a model; the manual path is not. The integration test `POST /api/sessions/:id/brief/refresh rewrites the brief from main` currently expects the stub to be saved.

**Fix:** In `refreshBrief`, when `aiConfigured()` is false, fail with `503 ai_unavailable` ("No model is configured on this server") instead of saving. Update that integration test, and the README endpoint table and ARCHITECTURE.md if the response changes.
