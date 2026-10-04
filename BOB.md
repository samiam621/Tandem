# Bob: finish the free-models change

## Why

The server's OpenRouter key could be spent by anyone. Sam fixed the cost by allowing only OpenRouter **free** models (ids ending in `:free`). That change is in the working tree:

- `apps/server/src/ai/models.ts` has `isFreeModelId()` and `fetchFreeModels()`.
- REST, MCP and `ai/openrouter.ts` all reject non-free models.

It is uncommitted. **Commit it before you start, and do not discard it.**

Three problems are left:

1. **Old sessions break.** Rows created before this change store paid models such as `openai/gpt-4o-mini`. `generateReply` now refuses them. A session's main branch can't be PATCHed (it has no owner), so every old session's main chat is stuck until the stored data is migrated.
2. **The free-model check is copied into 5 places.** AGENTS.md requires validation through one Zod schema in `packages/shared`.
3. **`e2e.mjs` and the docs still use paid models.**

**Default free model:** `meta-llama/llama-3.3-70b-instruct:free` (already the dev fallback in `ai/models.ts`).

**Contract note:** This changes the "Models" row in ARCHITECTURE.md § Current MVP contracts. Sam approved the change.

**Out of scope, do not build:**
- A global AI cap
- `max_tokens`
- A limit on guest sign-ups per IP
- `trustProxy`

Free models cost nothing, so these no longer protect anything.

---

## Checklist

### Before you start
- [ ] Commit Sam's uncommitted free-models change, or build directly on top of it.
- [ ] Run `npm run typecheck` and `npm test`. Both should pass (39 tests) before you change anything.
- [ ] Confirm `meta-llama/llama-3.3-70b-instruct:free` is still listed by `curl https://openrouter.ai/api/v1/models`.
  - If it's gone, pick another `:free` id.
  - Use that id everywhere below, including `DEV_FREE_MODELS` in `ai/models.ts`.

### 1. Migrate stored paid models (most important)
- [ ] From `apps/server`, run `npx drizzle-kit generate --custom --name free_models`. This creates migration `0004` and updates `drizzle/meta/_journal.json`.
- [ ] Put this SQL in the new migration:
  ```sql
  UPDATE branches SET model = 'meta-llama/llama-3.3-70b-instruct:free' WHERE model NOT LIKE '%:free';
  --> statement-breakpoint
  UPDATE sessions SET default_model = 'meta-llama/llama-3.3-70b-instruct:free' WHERE default_model NOT LIKE '%:free';
  ```
- [ ] Leave `messages.model` alone. It records which model wrote each past reply.

### 2. Validate the free model in one place
- [ ] In `packages/shared/src/index.ts`:
  - Move `isFreeModelId` in from `apps/server/src/ai/models.ts`.
  - Add:
    ```ts
    export const FreeModelIdSchema = z.string().min(1).refine(isFreeModelId, 'Select an OpenRouter model with the :free suffix.')
    ```
- [ ] Use `FreeModelIdSchema` for:
  - `CreateSessionSchema.defaultModel`
  - `CreateBranchSchema.model`
  - `UpdateBranchSchema.model` (keep `.optional()`)
- [ ] Run `npm run build -w packages/shared`. `packages/shared/dist` is tracked, so commit it.
- [ ] Delete the duplicate checks:
  - Both `isFreeModelId` blocks in `apps/server/src/routes/sessions.ts`.
  - The PATCH block in `apps/server/src/routes/branches.ts`.
- [ ] In `apps/server/src/mcp/handler.ts` `create_branch`:
  - Change `model: z.string()` to `FreeModelIdSchema`.
  - Delete the manual check.
- [ ] Delete `isFreeModelId` from `apps/server/src/ai/models.ts` and import it from `@tandem/shared`.
- [ ] **Keep** the guards in `apps/server/src/ai/openrouter.ts`, importing from `@tandem/shared`. They are the backstop for stored rows.

### 3. Fix the e2e script
- [ ] In `apps/server/scripts/e2e.mjs`, change lines 29 and 68 from `anthropic/claude-sonnet-4` to the default free model.

### 4. Docs (same commit as the code)
- [ ] README endpoint table:
  - `/api/models` → "OpenRouter free models (`:free` ids only), cached for 1 h".
  - Session create and branch create/PATCH → note 400 when the model isn't a `:free` id.
- [ ] ARCHITECTURE.md:
  - "Models" contract row → the branch model must be an OpenRouter `:free` id (`FreeModelIdSchema` in `packages/shared`).
  - MCP tools table, `list_models` row → "free model IDs and names".

### 5. Tests
- [ ] Move `apps/server/src/ai/models.test.ts` to `packages/shared/src/index.test.ts`, importing `isFreeModelId` from `./index.js`.
- [ ] In `apps/server/src/routes/integration.test.ts`, in the "rejects paid model IDs" test, expect `invalid_request` instead of `free_model_required`.

### 6. Verify (run each one and watch it pass)
- [ ] Run `npm run typecheck` and `npm test`. Both pass.
- [ ] Check the migration:
  - Use a copy of a SQLite database created before this change, with a session on `openai/gpt-4o-mini`.
  - Start the server on it.
  - Main now shows the `:free` default, and posting in main gets a reply instead of an error.
- [ ] Local curl checks:
  - Create a session with `"openai/gpt-4o-mini"` → 400.
  - Create one with the `:free` default → 201.
  - `GET /api/models` → only `:free` ids.
- [ ] Run `node apps/server/scripts/e2e.mjs http://localhost:3000`. It passes.
- [ ] Desktop (`npm run dev`):
  - The model picker shows only "(Free)" models.
  - A new session's reply streams.
  - An old session also gets a reply.
- [ ] In your final message, list anything you could not run.

### Sam does this, not Bob
- [ ] In the OpenRouter dashboard, set the key's credit limit to $0 or close to it, so a paid model that slips through fails instead of billing.
