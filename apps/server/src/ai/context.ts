import type { messages } from '../db/schema.js'

type MessageRow = typeof messages.$inferSelect
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string }

export const MULTIPLAYER_PROMPT = `You are the AI assistant in a shared team chat. Several people (and sometimes coding agents) talk in the same thread.
Each non-assistant message starts with the speaker's name, as "Name: message". Use names to tell speakers apart and address people by name when useful.
Do not start your own replies with a name prefix.`

export const BRIEF_HEADER = 'Project brief (shared by every branch; the current source of truth for specs and decisions):'

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
): ChatMsg[] {
  const turns = pathToHead(rows, pendingMessageId)
    .filter((m) => m.id !== pendingMessageId && m.status === 'done')
    .map((m): ChatMsg => {
      if (m.authorType === 'assistant') return { role: 'assistant', content: m.content }
      const name = m.agentLabel ?? nameById.get(m.authorId) ?? 'Unknown'
      return { role: 'user', content: `${name}: ${m.content}` }
    })
  const system: ChatMsg[] = [{ role: 'system', content: MULTIPLAYER_PROMPT }]
  if (brief.trim()) system.push({ role: 'system', content: `${BRIEF_HEADER}\n\n${brief}` })
  return [...system, ...turns]
}
