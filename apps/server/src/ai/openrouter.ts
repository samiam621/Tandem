import { eq, inArray } from 'drizzle-orm'
import OpenAI from 'openai'
import { getDb } from '../db/index.js'
import { messages, branches, users, sessions } from '../db/schema.js'
import { bus } from '../events.js'
import { assertModelAllowed } from './models.js'
import { buildChatContext } from './context.js'
import { documentsForBranch } from '../services/documents.js'

// ─── Context builder ──────────────────────────────────────────────────────────
// Loads the session's messages, speaker names, brief and the branch's documents; the pure mapping lives in context.ts.

function buildContext(sessionId: string, branch: typeof branches.$inferSelect, pendingMsgId: string) {
  const db = getDb()
  const rows = db.select().from(messages).where(eq(messages.sessionId, sessionId)).all()
  const authorIds = [...new Set(rows.map((m) => m.authorId))]
  const nameById = new Map(
    db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, authorIds)).all()
      .map((u) => [u.id, u.name]),
  )
  const brief = db.select({ brief: sessions.brief }).from(sessions).where(eq(sessions.id, sessionId)).get()?.brief ?? ''
  const { selected, others } = documentsForBranch(branch)
  return buildChatContext(rows, pendingMsgId, nameById, { brief, documents: selected, otherDocumentNames: others.map((d) => d.name) })
}

// Whether a real model is configured. Without a key, replies and summaries are dev stubs.
export function aiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

// ─── Summarize (Share to main) ────────────────────────────────────────────────

const SUMMARY_PROMPT = `You summarize a side branch of a team chat so teammates in the main thread can catch up.
Write a short markdown summary: what was worked on, decisions and results, and open questions.
Use bullet points and stay under 150 words. Do not invent details that are not in the transcript.`

export const BRIEF_PROMPT = `You maintain the brief for the main thread of a team chat. The main thread is where the team plans;
side branches are workstreams (frontend, backend, a feature) whose AI reads this brief to stay in sync with main.
You get the current brief, the team's branches, the names of the shared documents, and the latest main-thread messages.
Write the updated brief in markdown: the current direction, decisions made, who is working on what (by branch), and open questions.
Keep points from the current brief that are still true. Do not copy the documents; refer to them by name.
Stay under 250 words. Do not invent details that are not in the input.`

// One-shot (non-streaming) summary of a transcript, using the branch's model.
export async function summarize(model: string, transcript: string, prompt = SUMMARY_PROMPT): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return `[Dev mode: no OPENROUTER_API_KEY set. Model: ${model}. Summary of ${transcript.split('\n').length} messages would appear here.]`

  assertModelAllowed(model)
  const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', defaultHeaders: { 'X-Title': 'Tandem' } })
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: transcript }],
  })
  return res.choices[0]?.message?.content?.trim() || '(The model returned an empty summary.)'
}

// ─── Generate reply ───────────────────────────────────────────────────────────

export async function generateReply(branchId: string, pendingMsgId: string, sessionId: string) {
  const db = getDb()

  const branch = db.select().from(branches).where(eq(branches.id, branchId)).get()
  if (!branch) return

  const pendingMsg = db.select().from(messages).where(eq(messages.id, pendingMsgId)).get()
  if (!pendingMsg) return

  // Set to streaming
  db.update(messages).set({ status: 'streaming' }).where(eq(messages.id, pendingMsgId)).run()

  try {
    const context = buildContext(sessionId, branch, pendingMsgId)

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      // No key in dev — return a stub reply
      const stubContent = `[Dev mode: no OPENROUTER_API_KEY set. Model: ${branch.model}. Context messages: ${context.length}]`
      db.update(messages)
        .set({ status: 'done', content: stubContent, model: branch.model })
        .where(eq(messages.id, pendingMsgId))
        .run()
      bus.emitSession(sessionId, {
        type: 'assistant_done',
        payload: { messageId: pendingMsgId, content: stubContent, model: branch.model },
      })
      return
    }

    assertModelAllowed(branch.model)
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'X-Title': 'Tandem' },
    })

    const stream = await client.chat.completions.create({
      model: branch.model,
      messages: context,
      stream: true,
    })

    let fullContent = ''
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      if (delta) {
        fullContent += delta
        bus.emitSession(sessionId, {
          type: 'assistant_delta',
          payload: { messageId: pendingMsgId, branchId, text: delta },
        })
      }
    }

    db.update(messages)
      .set({ status: 'done', content: fullContent, model: branch.model })
      .where(eq(messages.id, pendingMsgId))
      .run()

    bus.emitSession(sessionId, {
      type: 'assistant_done',
      payload: { messageId: pendingMsgId, content: fullContent, model: branch.model },
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    db.update(messages)
      .set({ status: 'error', content: errMsg })
      .where(eq(messages.id, pendingMsgId))
      .run()
    bus.emitSession(sessionId, {
      type: 'assistant_error',
      payload: { messageId: pendingMsgId, error: errMsg },
    })
  }
}
