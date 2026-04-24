'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import {
  DOC_TYPES,
  docTypeIcon,
  docTypeLabel,
  formatBytes,
  type DocType,
  type DocumentRow,
  type EntityType,
} from '@/lib/documents'

// A reusable uploader + list. Drop it onto any detail page:
//   <DocumentManager entityType="lead"  entityId={lead.id} />
//   <DocumentManager entityType="offer" entityId={offer.id} uploadedBy="Ernest" />
interface Props {
  entityType: EntityType
  entityId: string
  uploadedBy?: string
  // Restrict the doc-type dropdown to acquisitions or dispositions types only
  side?: 'acquisitions' | 'dispositions' | 'both'
  defaultDocType?: DocType
  title?: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function DocumentManager({
  entityType,
  entityId,
  uploadedBy,
  side = 'both',
  defaultDocType = 'other',
  title = 'Documents',
}: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingType, setPendingType] = useState<DocType>(defaultDocType)
  const [pendingNotes, setPendingNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const types = DOC_TYPES.filter(t => side === 'both' || t.side === side || t.side === 'both')

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ entity_type: entityType, entity_id: entityId })
      const res = await fetch(`/api/documents?${params}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      const data = await res.json()
      setDocs(data.documents ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setPendingFile(files[0])
    setPendingType(defaultDocType)
    setPendingNotes('')
    setError(null)
  }

  async function doUpload() {
    if (!pendingFile) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', pendingFile)
      form.append('entity_type', entityType)
      form.append('entity_id', entityId)
      form.append('doc_type', pendingType)
      if (pendingNotes) form.append('notes', pendingNotes)
      if (uploadedBy) form.append('uploaded_by', uploadedBy)
      const res = await fetch('/api/documents', { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed')
      setPendingFile(null)
      setPendingNotes('')
      if (inputRef.current) inputRef.current.value = ''
      await fetchDocs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(doc: DocumentRow) {
    if (!confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
      await fetchDocs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handleTypeChange(doc: DocumentRow, next: DocType) {
    try {
      await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_type: next }),
      })
      setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, doc_type: next } : d))
    } catch {
      // ignore — refetch will sync
    }
  }

  return (
    <div className="bg-[var(--ck-surface)] border border-[var(--ck-border)] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ck-border)] bg-[var(--ck-surface-elev)]">
        <div className="flex items-center gap-2">
          <Icon name="folder" size="text-base" className="text-[var(--ck-text-muted)]" />
          <h3 className="text-sm font-bold text-[var(--ck-text)]">{title}</h3>
          <span className="text-xs text-[var(--ck-text-muted)]">
            · {docs.length} file{docs.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Dropzone / pending-upload form */}
      <div className="p-4 border-b border-[var(--ck-border)]">
        {pendingFile ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] rounded-lg px-3 py-2">
              <Icon name="insert_drive_file" size="text-lg" className="text-[var(--ck-text-muted)]" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--ck-text)] truncate">{pendingFile.name}</p>
                <p className="text-xs text-[var(--ck-text-muted)]">{formatBytes(pendingFile.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => { setPendingFile(null); if (inputRef.current) inputRef.current.value = '' }}
                className="text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] p-1"
              >
                <Icon name="close" size="text-base" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)] mb-1">
                  Document type
                </label>
                <select
                  className="w-full bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] rounded-lg px-3 py-2 text-sm text-[var(--ck-text)] focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30 focus:border-[#E32E2E]/60"
                  value={pendingType}
                  onChange={e => setPendingType(e.target.value as DocType)}
                >
                  {types.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)] mb-1">
                  Notes (optional)
                </label>
                <input
                  type="text"
                  className="w-full bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] rounded-lg px-3 py-2 text-sm text-[var(--ck-text)] focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30 focus:border-[#E32E2E]/60"
                  value={pendingNotes}
                  onChange={e => setPendingNotes(e.target.value)}
                  placeholder="e.g. fully executed, signed 2026-04-24"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setPendingFile(null); if (inputRef.current) inputRef.current.value = '' }}
                className="text-sm font-semibold text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] px-4 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doUpload}
                disabled={uploading}
                className="flex items-center gap-1.5 bg-[#E32E2E] hover:bg-[#c72626] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                <Icon name="upload" size="text-sm" />
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        ) : (
          <label
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              handleFiles(e.dataTransfer.files)
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors',
              dragOver
                ? 'border-[#E32E2E]/60 bg-[#E32E2E]/5 text-[var(--ck-accent-bright)]'
                : 'border-[var(--ck-border-strong)] text-[var(--ck-text-muted)] hover:border-[#E32E2E]/50 hover:text-[var(--ck-text)]'
            )}
          >
            <Icon name="cloud_upload" size="text-2xl" />
            <p className="text-sm font-semibold">Drop a file or click to browse</p>
            <p className="text-xs">PDF, images, Word, etc. Max 50 MB.</p>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={e => handleFiles(e.target.files)}
            />
          </label>
        )}

        {error && (
          <div className="mt-3 bg-[#E32E2E]/10 border border-[#E32E2E]/40 text-[var(--ck-accent-bright)] rounded-lg px-3 py-2 text-xs">
            {error}
          </div>
        )}
      </div>

      {/* File list */}
      {loading ? (
        <div className="p-4 text-sm text-[var(--ck-text-muted)]">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="p-4 text-sm text-[var(--ck-text-muted)] text-center">
          No documents yet.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--ck-border)]">
          {docs.map(doc => (
            <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <Icon
                name={docTypeIcon(doc.doc_type)}
                size="text-lg"
                className="text-[var(--ck-text-muted)] shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={`/api/documents/${doc.id}/download?preview=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-[var(--ck-text)] hover:text-[var(--ck-accent-bright)] truncate max-w-[320px]"
                    title={doc.filename}
                  >
                    {doc.filename}
                  </a>
                  <select
                    value={doc.doc_type}
                    onChange={e => handleTypeChange(doc, e.target.value as DocType)}
                    onClick={e => e.stopPropagation()}
                    className="bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] rounded-full text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)] px-2 py-0.5 cursor-pointer hover:border-[#E32E2E]/40"
                  >
                    {types.map(t => (
                      <option key={t.value} value={t.value}>{docTypeLabel(t.value)}</option>
                    ))}
                  </select>
                </div>
                <div className="text-[11px] text-[var(--ck-text-muted)] mt-0.5">
                  {formatDate(doc.uploaded_at)}
                  {doc.uploaded_by && <> · {doc.uploaded_by}</>}
                  {doc.byte_size != null && <> · {formatBytes(doc.byte_size)}</>}
                  {doc.notes && <span className="ml-1 italic">· {doc.notes}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={`/api/documents/${doc.id}/download`}
                  className="p-2 rounded-lg text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] hover:bg-[var(--ck-surface-elev)]"
                  title="Download"
                >
                  <Icon name="download" size="text-base" />
                </a>
                <button
                  type="button"
                  onClick={() => handleDelete(doc)}
                  className="p-2 rounded-lg text-[var(--ck-text-muted)] hover:text-[var(--ck-accent-bright)] hover:bg-[#E32E2E]/10"
                  title="Delete"
                >
                  <Icon name="delete" size="text-base" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
