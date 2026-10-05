import type { DocExcerpt } from '@tandem/shared'

type Doc = { id: string; title: string; content: string }

const CHUNK_CHARS = 1500

const STOPWORDS = new Set(
  'the and for are but not you all any can her was one our out his has had how its may new now see two who did get him let say she too use with that this from have what when will your they them then than into more some such only also been were which there their about would could should these those where while'.split(' '),
)

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

// Splits a doc on blank lines into passages of about CHUNK_CHARS, keeping paragraphs whole when they fit.
export function chunkDoc(doc: Doc): DocExcerpt[] {
  const chunks: DocExcerpt[] = []
  let cur = ''
  const flush = () => {
    if (cur.trim()) chunks.push({ docId: doc.id, title: doc.title, text: cur.trim() })
    cur = ''
  }
  for (const para of doc.content.split(/\n\s*\n/)) {
    if (cur && cur.length + para.length > CHUNK_CHARS) flush()
    // A single paragraph longer than a chunk is cut into pieces
    for (let i = 0; i < para.length; i += CHUNK_CHARS) {
      const piece = para.slice(i, i + CHUNK_CHARS)
      if (cur && cur.length + piece.length > CHUNK_CHARS) flush()
      cur += (cur ? '\n\n' : '') + piece
    }
  }
  flush()
  return chunks
}

// Ranks passages by the summed IDF of the query terms they contain; returns the top k that match at all.
// ponytail: keyword scoring, swap for embeddings if recall is poor on real docs.
export function searchDocs(docs: Doc[], query: string, k: number): DocExcerpt[] {
  const q = [...new Set(terms(query))]
  if (!q.length) return []
  const chunks = docs.flatMap(chunkDoc).map((c) => ({ c, words: new Set(terms(`${c.title} ${c.text}`)) }))
  const idf = new Map(q.map((t) => [t, Math.log(1 + chunks.length / (1 + chunks.filter((x) => x.words.has(t)).length))]))
  return chunks
    .map(({ c, words }) => ({ c, score: q.reduce((s, t) => s + (words.has(t) ? idf.get(t)! : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.c)
}
