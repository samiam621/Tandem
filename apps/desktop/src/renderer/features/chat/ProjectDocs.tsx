import React, { useRef, useState } from 'react'
import { DOC_UPLOAD_MAX_BYTES } from '@tandem/shared'
import type { ProjectDocMeta, ProjectDoc, User } from '@tandem/shared'
import { api } from '../../lib/api'

interface Props {
  sessionId: string
  sessionOwnerId: string
  currentUserId: string | undefined
  docs: ProjectDocMeta[]
  members: User[]
  onDocCreated: (doc: ProjectDocMeta) => void
  onDocDeleted: (docId: string) => void
}

// ─── Accepted file types ──────────────────────────────────────────────────────
const ACCEPT = '.md,.markdown,.txt,.json,.yaml,.yml,.csv,.ts,.tsx,.js,.py,.go,.rs,.java,.sql,.html,.css,.pdf'

// ─── Viewer modal ─────────────────────────────────────────────────────────────

interface ViewerProps {
  meta: ProjectDocMeta
  sessionOwnerId: string
  currentUserId: string | undefined
  onClose: () => void
  onDeleted: (docId: string) => void
}

function DocViewer({ meta, sessionOwnerId, currentUserId, onClose, onDeleted }: ViewerProps) {
  const [doc, setDoc] = useState<ProjectDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Fetch content on mount
  React.useEffect(() => {
    api.docs.get(meta.id).then(setDoc).catch((e) => setError(e.message ?? 'Failed to load')).finally(() => setLoading(false))
  }, [meta.id])

  const canDelete = currentUserId === meta.uploadedBy || currentUserId === sessionOwnerId

  async function handleDelete() {
    if (!confirm(`Delete "${meta.title}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await api.docs.delete(meta.id)
      onDeleted(meta.id)
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Delete failed')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3 shrink-0">
          <div>
            <h2 className="text-sm font-semibold truncate max-w-md">{meta.title}</h2>
            <p className="text-[11px] text-gray-500">
              {meta.kind === 'pdf' ? 'PDF · ' : ''}{meta.chars.toLocaleString()} chars
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs rounded-lg bg-red-800/70 px-2.5 py-1 hover:bg-red-700/70 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm px-2">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {loading && <p className="text-sm text-gray-500">Loading…</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {doc && (
            <pre className="text-xs text-gray-200 whitespace-pre-wrap break-words font-mono leading-relaxed">
              {doc.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function ProjectDocs({ sessionId, sessionOwnerId, currentUserId, docs, members, onDocCreated, onDocDeleted }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [viewingDoc, setViewingDoc] = useState<ProjectDocMeta | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!fileInputRef.current) return
    // Reset so the same file can be re-uploaded after an error
    fileInputRef.current.value = ''
    if (!file) return

    setUploadError(null)
    setUploading(true)
    try {
      let body: { title: string; text: string } | { title: string; pdfBase64: string }

      if (file.name.toLowerCase().endsWith('.pdf')) {
        if (file.size > DOC_UPLOAD_MAX_BYTES) {
          setUploadError(`PDF is too large (max ${Math.round(DOC_UPLOAD_MAX_BYTES / 1024 / 1024)} MB)`)
          return
        }
        const buf = await file.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const pdfBase64 = btoa(binary)
        body = { title: file.name, pdfBase64 }
      } else {
        const text = await file.text()
        body = { title: file.name, text }
      }

      const meta = await api.docs.upload(sessionId, body)
      onDocCreated(meta)
    } catch (err: any) {
      setUploadError(err.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      {/* Card */}
      <div className="mx-2 mb-2 rounded-lg border border-gray-800">
        {/* Card header */}
        <div className="flex items-center justify-between px-2.5 py-2 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-300">
            Project docs{docs.length > 0 ? ` (${docs.length})` : ''}
          </span>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-[10px] text-gray-400 hover:text-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-700 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : '+ Upload'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Error */}
        {uploadError && (
          <div className="flex items-center justify-between gap-1 px-2.5 py-1 bg-red-950/40 border-b border-gray-800">
            <span className="text-[10px] text-red-400 truncate">{uploadError}</span>
            <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-300 text-[10px] shrink-0">✕</button>
          </div>
        )}

        {/* Doc list */}
        {docs.length === 0 ? (
          <p className="px-2.5 py-2 text-[10px] text-gray-600">No docs yet. Upload a file to give every branch's AI shared context.</p>
        ) : (
          <ul>
            {docs.map((doc) => {
              const uploaderName = members.find((m) => m.id === doc.uploadedBy)?.displayName
              return (
                <li key={doc.id}>
                  <button
                    onClick={() => setViewingDoc(doc)}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-gray-800 group"
                  >
                    <div className="text-[11px] text-gray-300 truncate group-hover:text-white">{doc.title}</div>
                    <div className="text-[10px] text-gray-600">
                      {doc.kind === 'pdf' ? 'PDF · ' : ''}{doc.chars.toLocaleString()} chars
                      {uploaderName ? ` · ${uploaderName}` : ''}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Doc viewer modal */}
      {viewingDoc && (
        <DocViewer
          meta={viewingDoc}
          sessionOwnerId={sessionOwnerId}
          currentUserId={currentUserId}
          onClose={() => setViewingDoc(null)}
          onDeleted={(id) => { onDocDeleted(id); setViewingDoc(null) }}
        />
      )}
    </>
  )
}
