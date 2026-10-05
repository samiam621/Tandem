import { PINNED_DOCS_MAX_CHARS, DOC_EXCERPTS_K } from '@tandem/shared'
import type { messages } from '../db/schema.js'
import { searchDocs } from './docs.js'

type MessageRow = typeof messages.$inferSelect
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string }

export const MULTIPLAYER_PROMPT = `You are the AI assistant in a shared team chat. Several people (and sometimes coding agents) talk in the same thread.
Each non-assistant message starts with the speaker's name, as "Name: message". Use names to tell speakers apart and address people by name when useful.
Do not start your own replies with a name prefix.`

export const BRIEF_HEADER = 'Project brief (shared by every branch; the current source of truth for specs and decisions):'
export const PINNED_HEADER = 'Project docs pinned to this branch:'
export const EXCERPTS_HEADER = 'Excerpts from project docs not pinned to this branch, matched to the latest message:'

type Doc = { id: string; title: string; content: string }
export type BranchDocs = { pinned: Doc[]; others: Doc[] }

// Pinned docs in full up to PINNED_DOCS_MAX_CHARS, an index of every doc, then the unpinned
// passages that best match the latest message. Docs, like the brief, are read live.
function docMessages({ pinned, others }: BranchDocs, query: string): ChatMsg[] {
  if (!pinned.length && !others.length) return []
  const out: ChatMsg[] = []
  if (pinned.length) {
    let body = pinned.map((d) => `### ${d.title}\n\n${d.content}`).join('\n\n')
    if (body.length > PINNED_DOCS_MAX_CHARS) {
      body = `${body.slice(0, PINNED_DOCS_MAX_CHARS)}\n\n[Truncated: pinned docs exceed ${PINNED_DOCS_MAX_CHARS.toLocaleString('en-US')} characters.]`
    }
    out.push({ role: 'system', content: `${PINNED_HEADER}\n\n${body}` })
  }
  const index = [...pinned.map((d) => `- ${d.title} (pinned)`), ...others.map((d) => `- ${d.title}`)].join('\n')
  out.push({ role: 'system', content: `Project docs index:\n${index}` })
  const excerpts = searchDocs(others, query, DOC_EXCERPTS_K)
  if (excerpts.length) {
    out.push({ role: 'system', content: `${EXCERPTS_HEADER}\n\n${excerpts.map((e) => `[${e.title}]\n${e.text}`).join('\n\n')}` })
  }
  return out
}

// Walks parent_id links from headMessageId up to the root and returns the path oldest first.
// This is what scopes a branch to its fork history plus its own messages: siblings are never reached.
export function pathToHead(rows: MessageRow[], headMessageId: string): MessageRow[] {
  const byId = new Map(rows.map((m) => [m.id, m]))
  const path: MessageRow[] = []
  let cur = byId.get(headMessageId)
  while (cur) {
    path.push(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return path.reverse()
}

// Maps the path to the pending assistant message into chat messages. The pending message itself and
// any pending/error messages are skipped. User and agent messages are prefixed with the speaker's name
// (an agent's token label wins over its user's display name). The session brief is passed in live,
// not taken from the path, so a branch forked before a brief edit still sees the latest version.
export function buildChatContext(
  rows: MessageRow[],
  pendingMessageId: string,
  nameById: Map<string, string>,
  brief = '',
  docs: BranchDocs = { pinned: [], others: [] },
): ChatMsg[] {
  const done = pathToHead(rows, pendingMessageId).filter((m) => m.id !== pendingMessageId && m.status === 'done')
  const turns = done
    .map((m): ChatMsg => {
      if (m.authorType === 'assistant') return { role: 'assistant', content: m.content }
      const name = m.agentLabel ?? nameById.get(m.authorId) ?? 'Unknown'
      return { role: 'user', content: `${name}: ${m.content}` }
    })
  const system: ChatMsg[] = [{ role: 'system', content: MULTIPLAYER_PROMPT }]
  if (brief.trim()) system.push({ role: 'system', content: `${BRIEF_HEADER}\n\n${brief}` })
  const lastUserMsg = [...done].reverse().find((m) => m.authorType !== 'assistant')?.content ?? ''
  system.push(...docMessages(docs, lastUserMsg))
  return [...system, ...turns]
}
