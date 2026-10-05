import { eq, inArray } from 'drizzle-orm'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import { getDb } from '../db/index.js'
import { messages, branches, users, sessions } from '../db/schema.js'
import { bus } from '../events.js'
import { assertModelAllowed } from './models.js'
import { apiKeyFor } from './keys.js'
import { buildChatContext } from './context.js'
import { docsForBranch } from '../services/docs.js'
import { whenBranchContextReady } from '../services/branchContext.js'
import { recordAskBeforeReply } from '../services/askParent.js'

type BranchRow = typeof branches.$inferSelect

// ─── Keys and clients ─────────────────────────────────────────────────────────
// Every call runs on its session's key: the session's own OpenRouter key when set (BYOK), otherwise
// the server's OPENROUTER_API_KEY.

// Whether a real model is configured for the session. Without a key, replies and summaries are dev stubs.
export function aiConfigured(sessionId: string): boolean {
  return Boolean(apiKeyFor(sessionId).apiKey)
}

function clientFor(sessionId: string, model: string): OpenAI | null {
  const { apiKey, byok } = apiKeyFor(sessionId)
  if (!apiKey) return null
  assertModelAllowed(model, byok)
  return new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', defaultHeaders: { 'X-Title': 'Tandem' } })
}

// ─── Context builder ──────────────────────────────────────────────────────────
// Loads the session's messages, speaker names, brief, the branch's project docs and branch context;
// the pure mapping lives in context.ts.

function buildContext(branch: BranchRow, headMessageId: string, canAskParent: boolean) {
  const db = getDb()
  const rows = db.select().from(messages).where(eq(messages.sessionId, branch.sessionId)).all()
  const authorIds = [...new Set(rows.map((m) => m.authorId))]
  const nameById = new Map(
    db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, authorIds)).all()
      .map((u) => [u.id, u.name]),
  )
  const brief = db.select({ brief: sessions.brief }).from(sessions).where(eq(sessions.id, branch.sessionId)).get()?.brief ?? ''
  return buildChatContext(rows, headMessageId, nameById, {
    brief,
    docs: docsForBranch(branch),
    branchContext: branch.branchContext,
    purpose: branch.purpose,
    canAskParent,
  }, branch.isMain ? null : branch.forkMessageId)
}

// ─── Model calls with tools ───────────────────────────────────────────────────

// How many levels a question may climb (each ask_parent is one hop toward main).
export const MAX_ASK_DEPTH = 4
const MAX_TOOL_CALLS = 3 // per reply or answer

const ASK_PARENT_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'ask_parent',
    description: 'Ask the conversation this branch split off from about something you need that is not in your context: a decision, a constraint, what someone said. Returns a short cited answer. Use it instead of guessing about project decisions.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: 'One specific question' } },
      required: ['question'],
    },
  },
}

// Streams a completion, running ask_parent calls until the model answers in text. Falls back to no
// tools when the model does not support them.
async function chatWithTools(opts: {
  client: OpenAI
  model: string
  messages: ChatCompletionMessageParam[]
  askParent: ((question: string) => Promise<string>) | null
  onDelta?: (text: string) => void
}): Promise<string> {
  const convo = [...opts.messages]
  let tools = opts.askParent ? [ASK_PARENT_TOOL] : undefined
  let content = ''
  for (let calls = 0; ; ) {
    const offered = tools && calls < MAX_TOOL_CALLS ? tools : undefined
    let stream
    try {
      stream = await opts.client.chat.completions.create({
        model: opts.model,
        messages: convo,
        stream: true,
        ...(offered ? { tools: offered } : {}),
      })
    } catch (err: any) {
      if (offered && (err?.status === 404 || err?.status === 400) && /tool/i.test(err?.message ?? '')) {
        tools = undefined
        continue
      }
      throw err
    }

    const toolCalls: { id: string; name: string; args: string }[] = []
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (delta?.content) {
        content += delta.content
        opts.onDelta?.(delta.content)
      }
      for (const tc of delta?.tool_calls ?? []) {
        const call = (toolCalls[tc.index] ??= { id: '', name: '', args: '' })
        if (tc.id) call.id = tc.id
        if (tc.function?.name) call.name += tc.function.name
        if (tc.function?.arguments) call.args += tc.function.arguments
      }
    }
    if (!toolCalls.length || !offered || !opts.askParent) return content

    convo.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
    })
    for (const call of toolCalls) {
      calls += 1
      let result: string
      try {
        const question = String(JSON.parse(call.args || '{}').question ?? '').trim()
        result = call.name !== 'ask_parent' ? `Unknown tool ${call.name}`
          : !question ? 'ask_parent needs a question'
          : await opts.askParent(question)
      } catch (err) {
        result = `ask_parent failed: ${err instanceof Error ? err.message : String(err)}`
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }
}

// ─── ask_parent ───────────────────────────────────────────────────────────────

// The branch a branch split off from: the one holding its fork message. Null for main.
export function parentBranchOf(branch: BranchRow): BranchRow | null {
  if (branch.isMain || !branch.forkMessageId) return null
  const db = getDb()
  const fork = db.select({ branchId: messages.branchId }).from(messages).where(eq(messages.id, branch.forkMessageId)).get()
  return fork ? db.select().from(branches).where(eq(branches.id, fork.branchId)).get() ?? null : null
}

const ANSWER_INSTRUCTIONS = `A branch that split off from this conversation is asking you a question about it.
Answer only that question, briefly, from this conversation, the brief and the documents.
Cite sources in brackets: a document as [NAME § Heading], a discussion as [Author in branch, Mon D].
If the answer is not here, say so plainly.`

// Answers a question from `branch`'s live history. A branch other than main can itself ask its
// parent, so a question climbs one level at a time, up to MAX_ASK_DEPTH, and ends at main.
export async function answerFromBranch(branch: BranchRow, question: string, askingBranchName: string, depth = 1): Promise<string> {
  const client = clientFor(branch.sessionId, branch.model)
  if (!client) return `[Dev mode: no OpenRouter key. ${branch.name} would answer: ${question}]`
  if (!branch.headMessageId) return `${branch.name} has no messages yet.`

  const parent = depth < MAX_ASK_DEPTH ? parentBranchOf(branch) : null
  const context = buildContext(branch, branch.headMessageId, Boolean(parent))
  return chatWithTools({
    client,
    model: branch.model,
    messages: [...context, { role: 'user', content: `${ANSWER_INSTRUCTIONS}\n\nQuestion from branch "${askingBranchName}": ${question}` }],
    askParent: parent ? (q) => answerFromBranch(parent, q, branch.name, depth + 1) : null,
  }).then((text) => text.trim() || '(No answer.)')
}

// ─── Summarize (Share to main, brief, branch context) ─────────────────────────

const SUMMARY_PROMPT = `You summarize a side branch of a team chat so teammates in the main thread can catch up.
Write a short markdown summary: what was worked on, decisions and results, and open questions.
Use bullet points and stay under 150 words. Do not invent details that are not in the transcript.`

export const BRIEF_PROMPT = `You maintain the brief for the main thread of a team chat. The main thread is where the team plans;
side branches are workstreams (frontend, backend, a feature) whose AI reads this brief to stay in sync with main.
You get the current brief, the team's branches, the names of the shared documents, and the latest main-thread messages.
Write the updated brief in markdown: the current direction, decisions made, who is working on what (by branch), and open questions.
Keep points from the current brief that are still true. Do not copy the documents; refer to them by name.
Stay under 250 words. Do not invent details that are not in the input.`

// One-shot (non-streaming) summary of a transcript, on the session's key.
export async function summarize(sessionId: string, model: string, transcript: string, prompt = SUMMARY_PROMPT): Promise<string> {
  const client = clientFor(sessionId, model)
  if (!client) return `[Dev mode: no OpenRouter key. Model: ${model}. Summary of ${transcript.split('\n').length} messages would appear here.]`

  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: transcript }],
  })
  return res.choices[0]?.message?.content?.trim() || '(The model returned an empty summary.)'
}

// ─── Generate reply ───────────────────────────────────────────────────────────

export async function generateReply(branchId: string, pendingMsgId: string, sessionId: string) {
  const db = getDb()

  // A new branch's context is written right after it is created; its first reply waits for it.
  await whenBranchContextReady(branchId)

  const branch = db.select().from(branches).where(eq(branches.id, branchId)).get()
  if (!branch) return

  const pendingMsg = db.select().from(messages).where(eq(messages.id, pendingMsgId)).get()
  if (!pendingMsg) return

  // Set to streaming
  db.update(messages).set({ status: 'streaming' }).where(eq(messages.id, pendingMsgId)).run()

  try {
    const client = clientFor(sessionId, branch.model)
    const parent = parentBranchOf(branch)
    const context = buildContext(branch, pendingMsgId, Boolean(client && parent))

    if (!client) {
      // No key in dev — return a stub reply
      const stubContent = `[Dev mode: no OpenRouter key. Model: ${branch.model}. Context messages: ${context.length}]`
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

    const fullContent = await chatWithTools({
      client,
      model: branch.model,
      messages: context,
      // The question and answer are recorded in the branch, just before this reply.
      askParent: parent
        ? async (question) => {
          const answer = await answerFromBranch(parent, question, branch.name)
          recordAskBeforeReply(pendingMsgId, question, answer, parent)
          return answer
        }
        : null,
      onDelta: (text) => bus.emitSession(sessionId, {
        type: 'assistant_delta',
        payload: { messageId: pendingMsgId, branchId, text },
      }),
    })

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
