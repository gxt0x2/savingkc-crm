'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { ScNav } from '@/components/smartercontact/sc-nav'

interface Job {
  id: string
  filename: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  total_rows: number
  matched_rows: number
  created_at: string
  note?: string
}

type SubTab = 'add' | 'files'

function statusColor(status: Job['status']): string {
  switch (status) {
    case 'completed':
      return 'text-emerald-400'
    case 'failed':
      return 'text-[#E32E2E]'
    case 'processing':
    case 'pending':
    default:
      return 'text-[var(--ck-text-muted)]'
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function SkiptracePage() {
  const [tab, setTab] = useState<SubTab>('add')
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lastJob, setLastJob] = useState<Job | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const loadJobs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/sc/skiptrace')
      const json = await res.json()
      if (res.ok) setJobs(json.jobs || [])
      else setError(json.error || 'Failed to load')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  const upload = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        setError('Please choose a .csv file')
        return
      }
      setUploading(true)
      setError('')
      setLastJob(null)
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/sc/skiptrace', { method: 'POST', body: form })
        const json = await res.json()
        if (json.job) {
          setLastJob(json.job)
          loadJobs()
        }
        if (!res.ok && !json.job) setError(json.error || 'Upload failed')
        else if (json.error) setError(json.error)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [loadJobs],
  )

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) upload(file)
  }

  return (
    <div className="flex flex-col h-full">
      <ScNav />
      <div className="flex flex-1 min-h-0">
        {/* Sub-nav */}
        <aside className="w-48 border-r border-[var(--ck-border)] p-3 flex flex-col gap-1 shrink-0">
          <button
            onClick={() => setTab('add')}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
              tab === 'add' ? 'bg-[#E32E2E]/15 text-white' : 'text-[var(--ck-text-muted)] hover:bg-white/5'
            }`}
          >
            <Icon name="upload_file" size="text-lg" className="text-[var(--ck-text-dim)]" /> Add new
          </button>
          <button
            onClick={() => setTab('files')}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
              tab === 'files' ? 'bg-[#E32E2E]/15 text-white' : 'text-[var(--ck-text-muted)] hover:bg-white/5'
            }`}
          >
            <Icon name="folder" size="text-lg" className="text-[var(--ck-text-dim)]" /> All files
          </button>
        </aside>

        <section className="flex-1 min-w-0 overflow-y-auto p-6">
          {/* No-provider banner */}
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-2 text-xs text-[var(--ck-text-muted)]">
            <Icon name="info" size="text-base" className="text-[var(--ck-text-dim)] mt-0.5" />
            <span>
              Connect a skip-trace provider (set{' '}
              <code className="text-[var(--ck-text)]">SKIPTRACE_API_URL</code> /{' '}
              <code className="text-[var(--ck-text)]">SKIPTRACE_API_KEY</code>) to enable phone/email
              append. Uploaded files are stored and returned unchanged until then.
            </span>
          </div>

          {tab === 'add' ? (
            <div className="max-w-xl">
              <h1 className="text-lg font-bold text-white mb-1">Upload a list</h1>
              <p className="text-sm text-[var(--ck-text-dim)] mb-4">
                Upload a CSV of names and addresses to append phone and email.
              </p>

              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInput.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
                  dragOver
                    ? 'border-[#E32E2E] bg-[#E32E2E]/5'
                    : 'border-[var(--ck-border)] hover:border-[var(--ck-text-dim)]'
                }`}
              >
                <Icon name="cloud_upload" size="text-5xl" className="text-[var(--ck-text-dim)] mb-2" />
                <div className="text-sm text-[var(--ck-text)]">
                  {uploading ? 'Uploading…' : 'Drag & drop a .csv here, or click to browse'}
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) upload(f)
                    e.target.value = ''
                  }}
                />
              </div>

              {error && <div className="mt-3 text-sm text-[#E32E2E]">{error}</div>}

              {lastJob && (
                <div className="mt-4 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon
                      name={lastJob.status === 'failed' ? 'error' : 'check_circle'}
                      size="text-lg"
                      className={statusColor(lastJob.status)}
                    />
                    <span className="font-semibold text-white">{lastJob.filename}</span>
                  </div>
                  <div className="text-sm text-[var(--ck-text-muted)]">
                    {lastJob.status === 'failed' ? (
                      'Job failed.'
                    ) : (
                      <>
                        {lastJob.matched_rows} of {lastJob.total_rows} rows matched.
                      </>
                    )}
                  </div>
                  {lastJob.note && (
                    <div className="mt-1 text-xs text-[var(--ck-text-dim)]">{lastJob.note}</div>
                  )}
                  {lastJob.status === 'completed' && (
                    <a
                      href={`/api/sc/skiptrace/${lastJob.id}?format=csv`}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#E32E2E] text-white text-sm font-bold px-3 py-2 hover:bg-[#c72828]"
                    >
                      <Icon name="download" size="text-lg" /> Download results
                    </a>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <h1 className="text-lg font-bold text-white mb-4">All files</h1>
              {error && <div className="mb-3 text-sm text-[#E32E2E]">{error}</div>}
              {loading ? (
                <div className="text-sm text-[var(--ck-text-dim)]">Loading…</div>
              ) : jobs.length === 0 ? (
                <div className="text-sm text-[var(--ck-text-dim)]">No files uploaded yet</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--ck-text-dim)] border-b border-[var(--ck-border)]">
                        <th className="py-2 pr-4 font-semibold">File</th>
                        <th className="py-2 pr-4 font-semibold">Status</th>
                        <th className="py-2 pr-4 font-semibold">Rows</th>
                        <th className="py-2 pr-4 font-semibold">Matched</th>
                        <th className="py-2 pr-4 font-semibold">Uploaded</th>
                        <th className="py-2 font-semibold"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j) => (
                        <tr key={j.id} className="border-b border-[var(--ck-border)]">
                          <td className="py-2 pr-4 text-[var(--ck-text)]">{j.filename}</td>
                          <td className={`py-2 pr-4 capitalize font-semibold ${statusColor(j.status)}`}>
                            {j.status}
                          </td>
                          <td className="py-2 pr-4 text-[var(--ck-text-muted)]">{j.total_rows}</td>
                          <td className="py-2 pr-4 text-[var(--ck-text-muted)]">{j.matched_rows}</td>
                          <td className="py-2 pr-4 text-[var(--ck-text-dim)]">{fmtDate(j.created_at)}</td>
                          <td className="py-2">
                            {j.status === 'completed' && (
                              <a
                                href={`/api/sc/skiptrace/${j.id}?format=csv`}
                                className="inline-flex items-center gap-1 text-[#E32E2E] hover:underline"
                              >
                                <Icon name="download" size="text-base" /> Download
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
