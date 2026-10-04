import { eq, asc } from 'drizzle-orm'
import OpenAI from 'openai'
import { getDb } from '../db/index.js'
import { messages, branches } from '../db/schema.js'
import { bus } from '../events.js'
import { assertModelAllowed } from './models.js'

// ─── Context builder ──────────────────────────────────────────────────────────
// Builds the message path from root to the pending assistant message,
// then maps it to OpenRouter/OpenAI chat format.

function buildContext(sessionId: string, headMessageId: string) {
  const db = getDb()
  const allMessages = db.select().from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt))
    .all()

  const msgById = new Map(allMessages.map((m) => [m.id, m]))

  // Walk from headMessageId (the pending assistant msg) up to root via parent_id
  const path: typeof allMessages[0][] = []
  let cur: typeof allMessages[0] | undefined = msgById.get(headMessageId)
  while (cur) {
    path.push(cur)
    cur = cur.parentId ? msgById.get(cur.parentId) : undefined
  }
  path.reverse()

  // Filter out the pending assistant message itself and any error/pending ones
  const context = path.filter(
    (m) => !(m.id === headMessageId) && m.status === 'done',
  )

  // Map to OpenRouter roles
  type ChatMsg = { role: 'user' | 'assistant'; content: string }
  return context.map((m): ChatMsg => {
    if (m.authorType === 'assistant') {
      return { role: 'assistant', content: m.content }
    }
    // user and agent messages → role: user, prefixed with display name if available
    return { role: 'user', content: m.content }
  })
}

// ─── Summarize (Share to main) ────────────────────────────────────────────────

const SUMMARY_PROMPT = `You summarize a side branch of a team chat so teammates in the main thread can catch up.
Write a short markdown summary: what was worked on, decisions and results, and open questions.
Use bullet points and stay under 150 words. Do not invent details that are not in the transcript.`

// One-shot (non-streaming) summary of a transcript, using the branch's model.
export async function summarize(model: string, transcript: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return `[Dev mode: no OPENROUTER_API_KEY set. Model: ${model}. Summary of ${transcript.split('\n').length} messages would appear here.]`

  assertModelAllowed(model)
  const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', defaultHeaders: { 'X-Title': 'Tandem' } })
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: transcript }],
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
    const context = buildContext(sessionId, pendingMsgId)

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
