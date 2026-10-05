// Citations in a branch context name where each point came from:
//   a document, by name and optional heading: [FRONTEND.md § Styling]
//   a discussion, by author, branch, and date: [Sam in main, Oct 2]
// A model can invent a document name, so document citations are checked against the session's
// documents and unknown ones are dropped. Discussion citations, Markdown links ([text](url)) and
// task-list boxes ([ ], [x]) are left alone.

const CITATION = /\s?\[([^\[\]\n]{2,200})\](?!\()/g
const DISCUSSION = /^.+ in .+, .+$/

export function dropUnknownDocumentCitations(text: string, documentNames: string[]): string {
  const known = new Set(documentNames.map((n) => n.toLowerCase()))
  return text.replace(CITATION, (whole, inner: string) => {
    if (DISCUSSION.test(inner)) return whole
    const name = inner.split(' § ')[0].trim().toLowerCase()
    return known.has(name) ? whole : ''
  })
}
