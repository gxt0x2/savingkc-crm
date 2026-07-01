'use client'

import { useEffect, useState, useCallback } from 'react'
import { Icon } from '@/components/ui/icon'
import { ScNav } from '@/components/smartercontact/sc-nav'
import { renderMessage, countVariants } from '@/lib/smartercontact/spintax'

interface Campaign {
  id: string
  name: string
  status: string
  group_id: string | null
  message_body: string | null
  total_recipients: number
  sent_count: number
  delivered_count: number
  failed_count: number
  reply_count: number
  optout_count: number
  created_at: string
}

interface Group {
  id: string
  name: string
  contact_count: number
}

interface SendingNumber {
  id: string
  phone: string
  label: string | null
  status: string
}

interface Template {
  id: string
  name: string
  body: string
  category: string
}

interface Breakdown {
  total: number
  pending: number
  sent: number
  delivered: number
  failed: number
  skipped: number
  replied: number
}

const STATUS_FILTERS = [
  { key: 'all', label: 'All', icon: 'campaign' },
  { key: 'active', label: 'Active', icon: 'play_circle' },
  { key: 'paused', label: 'Paused', icon: 'pause_circle' },
  { key: 'draft', label: 'Draft', icon: 'edit_note' },
  { key: 'completed', label: 'Completed', icon: 'check_circle' },
  { key: 'deleted', label: 'Deleted', icon: 'delete' },
] as const

// Sample contact used to preview the rendered message in the builder.
const SAMPLE_CTX = {
  first_name: 'Jordan',
  last_name: 'Rivera',
  phone: '+18165551234',
  email: 'jordan@example.com',
  address: '123 Maple St',
  city: 'Kansas City',
  state: 'MO',
  zip: '64111',
  custom_fields: {},
}

const MERGE_FIELDS = ['first_name', 'last_name', 'address', 'city', 'state', 'zip']

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusBadge(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-500/15 text-green-400'
    case 'paused':
      return 'bg-yellow-500/15 text-yellow-400'
    case 'completed':
      return 'bg-blue-500/15 text-blue-400'
    case 'deleted':
      return 'bg-red-500/15 text-red-400'
    case 'scheduled':
      return 'bg-purple-500/15 text-purple-400'
    default:
      return 'bg-white/10 text-[var(--ck-text-muted)]'
  }
}

export default function CampaignsPage() {
  const [view, setView] = useState<'campaigns' | 'templates'>('campaigns')
  const [filter, setFilter] = useState<string>('all')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [templates, setTemplates] = useState<Template[]>([])

  const [showBuilder, setShowBuilder] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const loadCampaigns = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ type: 'standard', status: filter })
      const res = await fetch(`/api/sc/campaigns?${params}`)
      const json = await res.json()
      if (res.ok) {
        setCampaigns(json.campaigns || [])
        setCounts(json.counts || {})
      } else {
        setError(json.error || 'Failed to load')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  useEffect(() => {
    if (view !== 'templates') return
    fetch('/api/sms-templates')
      .then((r) => r.json())
      .then((j) => setTemplates(j.templates || []))
      .catch(() => {})
  }, [view])

  async function act(id: string, action: 'pause' | 'resume' | 'delete') {
    const res = await fetch(`/api/sc/campaigns/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (res.ok) loadCampaigns()
    else {
      const j = await res.json().catch(() => ({}))
      setError(j.error || 'Action failed')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ScNav />
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-56 border-r border-[var(--ck-border)] p-3 flex flex-col gap-1 shrink-0 overflow-y-auto">
          <button
            onClick={() => setShowBuilder(true)}
            className="mb-2 flex items-center justify-center gap-1.5 rounded-lg bg-[#E32E2E] text-white text-sm font-bold py-2 hover:bg-[#c72828]"
          >
            <Icon name="add" size="text-lg" /> Create new campaign
          </button>

          <div className="text-xs font-bold uppercase tracking-wide text-[var(--ck-text-dim)] px-2 mt-1 mb-1">
            Standard campaigns
          </div>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setView('campaigns')
                setFilter(f.key)
              }}
              className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                view === 'campaigns' && filter === f.key
                  ? 'bg-[#E32E2E]/15 text-white'
                  : 'text-[var(--ck-text-muted)] hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2">
                <Icon name={f.icon} size="text-lg" className="text-[var(--ck-text-dim)]" />
                {f.label}
              </span>
              {counts[f.key] > 0 && (
                <span className="rounded-full bg-white/10 text-xs px-1.5 py-0.5 min-w-5 text-center text-[var(--ck-text-muted)]">
                  {counts[f.key]}
                </span>
              )}
            </button>
          ))}

          <div className="border-t border-[var(--ck-border)] my-2" />
          <button
            onClick={() => setView('templates')}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
              view === 'templates'
                ? 'bg-[#E32E2E]/15 text-white'
                : 'text-[var(--ck-text-muted)] hover:bg-white/5'
            }`}
          >
            <Icon name="description" size="text-lg" className="text-[var(--ck-text-dim)]" />
            Message templates
          </button>
        </aside>

        {/* Main area */}
        <section className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {error && (
            <div className="px-4 py-2 text-xs text-[#E32E2E] bg-[#E32E2E]/10">{error}</div>
          )}

          {view === 'templates' ? (
            <TemplatesView templates={templates} />
          ) : loading ? (
            <div className="p-6 text-sm text-[var(--ck-text-dim)]">Loading…</div>
          ) : campaigns.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--ck-text-dim)]">
              <Icon name="campaign" size="text-6xl" className="mb-2" />
              <p className="text-sm">No campaigns yet</p>
              <button
                onClick={() => setShowBuilder(true)}
                className="mt-3 rounded-lg bg-[#E32E2E] text-white text-sm font-bold px-4 py-2 hover:bg-[#c72828]"
              >
                Create your first campaign
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--ck-surface)] text-left text-xs uppercase tracking-wide text-[var(--ck-text-dim)]">
                  <tr className="border-b border-[var(--ck-border)]">
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold text-right">Recipients</th>
                    <th className="px-4 py-3 font-semibold text-right">Sent</th>
                    <th className="px-4 py-3 font-semibold text-right">Delivered</th>
                    <th className="px-4 py-3 font-semibold text-right">Replies</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-[var(--ck-border)] hover:bg-white/5"
                    >
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setDetailId(c.id)}
                          className="font-semibold text-[var(--ck-text)] hover:text-white"
                        >
                          {c.name}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusBadge(
                            c.status,
                          )}`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--ck-text-muted)]">
                        {c.total_recipients}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--ck-text-muted)]">
                        {c.sent_count}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--ck-text-muted)]">
                        {c.delivered_count}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--ck-text-muted)]">
                        {c.reply_count}
                      </td>
                      <td className="px-4 py-3 text-[var(--ck-text-dim)]">
                        {fmtDate(c.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setDetailId(c.id)}
                            title="View"
                            className="p-1.5 rounded hover:bg-white/10 text-[var(--ck-text-dim)]"
                          >
                            <Icon name="visibility" size="text-lg" />
                          </button>
                          {c.status === 'active' && (
                            <button
                              onClick={() => act(c.id, 'pause')}
                              title="Pause"
                              className="p-1.5 rounded hover:bg-white/10 text-[var(--ck-text-dim)]"
                            >
                              <Icon name="pause" size="text-lg" />
                            </button>
                          )}
                          {c.status === 'paused' && (
                            <button
                              onClick={() => act(c.id, 'resume')}
                              title="Resume"
                              className="p-1.5 rounded hover:bg-white/10 text-[var(--ck-text-dim)]"
                            >
                              <Icon name="play_arrow" size="text-lg" />
                            </button>
                          )}
                          {c.status !== 'deleted' && (
                            <button
                              onClick={() => act(c.id, 'delete')}
                              title="Delete"
                              className="p-1.5 rounded hover:bg-white/10 text-[#E32E2E]"
                            >
                              <Icon name="delete" size="text-lg" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {showBuilder && (
        <CampaignBuilder
          onClose={() => setShowBuilder(false)}
          onDone={(launchedId) => {
            setShowBuilder(false)
            loadCampaigns()
            if (launchedId) setDetailId(launchedId)
          }}
        />
      )}

      {detailId && (
        <CampaignDetail id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Templates view                                                      */
/* ------------------------------------------------------------------ */

function TemplatesView({ templates }: { templates: Template[] }) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <h2 className="text-lg font-bold text-white mb-3">Message templates</h2>
      {templates.length === 0 ? (
        <div className="text-sm text-[var(--ck-text-dim)]">No templates found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--ck-text)]">{t.name}</span>
                <span className="text-xs text-[var(--ck-text-dim)] uppercase">
                  {t.category}
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--ck-text-muted)] whitespace-pre-wrap">
                {t.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Campaign builder (4-step flow)                                      */
/* ------------------------------------------------------------------ */

function CampaignBuilder({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (launchedId?: string) => void
}) {
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // form state
  const [name, setName] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [numbers, setNumbers] = useState<SendingNumber[]>([])
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>([])
  const [fromStrategy, setFromStrategy] = useState<'pool' | 'single'>('pool')
  const [throttle, setThrottle] = useState(500)
  const [windowStart, setWindowStart] = useState('')
  const [windowEnd, setWindowEnd] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')

  useEffect(() => {
    fetch('/api/sc/groups')
      .then((r) => r.json())
      .then((j) => setGroups(j.groups || []))
      .catch(() => {})
    fetch('/api/sms-templates')
      .then((r) => r.json())
      .then((j) => setTemplates(j.templates || []))
      .catch(() => {})
    fetch('/api/sc/numbers')
      .then((r) => r.json())
      .then((j) =>
        setNumbers((j.numbers || []).filter((n: SendingNumber) => n.status === 'active')),
      )
      .catch(() => {})
  }, [])

  const variants = messageBody ? countVariants(messageBody) : 0
  const preview = messageBody
    ? renderMessage(messageBody, SAMPLE_CTX, SAMPLE_CTX.phone)
    : ''

  function insertMerge(field: string) {
    setMessageBody((b) => `${b}{${field}}`)
  }

  function toggleNumber(id: string) {
    setSelectedNumbers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function applyTemplate(t: Template) {
    setMessageBody(t.body)
    setTemplateId(t.id)
  }

  async function persist(): Promise<string | null> {
    const res = await fetch('/api/sc/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        group_id: groupId || null,
        message_body: messageBody,
        template_id: templateId,
        from_strategy: fromStrategy,
        sending_number_ids: fromStrategy === 'pool' ? selectedNumbers : selectedNumbers.slice(0, 1),
        throttle_per_hour: throttle,
        send_window_start: windowStart || null,
        send_window_end: windowEnd || null,
        timezone: 'America/Chicago',
        scheduled_at: scheduledAt || null,
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error || 'Failed to save')
      return null
    }
    return json.campaign?.id ?? null
  }

  async function saveDraft() {
    if (!name.trim()) {
      setError('Campaign name is required')
      return
    }
    setBusy(true)
    setError('')
    const id = await persist()
    setBusy(false)
    if (id) onDone()
  }

  async function launch() {
    if (!name.trim()) {
      setError('Campaign name is required')
      return
    }
    setBusy(true)
    setError('')
    const id = await persist()
    if (!id) {
      setBusy(false)
      return
    }
    const res = await fetch(`/api/sc/campaigns/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'launch' }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) {
      setError(json.error || 'Launch failed')
      return
    }
    onDone(id)
  }

  const canNext =
    (step === 1 && groupId && name.trim()) ||
    (step === 2 && messageBody.trim()) ||
    (step === 3 && (fromStrategy === 'pool' ? selectedNumbers.length > 0 : selectedNumbers.length === 1)) ||
    step === 4

  const selectedGroup = groups.find((g) => g.id === groupId)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl bg-[var(--ck-bg)] border border-[var(--ck-border)]">
        {/* Header + steps */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ck-border)]">
          <h3 className="font-bold text-white">New campaign</h3>
          <button onClick={onClose} className="text-[var(--ck-text-dim)] hover:text-white">
            <Icon name="close" size="text-xl" />
          </button>
        </div>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--ck-border)] text-xs">
          {['Group', 'Message', 'Sending', 'Review'].map((label, i) => {
            const n = i + 1
            return (
              <div key={label} className="flex items-center gap-2">
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full font-bold ${
                    step === n
                      ? 'bg-[#E32E2E] text-white'
                      : step > n
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-white/10 text-[var(--ck-text-dim)]'
                  }`}
                >
                  {step > n ? '✓' : n}
                </span>
                <span
                  className={step === n ? 'text-white font-semibold' : 'text-[var(--ck-text-dim)]'}
                >
                  {label}
                </span>
                {n < 4 && <span className="text-[var(--ck-text-dim)]">›</span>}
              </div>
            )
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--ck-text)] mb-1">
                  Campaign name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="April blitz — absentee owners"
                  className="w-full rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--ck-text)] mb-1">
                  Recipient group
                </label>
                {groups.length === 0 ? (
                  <p className="text-sm text-[var(--ck-text-dim)]">
                    No groups found. Create one in Contacts first.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setGroupId(g.id)}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                          groupId === g.id
                            ? 'border-[#E32E2E] bg-[#E32E2E]/10 text-white'
                            : 'border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:bg-white/5'
                        }`}
                      >
                        <span className="font-semibold">{g.name}</span>
                        <span className="text-xs text-[var(--ck-text-dim)]">
                          {g.contact_count} contacts
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-[var(--ck-text-dim)] mr-1">Merge:</span>
                {MERGE_FIELDS.map((f) => (
                  <button
                    key={f}
                    onClick={() => insertMerge(f)}
                    className="rounded-md bg-white/10 px-2 py-1 text-xs text-[var(--ck-text-muted)] hover:bg-white/20"
                  >
                    {`{${f}}`}
                  </button>
                ))}
                {templates.length > 0 && (
                  <select
                    onChange={(e) => {
                      const t = templates.find((x) => x.id === e.target.value)
                      if (t) applyTemplate(t)
                    }}
                    value=""
                    className="ml-auto rounded-md bg-[var(--ck-surface)] border border-[var(--ck-border)] px-2 py-1 text-xs text-[var(--ck-text-muted)]"
                  >
                    <option value="">Insert template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <textarea
                value={messageBody}
                onChange={(e) => {
                  setMessageBody(e.target.value)
                  setTemplateId(null)
                }}
                rows={6}
                placeholder="Hi {first_name}, {are you|would you be} open to an offer on {address}?"
                className="w-full resize-none rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
              />
              <div className="flex items-center gap-3 text-xs text-[var(--ck-text-dim)]">
                <span className="flex items-center gap-1">
                  <Icon name="shuffle" size="text-sm" />
                  {variants} variant{variants === 1 ? '' : 's'}
                </span>
                <span>{messageBody.length} chars</span>
              </div>
              {preview && (
                <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3">
                  <div className="text-xs font-semibold text-[var(--ck-text-dim)] mb-1">
                    Preview (sample contact)
                  </div>
                  <div className="text-sm text-[var(--ck-text)] whitespace-pre-wrap">
                    {preview}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--ck-text)] mb-1">
                  From strategy
                </label>
                <div className="flex gap-2">
                  {(['pool', 'single'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setFromStrategy(s)}
                      className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${
                        fromStrategy === s
                          ? 'border-[#E32E2E] bg-[#E32E2E]/10 text-white'
                          : 'border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:bg-white/5'
                      }`}
                    >
                      {s === 'pool' ? 'Number pool' : 'Single number'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--ck-text)] mb-1">
                  Sending numbers
                </label>
                {numbers.length === 0 ? (
                  <p className="text-sm text-[var(--ck-text-dim)]">
                    No active sending numbers. Add some in the Numbers pool.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                    {numbers.map((n) => {
                      const on = selectedNumbers.includes(n.id)
                      return (
                        <button
                          key={n.id}
                          onClick={() => {
                            if (fromStrategy === 'single') setSelectedNumbers(on ? [] : [n.id])
                            else toggleNumber(n.id)
                          }}
                          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                            on
                              ? 'border-[#E32E2E] bg-[#E32E2E]/10 text-white'
                              : 'border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:bg-white/5'
                          }`}
                        >
                          <span className="font-semibold">{n.label || n.phone}</span>
                          <span className="flex items-center gap-2 text-xs text-[var(--ck-text-dim)]">
                            {n.phone}
                            {on && <Icon name="check" size="text-sm" className="text-[#E32E2E]" />}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-[var(--ck-text)] mb-1">
                    Throttle (per hour)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={throttle}
                    onChange={(e) => setThrottle(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[var(--ck-text)] mb-1">
                    Schedule (optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[var(--ck-text)] mb-1">
                    Send window start
                  </label>
                  <input
                    type="time"
                    value={windowStart}
                    onChange={(e) => setWindowStart(e.target.value)}
                    className="w-full rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[var(--ck-text)] mb-1">
                    Send window end
                  </label>
                  <input
                    type="time"
                    value={windowEnd}
                    onChange={(e) => setWindowEnd(e.target.value)}
                    className="w-full rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-3 text-sm">
              <ReviewRow label="Name" value={name || '—'} />
              <ReviewRow
                label="Group"
                value={
                  selectedGroup
                    ? `${selectedGroup.name} (${selectedGroup.contact_count} contacts)`
                    : '—'
                }
              />
              <ReviewRow label="Variants" value={`${variants}`} />
              <ReviewRow
                label="From"
                value={
                  fromStrategy === 'pool'
                    ? `Pool of ${selectedNumbers.length} number(s)`
                    : 'Single number'
                }
              />
              <ReviewRow label="Throttle" value={`${throttle}/hr`} />
              <ReviewRow
                label="Send window"
                value={windowStart && windowEnd ? `${windowStart}–${windowEnd}` : 'Anytime'}
              />
              <ReviewRow label="Schedule" value={scheduledAt || 'Immediately'} />
              <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3">
                <div className="text-xs font-semibold text-[var(--ck-text-dim)] mb-1">
                  Message preview
                </div>
                <div className="text-sm text-[var(--ck-text)] whitespace-pre-wrap">
                  {preview || '—'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {error && <div className="px-5 py-2 text-xs text-[#E32E2E]">{error}</div>}
        <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--ck-border)]">
          <button
            onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
            className="px-4 py-2 text-sm text-[var(--ck-text-muted)] hover:text-white"
          >
            {step > 1 ? 'Back' : 'Cancel'}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={saveDraft}
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold rounded-lg border border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:bg-white/5 disabled:opacity-40"
            >
              Save draft
            </button>
            {step < 4 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canNext}
                className="px-5 py-2 text-sm font-bold rounded-lg bg-[#E32E2E] text-white disabled:opacity-40 hover:bg-[#c72828]"
              >
                Next
              </button>
            ) : (
              <button
                onClick={launch}
                disabled={busy}
                className="px-5 py-2 text-sm font-bold rounded-lg bg-[#E32E2E] text-white disabled:opacity-40 hover:bg-[#c72828]"
              >
                {busy ? 'Launching…' : 'Launch'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--ck-border)] pb-2">
      <span className="text-[var(--ck-text-dim)]">{label}</span>
      <span className="text-[var(--ck-text)] font-semibold text-right">{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Campaign detail (progress poll)                                     */
/* ------------------------------------------------------------------ */

function CampaignDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/sc/campaigns/${id}`)
    const json = await res.json()
    if (res.ok) {
      setCampaign(json.campaign)
      setBreakdown(json.breakdown)
    }
  }, [id])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const b = breakdown
  const done = b ? b.sent + b.delivered + b.failed + b.skipped : 0
  const pct = b && b.total > 0 ? Math.round((done / b.total) * 100) : 0

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-[var(--ck-bg)] border border-[var(--ck-border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ck-border)]">
          <h3 className="font-bold text-white">{campaign?.name || 'Campaign'}</h3>
          <button onClick={onClose} className="text-[var(--ck-text-dim)] hover:text-white">
            <Icon name="close" size="text-xl" />
          </button>
        </div>
        <div className="p-5">
          {!campaign || !b ? (
            <div className="text-sm text-[var(--ck-text-dim)]">Loading…</div>
          ) : (
            <>
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs text-[var(--ck-text-dim)] mb-1">
                  <span className="capitalize">{campaign.status}</span>
                  <span>
                    {done} / {b.total} ({pct}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-[#E32E2E] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ['Pending', b.pending, 'schedule'],
                    ['Sent', b.sent, 'send'],
                    ['Delivered', b.delivered, 'done_all'],
                    ['Failed', b.failed, 'error'],
                    ['Skipped', b.skipped, 'block'],
                    ['Replied', b.replied, 'reply'],
                  ] as const
                ).map(([label, value, icon]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3"
                  >
                    <Icon
                      name={icon}
                      size="text-lg"
                      className="text-[var(--ck-text-dim)] mb-1"
                    />
                    <div className="text-lg font-bold text-white">{value}</div>
                    <div className="text-xs text-[var(--ck-text-dim)]">{label}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
