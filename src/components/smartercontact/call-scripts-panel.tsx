'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface CallScript {
  id: string
  name: string
  body: string
  created_at: string
  updated_at: string | null
}

/**
 * Self-contained call-script manager: list, create, edit, and delete scripts
 * used on the Dialer. Consumes /api/sc/call-scripts. Embeddable anywhere.
 */
export function CallScriptsPanel() {
  const [scripts, setScripts] = useState<CallScript[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/sc/call-scripts')
      const json = await res.json()
      if (res.ok) setScripts(json.scripts || [])
      else setError(json.error || 'Failed to load')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function selectScript(s: CallScript) {
    setSelectedId(s.id)
    setName(s.name)
    setBody(s.body)
    setError('')
  }

  function newScript() {
    setSelectedId(null)
    setName('')
    setBody('')
    setError('')
  }

  async function save() {
    if (!name.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sc/call-scripts', {
        method: selectedId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedId ? { id: selectedId, name, body } : { name, body }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Save failed')
      } else {
        await load()
        if (json.script) selectScript(json.script)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setError('')
    try {
      const res = await fetch(`/api/sc/call-scripts?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Delete failed')
        return
      }
      if (selectedId === id) newScript()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Script list */}
      <aside className="w-64 border-r border-[var(--ck-border)] flex flex-col shrink-0">
        <div className="p-3 border-b border-[var(--ck-border)]">
          <button
            onClick={newScript}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[#E32E2E] text-white text-sm font-bold py-2 hover:bg-[#c72828]"
          >
            <Icon name="add" size="text-lg" /> New script
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-[var(--ck-text-dim)]">Loading…</div>
          ) : scripts.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--ck-text-dim)]">No scripts yet</div>
          ) : (
            scripts.map((s) => (
              <button
                key={s.id}
                onClick={() => selectScript(s)}
                className={`w-full text-left px-3 py-3 border-b border-[var(--ck-border)] hover:bg-white/5 ${
                  selectedId === s.id ? 'bg-white/5' : ''
                }`}
              >
                <div className="text-sm font-semibold text-[var(--ck-text)] truncate">{s.name}</div>
                <div className="text-xs text-[var(--ck-text-dim)] truncate">{s.body || '—'}</div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Editor */}
      <section className="flex-1 flex flex-col min-w-0 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-white">
            {selectedId ? 'Edit script' : 'New script'}
          </h2>
          {selectedId && (
            <button
              onClick={() => remove(selectedId)}
              className="flex items-center gap-1 text-sm text-[var(--ck-text-muted)] hover:text-[#E32E2E]"
            >
              <Icon name="delete" size="text-lg" /> Delete
            </button>
          )}
        </div>

        <label className="text-xs font-semibold text-[var(--ck-text-dim)] mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cold call — distressed seller"
          className="mb-3 rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
        />

        <label className="text-xs font-semibold text-[var(--ck-text-dim)] mb-1">Script</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write the call script here…"
          className="flex-1 resize-none rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)] font-mono"
        />

        {error && <div className="mt-2 text-xs text-[#E32E2E]">{error}</div>}

        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-[#E32E2E] text-white disabled:opacity-40 hover:bg-[#c72828]"
          >
            {saving ? 'Saving…' : selectedId ? 'Save changes' : 'Create script'}
          </button>
        </div>
      </section>
    </div>
  )
}
