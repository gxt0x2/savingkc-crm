'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { ScNav } from '@/components/smartercontact/sc-nav'
import { formatPhone } from '@/lib/format'
import type { ScContact, ScGroup } from '@/lib/smartercontact/types'

type View = 'groups' | 'contacts' | 'suppressed'

interface SuppressedRow {
  id: string
  phone: string
  is_opted_out: boolean
  opted_out_at: string | null
  opted_in_at: string | null
  reason: string | null
}

const CONTACT_FIELDS = [
  { value: '', label: '— Ignore / Custom field —' },
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'phone', label: 'Phone (required)' },
  { value: 'email', label: 'Email' },
  { value: 'address', label: 'Address' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'zip', label: 'Zip' },
]

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

const inputCls =
  'w-full rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]'
const btnPrimary =
  'flex items-center justify-center gap-1.5 rounded-lg bg-[#E32E2E] text-white text-sm font-bold px-3 py-2 hover:bg-[#c72828] disabled:opacity-40'

export default function ContactsPage() {
  const [view, setView] = useState<View>('groups')

  return (
    <div className="flex flex-col h-full">
      <ScNav />
      <div className="flex flex-1 min-h-0">
        {/* Sub-nav rail */}
        <aside className="w-52 border-r border-[var(--ck-border)] p-3 flex flex-col gap-1 shrink-0">
          {(
            [
              { key: 'groups', label: 'Groups', icon: 'folder' },
              { key: 'contacts', label: 'Contacts', icon: 'contacts' },
              { key: 'suppressed', label: 'Suppressed contacts', icon: 'block' },
            ] as { key: View; label: string; icon: string }[]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-left ${
                view === t.key
                  ? 'bg-[#E32E2E]/15 text-white'
                  : 'text-[var(--ck-text-muted)] hover:bg-white/5'
              }`}
            >
              <Icon
                name={t.icon}
                size="text-lg"
                className={view === t.key ? 'text-[#E32E2E]' : 'text-[var(--ck-text-dim)]'}
              />
              {t.label}
            </button>
          ))}
        </aside>

        {/* Main panel */}
        <section className="flex-1 min-w-0 overflow-y-auto">
          {view === 'groups' && <GroupsView />}
          {view === 'contacts' && <ContactsView />}
          {view === 'suppressed' && <SuppressedView />}
        </section>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Groups                                                                     */
/* -------------------------------------------------------------------------- */
function GroupsView() {
  const [groups, setGroups] = useState<ScGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sc/groups')
      const json = await res.json()
      if (res.ok) setGroups(json.groups || [])
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

  async function deleteGroup(id: string) {
    if (!confirm('Delete this group? Contacts are kept.')) return
    const res = await fetch(`/api/sc/groups?id=${id}`, { method: 'DELETE' })
    if (res.ok) setGroups((g) => g.filter((x) => x.id !== id))
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">Groups</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowAddContact(true)} className={btnPrimary}>
            <Icon name="person_add" size="text-lg" /> Add new contact
          </button>
          <button onClick={() => setShowUpload(true)} className={btnPrimary}>
            <Icon name="upload_file" size="text-lg" /> Upload file
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs text-[#E32E2E]">{error}</div>}

      {loading ? (
        <div className="text-sm text-[var(--ck-text-dim)]">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-[var(--ck-text-dim)]">
          <Icon name="folder_open" size="text-6xl" className="text-[var(--ck-text-dim)] mb-2" />
          <p className="text-sm">No groups yet. Upload a file to create one.</p>
        </div>
      ) : (
        <div className="border border-[var(--ck-border)] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ck-surface)] text-[var(--ck-text-dim)]">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Name</th>
                <th className="text-left font-semibold px-3 py-2">Contacts</th>
                <th className="text-left font-semibold px-3 py-2">Source</th>
                <th className="text-left font-semibold px-3 py-2">Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className="border-t border-[var(--ck-border)] hover:bg-white/5">
                  <td className="px-3 py-2 font-semibold text-[var(--ck-text)]">{g.name}</td>
                  <td className="px-3 py-2 text-[var(--ck-text-muted)]">{g.contact_count}</td>
                  <td className="px-3 py-2 text-[var(--ck-text-muted)]">{g.source}</td>
                  <td className="px-3 py-2 text-[var(--ck-text-dim)]">{fmtDate(g.created_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => deleteGroup(g.id)}
                      title="Delete group"
                      className="p-1 rounded hover:bg-white/10 text-[var(--ck-text-dim)]"
                    >
                      <Icon name="delete" size="text-lg" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onDone={() => {
            setShowUpload(false)
            load()
          }}
        />
      )}
      {showAddContact && (
        <ContactFormModal
          onClose={() => setShowAddContact(false)}
          onSaved={() => setShowAddContact(false)}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Upload modal (preview → mapping → import)                                  */
/* -------------------------------------------------------------------------- */
function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'choose' | 'map' | 'result'>('choose')
  const [file, setFile] = useState<File | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [headers, setHeaders] = useState<string[]>([])
  const [sampleRows, setSampleRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [groupName, setGroupName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    imported: number
    skipped: number
    suppressed: number
    total: number
  } | null>(null)

  async function doPreview() {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('preview', 'true')
      fd.append('has_header', String(hasHeader))
      const res = await fetch('/api/sc/contacts/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Preview failed')
        return
      }
      setHeaders(json.headers || [])
      setSampleRows(json.sampleRows || [])
      // Auto-map columns whose name matches a field.
      const auto: Record<string, string> = {}
      for (const h of json.headers || []) {
        const norm = h.toLowerCase().replace(/[^a-z]/g, '')
        const guess = CONTACT_FIELDS.find(
          (f) => f.value && norm.includes(f.value.replace('_', '')),
        )
        if (guess) auto[h] = guess.value
      }
      setMapping(auto)
      setStep('map')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  async function doImport() {
    if (!file) return
    if (!Object.values(mapping).includes('phone')) {
      setError('Map a column to Phone before importing.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('has_header', String(hasHeader))
      fd.append('mapping', JSON.stringify(mapping))
      if (groupName.trim()) fd.append('group_name', groupName.trim())
      const res = await fetch('/api/sc/contacts/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Import failed')
        return
      }
      setResult(json)
      setStep('result')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl bg-[var(--ck-bg)] border border-[var(--ck-border)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">Upload contacts</h3>
          <button onClick={onClose} className="text-[var(--ck-text-dim)] hover:text-white">
            <Icon name="close" size="text-xl" />
          </button>
        </div>

        {error && <div className="mb-3 text-xs text-[#E32E2E]">{error}</div>}

        {step === 'choose' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-[var(--ck-text-muted)] mb-1">CSV file</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="text-sm text-[var(--ck-text)] file:mr-3 file:rounded-lg file:border-0 file:bg-[#E32E2E] file:text-white file:px-3 file:py-2 file:text-sm file:font-bold"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--ck-text-muted)]">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
              />
              First row is a header
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-2 text-sm text-[var(--ck-text-muted)]">
                Cancel
              </button>
              <button onClick={doPreview} disabled={!file || busy} className={btnPrimary}>
                {busy ? 'Reading…' : 'Next'}
              </button>
            </div>
          </div>
        )}

        {step === 'map' && (
          <div className="space-y-4">
            <p className="text-xs text-[var(--ck-text-muted)]">
              Map each CSV column to a contact field. Unmapped columns become custom fields.
            </p>
            <div className="space-y-2">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-3">
                  <div className="w-1/3 truncate text-sm text-[var(--ck-text)]" title={h}>
                    {h}
                    <span className="block text-[10px] text-[var(--ck-text-dim)] truncate">
                      {sampleRows[0]?.[h] || ''}
                    </span>
                  </div>
                  <select
                    value={mapping[h] || ''}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [h]: e.target.value }))
                    }
                    className={inputCls + ' flex-1'}
                  >
                    {CONTACT_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs text-[var(--ck-text-muted)] mb-1">
                New group name (optional)
              </label>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Clay County — June"
                className={inputCls}
              />
            </div>
            <div className="flex justify-between gap-2">
              <button
                onClick={() => setStep('choose')}
                className="px-3 py-2 text-sm text-[var(--ck-text-muted)]"
              >
                Back
              </button>
              <button onClick={doImport} disabled={busy} className={btnPrimary}>
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-[var(--ck-border)] p-3 text-center">
                <div className="text-2xl font-bold text-white">{result.imported}</div>
                <div className="text-xs text-[var(--ck-text-dim)]">Imported</div>
              </div>
              <div className="rounded-lg border border-[var(--ck-border)] p-3 text-center">
                <div className="text-2xl font-bold text-white">{result.suppressed}</div>
                <div className="text-xs text-[var(--ck-text-dim)]">Suppressed</div>
              </div>
              <div className="rounded-lg border border-[var(--ck-border)] p-3 text-center">
                <div className="text-2xl font-bold text-white">{result.skipped}</div>
                <div className="text-xs text-[var(--ck-text-dim)]">Skipped (invalid)</div>
              </div>
            </div>
            <div className="text-xs text-[var(--ck-text-muted)] text-center">
              {result.total} rows processed
            </div>
            <div className="flex justify-end">
              <button onClick={onDone} className={btnPrimary}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */
function ContactsView() {
  const [contacts, setContacts] = useState<ScContact[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<ScContact | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(search ? { search } : {}),
      })
      const res = await fetch(`/api/sc/contacts?${params}`)
      const json = await res.json()
      if (res.ok) {
        setContacts(json.contacts || [])
        setTotal(json.total || 0)
      } else {
        setError(json.error || 'Failed to load')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-lg font-bold text-white shrink-0">Contacts</h2>
        <div className="flex items-center gap-2 flex-1 justify-end">
          <div className="flex items-center gap-2 rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-2 w-64">
            <Icon name="search" size="text-lg" className="text-[var(--ck-text-dim)]" />
            <input
              value={search}
              onChange={(e) => {
                setPage(1)
                setSearch(e.target.value)
              }}
              placeholder="Search name, phone, email"
              className="bg-transparent py-2 text-sm outline-none flex-1 text-[var(--ck-text)]"
            />
          </div>
          <button onClick={() => setShowAdd(true)} className={btnPrimary}>
            <Icon name="person_add" size="text-lg" /> Add new contact
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs text-[#E32E2E]">{error}</div>}

      {loading ? (
        <div className="text-sm text-[var(--ck-text-dim)]">Loading…</div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-16 text-[var(--ck-text-dim)]">
          <Icon name="contacts" size="text-6xl" className="text-[var(--ck-text-dim)] mb-2" />
          <p className="text-sm">No contacts found.</p>
        </div>
      ) : (
        <>
          <div className="border border-[var(--ck-border)] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ck-surface)] text-[var(--ck-text-dim)]">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Name</th>
                  <th className="text-left font-semibold px-3 py-2">Phone</th>
                  <th className="text-left font-semibold px-3 py-2">Email</th>
                  <th className="text-left font-semibold px-3 py-2">City</th>
                  <th className="text-left font-semibold px-3 py-2">Tags</th>
                  <th className="text-left font-semibold px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="border-t border-[var(--ck-border)] hover:bg-white/5 cursor-pointer"
                  >
                    <td className="px-3 py-2 font-semibold text-[var(--ck-text)]">
                      {[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-3 py-2 text-[var(--ck-text-muted)]">
                      {formatPhone(c.phone)}
                    </td>
                    <td className="px-3 py-2 text-[var(--ck-text-muted)]">{c.email || '—'}</td>
                    <td className="px-3 py-2 text-[var(--ck-text-muted)]">{c.city || '—'}</td>
                    <td className="px-3 py-2 text-[var(--ck-text-muted)]">
                      {c.tags?.length ? c.tags.join(', ') : '—'}
                    </td>
                    <td className="px-3 py-2 text-[var(--ck-text-dim)]">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3 text-sm text-[var(--ck-text-muted)]">
            <span>
              {total} contact{total === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-40"
              >
                <Icon name="chevron_left" size="text-lg" />
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-40"
              >
                <Icon name="chevron_right" size="text-lg" />
              </button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <ContactPanel
          contact={selected}
          onClose={() => setSelected(null)}
          onDeleted={() => {
            setSelected(null)
            load()
          }}
        />
      )}
      {showAdd && (
        <ContactFormModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false)
            load()
          }}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Contact detail side panel                                                   */
/* -------------------------------------------------------------------------- */
function ContactPanel({
  contact,
  onClose,
  onDeleted,
}: {
  contact: ScContact
  onClose: () => void
  onDeleted: () => void
}) {
  async function del() {
    if (!confirm('Delete this contact?')) return
    const res = await fetch(`/api/sc/contacts?id=${contact.id}`, { method: 'DELETE' })
    if (res.ok) onDeleted()
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Contact'
  const custom = Object.entries(contact.custom_fields || {})

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-96 max-w-full h-full bg-[var(--ck-bg)] border-l border-[var(--ck-border)] p-5 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white text-lg">{name}</h3>
          <button onClick={onClose} className="text-[var(--ck-text-dim)] hover:text-white">
            <Icon name="close" size="text-xl" />
          </button>
        </div>

        <dl className="space-y-3 text-sm">
          <Field label="Phone" value={formatPhone(contact.phone)} />
          <Field label="Email" value={contact.email} />
          <Field
            label="Address"
            value={[contact.address, contact.city, contact.state, contact.zip]
              .filter(Boolean)
              .join(', ')}
          />
          <Field label="Source" value={contact.source} />
          <Field label="Tags" value={contact.tags?.length ? contact.tags.join(', ') : null} />
          {custom.map(([k, v]) => (
            <Field key={k} label={k} value={String(v)} />
          ))}
        </dl>

        <div className="mt-6 flex justify-end">
          <button
            onClick={del}
            className="flex items-center gap-1.5 rounded-lg border border-[#E32E2E] text-[#E32E2E] text-sm font-bold px-3 py-2 hover:bg-[#E32E2E]/10"
          >
            <Icon name="delete" size="text-lg" /> Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-[var(--ck-text-dim)] capitalize">{label}</dt>
      <dd className="text-[var(--ck-text)]">{value || '—'}</dd>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Manual add-contact modal                                                    */
/* -------------------------------------------------------------------------- */
function ContactFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    tags: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function save() {
    if (!form.phone.trim()) {
      setError('Phone is required.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/sc/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          tags: form.tags
            ? form.tags.split(',').map((t) => t.trim()).filter(Boolean)
            : [],
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Save failed')
        return
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl bg-[var(--ck-bg)] border border-[var(--ck-border)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">Add new contact</h3>
          <button onClick={onClose} className="text-[var(--ck-text-dim)] hover:text-white">
            <Icon name="close" size="text-xl" />
          </button>
        </div>

        {error && <div className="mb-3 text-xs text-[#E32E2E]">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <input
            value={form.first_name}
            onChange={(e) => set('first_name', e.target.value)}
            placeholder="First name"
            className={inputCls}
          />
          <input
            value={form.last_name}
            onChange={(e) => set('last_name', e.target.value)}
            placeholder="Last name"
            className={inputCls}
          />
          <input
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="Phone *"
            className={inputCls + ' col-span-2'}
          />
          <input
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="Email"
            className={inputCls + ' col-span-2'}
          />
          <input
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="Address"
            className={inputCls + ' col-span-2'}
          />
          <input
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
            placeholder="City"
            className={inputCls}
          />
          <input
            value={form.state}
            onChange={(e) => set('state', e.target.value)}
            placeholder="State"
            className={inputCls}
          />
          <input
            value={form.zip}
            onChange={(e) => set('zip', e.target.value)}
            placeholder="Zip"
            className={inputCls}
          />
          <input
            value={form.tags}
            onChange={(e) => set('tags', e.target.value)}
            placeholder="Tags (comma separated)"
            className={inputCls}
          />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-2 text-sm text-[var(--ck-text-muted)]">
            Cancel
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? 'Saving…' : 'Save contact'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Suppressed contacts                                                         */
/* -------------------------------------------------------------------------- */
function SuppressedView() {
  const [rows, setRows] = useState<SuppressedRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addPhone, setAddPhone] = useState('')
  const [addReason, setAddReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams(search ? { search } : {})
      const res = await fetch(`/api/sc/suppression?${params}`)
      const json = await res.json()
      if (res.ok) setRows(json.suppressed || [])
      else setError(json.error || 'Failed to load')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    load()
  }, [load])

  async function addSuppression() {
    if (!addPhone.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/sc/suppression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: addPhone, reason: addReason || 'manual' }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed')
        return
      }
      setShowAdd(false)
      setAddPhone('')
      setAddReason('')
      load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(phone: string) {
    const res = await fetch(`/api/sc/suppression?phone=${encodeURIComponent(phone)}`, {
      method: 'DELETE',
    })
    if (res.ok) setRows((r) => r.filter((x) => x.phone !== phone))
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-lg font-bold text-white shrink-0">Suppressed contacts</h2>
        <div className="flex items-center gap-2 flex-1 justify-end">
          <div className="flex items-center gap-2 rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-2 w-64">
            <Icon name="search" size="text-lg" className="text-[var(--ck-text-dim)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search phone"
              className="bg-transparent py-2 text-sm outline-none flex-1 text-[var(--ck-text)]"
            />
          </div>
          <button onClick={() => setShowAdd(true)} className={btnPrimary}>
            <Icon name="add" size="text-lg" /> Add
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs text-[#E32E2E]">{error}</div>}

      {loading ? (
        <div className="text-sm text-[var(--ck-text-dim)]">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-[var(--ck-text-dim)]">
          <Icon name="block" size="text-6xl" className="text-[var(--ck-text-dim)] mb-2" />
          <p className="text-sm">No suppressed numbers.</p>
        </div>
      ) : (
        <div className="border border-[var(--ck-border)] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ck-surface)] text-[var(--ck-text-dim)]">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Phone</th>
                <th className="text-left font-semibold px-3 py-2">Reason</th>
                <th className="text-left font-semibold px-3 py-2">Suppressed</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--ck-border)] hover:bg-white/5">
                  <td className="px-3 py-2 font-semibold text-[var(--ck-text)]">
                    {formatPhone(r.phone)}
                  </td>
                  <td className="px-3 py-2 text-[var(--ck-text-muted)]">{r.reason || '—'}</td>
                  <td className="px-3 py-2 text-[var(--ck-text-dim)]">
                    {fmtDate(r.opted_out_at)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => remove(r.phone)}
                      className="text-xs font-semibold text-[var(--ck-text-muted)] hover:text-white"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-[var(--ck-bg)] border border-[var(--ck-border)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-white mb-4">Suppress a number</h3>
            <input
              value={addPhone}
              onChange={(e) => setAddPhone(e.target.value)}
              placeholder="Phone number"
              className={inputCls + ' mb-2'}
            />
            <input
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              placeholder="Reason (optional)"
              className={inputCls + ' mb-3'}
            />
            {error && <div className="text-xs text-[#E32E2E] mb-2">{error}</div>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAdd(false)}
                className="px-3 py-2 text-sm text-[var(--ck-text-muted)]"
              >
                Cancel
              </button>
              <button
                onClick={addSuppression}
                disabled={!addPhone.trim() || busy}
                className={btnPrimary}
              >
                {busy ? 'Saving…' : 'Suppress'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
