import type { messages } from '../db/schema.js'

type MessageRow = typeof messages.$inferSelect
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string }

export const MULTIPLAYER_PROMPT = `You are the AI assistant in a shared team chat. Several people (and sometimes coding agents) talk in the same thread.
Each non-assistant message starts with the speaker's name, as "Name: message". Use names to tell speakers apart and address people by name when useful.
Do not start your own replies with a name prefix.`

export const BRIEF_HEADER = 'Brief: the current summary of the main thread, where the team plans (direction, decisions, who is on what):'
export const DOCUMENT_HEADER = 'Project document'
export const OTHER_DOCUMENTS_HEADER = 'Other project documents exist but are not loaded in this branch (ask a teammate, or an agent can read them):'
export const BRANCH_CONTEXT_HEADER = 'Branch context: this branch split off from a parent conversation you do not see in full. This is what the branch needs from it; sources are in [brackets].'
export const ASK_PARENT_HINT = 'If you need something from the parent conversation that is not here, call the ask_parent tool instead of guessing.'
export const FORK_TAIL_HEADER = 'The last messages before this branch split off, verbatim:'

// The fork tail: the last few finished messages up to the fork point, kept word for word so the
// message a branch split from still reads in context (a summary loses the exact wording).
export const FORK_TAIL_MESSAGES = 6
export const FORK_TAIL_MAX_CHARS = 16_000

export interface SharedContext {
  brief?: string
  documents?: { name: string; content: string }[] // the branch's selected documents, read in full
  otherDocumentNames?: string[]
  branchContext?: string | null // every branch except main
  purpose?: string | null
  canAskParent?: boolean // the model is offered the ask_parent tool
}

// Walks parent_id links from headMessageId up to the root and returns the path oldest first.
// Siblings are never reached.
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

// The newest finished messages of `path`, at most FORK_TAIL_MESSAGES and FORK_TAIL_MAX_CHARS
// (the newest one is always kept).
export function forkTail(path: MessageRow[]): MessageRow[] {
  const done = path.filter((m) => m.status === 'done')
  const tail: MessageRow[] = []
  let chars = 0
  for (let i = done.length - 1; i >= 0 && tail.length < FORK_TAIL_MESSAGES; i--) {
    chars += done[i].content.length + (done[i].askQuestion?.length ?? 0)
    if (tail.length && chars > FORK_TAIL_MAX_CHARS) break
    tail.unshift(done[i])
  }
  return tail
}

// A branch's history as its AI sees it. Main (no forkMessageId): the whole path. Any other branch:
// the fork tail, then the branch's own messages. Its parent's earlier messages are left out; the
// branch context stands in for them.
export function branchHistory(rows: MessageRow[], headMessageId: string, forkMessageId: string | null): { tail: MessageRow[]; own: MessageRow[] } {
  const path = pathToHead(rows, headMessageId)
  if (!forkMessageId) return { tail: [], own: path }
  const fork = path.findIndex((m) => m.id === forkMessageId)
  return { tail: forkTail(path.slice(0, fork + 1)), own: path.slice(fork + 1) }
}

export function speakerName(m: MessageRow, nameById: Map<string, string>): string {
  return m.agentLabel ?? nameById.get(m.authorId) ?? 'Unknown'
}

function toChatMsg(m: MessageRow, nameById: Map<string, string>): ChatMsg {
  if (m.kind === 'ask_parent') return { role: 'user', content: `ask_parent: ${m.askQuestion ?? ''}\nAnswer from the parent branch: ${m.content}` }
  if (m.authorType === 'assistant') return { role: 'assistant', content: m.content }
  return { role: 'user', content: `${speakerName(m, nameById)}: ${m.content}` }
}

// Maps a branch's history up to headMessageId (usually the pending assistant message) into chat
// messages. Only finished messages are included, so the pending message itself is skipped. User and agent messages are prefixed
// with the speaker's name (an agent's token label wins over its user's display name).
//
// Order, least-changing first so branches share a cached prompt prefix: the multiplayer prompt,
// the documents the branch reads, the names of the rest, the branch context, the brief, then the
// history. Brief, documents, and branch context are passed in live, not taken from the path.
export function buildChatContext(
  rows: MessageRow[],
  headMessageId: string,
  nameById: Map<string, string>,
  shared: SharedContext = {},
  forkMessageId: string | null = null,
): ChatMsg[] {
  const { tail, own } = branchHistory(rows, headMessageId, forkMessageId)
  const turns = (list: MessageRow[]) => list.filter((m) => m.status === 'done').map((m) => toChatMsg(m, nameById))

  const system: ChatMsg[] = [{ role: 'system', content: MULTIPLAYER_PROMPT }]
  for (const doc of shared.documents ?? []) {
    system.push({ role: 'system', content: `${DOCUMENT_HEADER}: ${doc.name}\n\n${doc.content}` })
  }
  if (shared.otherDocumentNames?.length) {
    system.push({ role: 'system', content: `${OTHER_DOCUMENTS_HEADER} ${shared.otherDocumentNames.join(', ')}` })
  }
  if (forkMessageId) {
    const parts = [BRANCH_CONTEXT_HEADER]
    if (shared.purpose?.trim()) parts.push(`This branch is for: ${shared.purpose.trim()}`)
    parts.push(shared.branchContext?.trim() || '(No branch context has been written yet.)')
    if (shared.canAskParent) parts.push(ASK_PARENT_HINT)
    system.push({ role: 'system', content: parts.join('\n\n') })
  }
  if (shared.brief?.trim()) system.push({ role: 'system', content: `${BRIEF_HEADER}\n\n${shared.brief}` })

  const tailTurns = turns(tail)
  if (tailTurns.length) system.push({ role: 'system', content: FORK_TAIL_HEADER })
  return [...system, ...tailTurns, ...turns(own)]
}
