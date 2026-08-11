'use client'

import { useState, useEffect, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { DispoPageHeader } from '@/components/dispo/workspace-ui'
import { cn, formatCurrency } from '@/lib/utils'
import { useBroadcasts, useBroadcast, useCreateBroadcast, useSendBroadcast } from '@/hooks/use-broadcasts'
import type { DealBroadcast, BroadcastRecipient } from '@/types/dispo'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusBadge(status: DealBroadcast['status']) {
  const map: Record<DealBroadcast['status'], string> = {
    draft: 'bg-[var(--crm-surface-raised)] text-[var(--crm-text-dim)]',
    scheduled: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
    sending: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
    sent: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
    cancelled: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
  }
  return map[status] ?? 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text)]'
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function getAddress(snapshot: Record<string, unknown>): string {
  return (snapshot.property_address as string) ?? (snapshot.address as string) ?? 'Unknown Address'
}

// ---------------------------------------------------------------------------
// Recipient Row
// ---------------------------------------------------------------------------
function RecipientRow({ recipient }: { recipient: BroadcastRecipient }) {
  const buyer = recipient.buyer
  const name = buyer ? `${buyer.first_name} ${buyer.last_name}` : recipient.buyer_id

  function smsBadge() {
    if (recipient.sms_replied) return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--crm-success-soft)] text-[var(--crm-success)]">Replied</span>
    if (recipient.sms_sent_at) return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]">Sent</span>
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--crm-surface-raised)] text-[var(--crm-text-dim)]">Not sent</span>
  }

  function emailBadge() {
    if (recipient.email_clicked_at) return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--crm-success-soft)] text-[var(--crm-success)]">Clicked</span>
    if (recipient.email_opened_at) return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]">Opened</span>
    if (recipient.email_sent_at) return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--crm-surface-raised)] text-[var(--crm-text-dim)]">Sent</span>
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--crm-surface-raised)] text-[var(--crm-text-dim)]">—</span>
  }

  return (
    <tr className="border-b border-[var(--crm-border)] hover:bg-[var(--crm-surface-subtle)]">
      <td className="px-4 py-2.5 text-sm font-medium text-[var(--crm-ink)]">{name}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--crm-text-muted)]">{buyer?.company_name ?? '—'}</td>
      <td className="px-4 py-2.5">{smsBadge()}</td>
      <td className="px-4 py-2.5">{emailBadge()}</td>
      <td className="px-4 py-2.5 text-xs text-[var(--crm-text-dim)]">{recipient.match_score ?? '—'}</td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Broadcast Detail Panel
// ---------------------------------------------------------------------------
function BroadcastDetail({ broadcastId, onClose }: { broadcastId: string; onClose: () => void }) {
  const { data, isLoading } = useBroadcast(broadcastId)
  const sendBroadcast = useSendBroadcast()
  const [smsBody, setSmsBody] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [showSendForm, setShowSendForm] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const broadcast = data?.broadcast
  const recipients = data?.recipients ?? []

  async function handleSend() {
    if (!broadcast) return
    try {
      const res = await sendBroadcast.mutateAsync({
        broadcast_id: broadcast.id,
        sms_body: smsBody || undefined,
        email_subject: emailSubject || undefined,
        email_body: emailBody || undefined,
      })
      setFeedback(`Sent! ${res.sent_sms} SMS, ${res.sent_email} emails dispatched.`)
      setShowSendForm(false)
    } catch (err: unknown) {
      setFeedback(err instanceof Error ? err.message : 'Send failed')
    }
  }

  if (isLoading || !broadcast) {
    return (
      <div className="mt-4 bg-[var(--crm-surface)] rounded-xl border border-[var(--crm-border)] shadow-sm p-8 text-center text-[var(--crm-text-dim)]">
        {isLoading ? 'Loading broadcast…' : 'Broadcast not found'}
      </div>
    )
  }

  const snap = broadcast.deal_snapshot
  const address = getAddress(snap)

  return (
    <div className="mt-4 bg-[var(--crm-surface)] rounded-xl border border-[var(--crm-border)] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--crm-border)]">
        <div>
          <h3 className="font-bold text-[var(--crm-ink)]">{address}</h3>
          <p className="text-xs text-[var(--crm-text-muted)] mt-0.5">Broadcast {broadcast.id.slice(0, 8)}… · {formatDateTime(broadcast.sent_at ?? broadcast.created_at)}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-[var(--crm-surface-subtle)] rounded-lg text-[var(--crm-text-dim)]">
          <Icon name="close" />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[var(--crm-border)] border-b border-[var(--crm-border)]">
        {[
          { label: 'Recipients', val: broadcast.total_recipients },
          { label: 'SMS Replies', val: broadcast.sms_replies },
          { label: 'Email Opens', val: broadcast.email_opens },
          { label: 'Offers', val: broadcast.offers_received },
        ].map(({ label, val }) => (
          <div key={label} className="px-5 py-4 text-center">
            <p className="text-2xl font-bold text-[var(--crm-ink)]">{val}</p>
            <p className="text-xs text-[var(--crm-text-muted)] mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Deal snapshot */}
      {Object.keys(snap).length > 0 && (
        <div className="px-5 py-4 border-b border-[var(--crm-border)]">
          <p className="text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider mb-2">Deal Snapshot</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(['arv', 'asking_price', 'est_assignment', 'beds', 'baths', 'sqft'] as string[])
              .filter(k => snap[k] != null)
              .map(k => (
                <div key={k} className="bg-[var(--crm-surface-subtle)] rounded-lg px-3 py-2">
                  <p className="text-[10px] font-bold text-[var(--crm-text-dim)] uppercase">{k.replace(/_/g, ' ')}</p>
                  <p className="text-sm font-semibold text-[var(--crm-ink)]">
                    {typeof snap[k] === 'number' && k.includes('price') || k === 'arv' || k === 'est_assignment'
                      ? formatCurrency(snap[k] as number)
                      : String(snap[k])}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Send form */}
      {broadcast.status === 'draft' && (
        <div className="px-5 py-4 border-b border-[var(--crm-border)]">
          {feedback && (
            <div className="mb-3 bg-[var(--crm-success-soft)] border border-[var(--crm-success-border)] text-[var(--crm-success)] text-sm rounded-lg px-3 py-2">{feedback}</div>
          )}
          {!showSendForm ? (
            <button
              onClick={() => setShowSendForm(true)}
              className="bg-[var(--crm-brand)] text-[var(--crm-on-brand)] hover:bg-[var(--crm-brand-hover)] rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2"
            >
              <Icon name="send" size="text-sm" />
              Send Broadcast
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-bold text-[var(--crm-text)] uppercase tracking-wider">Compose Message</p>
              <div>
                <label className="block text-xs font-semibold text-[var(--crm-text)] mb-1">SMS Body</label>
                <textarea
                  className="w-full border border-[var(--crm-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--crm-brand)]/30 resize-none"
                  rows={3}
                  value={smsBody}
                  onChange={e => setSmsBody(e.target.value)}
                  placeholder="Hey {{first_name}}, I have a deal in {{zip}} that matches your buy box..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--crm-text)] mb-1">Email Subject</label>
                <input
                  className="w-full border border-[var(--crm-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--crm-brand)]/30"
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  placeholder="New Deal Available — 64112"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--crm-text)] mb-1">Email Body</label>
                <textarea
                  className="w-full border border-[var(--crm-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--crm-brand)]/30 resize-none"
                  rows={4}
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                  placeholder="Hi {{first_name}}, we have a new deal available..."
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSendForm(false)}
                  className="bg-[var(--crm-surface)] border border-[var(--crm-border)] text-[var(--crm-text)] hover:bg-[var(--crm-surface-subtle)] rounded-lg px-4 py-2 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={sendBroadcast.isPending}
                  className="bg-[var(--crm-brand)] text-[var(--crm-on-brand)] hover:bg-[var(--crm-brand-hover)] rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 flex items-center gap-2"
                >
                  <Icon name="send" size="text-sm" />
                  {sendBroadcast.isPending ? 'Sending…' : `Send to ${broadcast.total_recipients} buyers`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recipients */}
      <div className="px-5 py-4">
        <p className="text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider mb-3">
          Recipients ({recipients.length})
        </p>
        {recipients.length === 0 ? (
          <p className="text-sm text-[var(--crm-text-dim)] italic">No recipients yet</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--crm-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--crm-surface-subtle)] border-b border-[var(--crm-border)]">
                  <th className="text-left px-4 py-2 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider">Buyer</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider">Company</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider">SMS</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider">Email</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider">Score</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map(r => <RecipientRow key={r.id} recipient={r} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New Broadcast Modal
// ---------------------------------------------------------------------------
function NewBroadcastModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const createBroadcast = useCreateBroadcast()
  const [leadSearch, setLeadSearch] = useState('')
  const [leads, setLeads] = useState<{ id: string; property_address: string | null; full_name: string | null }[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedLead, setSelectedLead] = useState<{ id: string; property_address: string | null } | null>(null)
  const [broadcastType, setBroadcastType] = useState<'auto_match' | 'manual_select' | 'blast_all'>('auto_match')
  const [error, setError] = useState<string | null>(null)

  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  function debouncedSearchLeads(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setLeads([]); setSearching(false); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(q)}&limit=10`)
        if (!res.ok) return
        const data = await res.json()
        setLeads(data.results ?? [])
      } finally {
        setSearching(false)
      }
    }, 400)
  }

  useEffect(() => { return () => { if (debounceRef.current) clearTimeout(debounceRef.current) } }, [])

  async function handleCreate() {
    if (!selectedLead) { setError('Please select a lead'); return }
    setError(null)
    try {
      const res = await createBroadcast.mutateAsync({ lead_id: selectedLead.id, broadcast_type: broadcastType })
      onCreated(res.broadcast.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create broadcast')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-[var(--crm-surface)] rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--crm-border)]">
          <h2 className="text-lg font-bold text-[var(--crm-ink)]">New Broadcast</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-[var(--crm-surface-subtle)] rounded-lg text-[var(--crm-text-dim)]">
            <Icon name="close" size="text-lg" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-[var(--crm-danger-soft)] border border-[var(--crm-danger-border)] text-[var(--crm-danger)] text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[var(--crm-text)] mb-1">Search Lead by Address</label>
            <div className="relative">
              <input
                className="w-full border border-[var(--crm-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--crm-brand)]/30"
                value={leadSearch}
                onChange={e => { setLeadSearch(e.target.value); debouncedSearchLeads(e.target.value) }}
                placeholder="123 Main St..."
              />
              {searching && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <div className="w-4 h-4 border-2 border-[var(--crm-brand)] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            {leads.length > 0 && (
              <div className="mt-1 bg-[var(--crm-surface)] border border-[var(--crm-border)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {leads.map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => { setSelectedLead(lead); setLeads([]); setLeadSearch(lead.property_address ?? lead.id) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--crm-surface-subtle)] border-b border-[var(--crm-border)] last:border-0"
                  >
                    <p className="font-medium text-[var(--crm-ink)]">{lead.property_address ?? 'Unknown address'}</p>
                    <p className="text-xs text-[var(--crm-text-muted)]">{lead.full_name ?? ''}</p>
                  </button>
                ))}
              </div>
            )}
            {selectedLead && (
              <div className="mt-2 flex items-center gap-2 bg-[var(--crm-brand)]/10 text-[var(--crm-brand)] text-xs font-semibold rounded-lg px-3 py-2">
                <Icon name="check_circle" size="text-sm" />
                {selectedLead.property_address}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--crm-text)] mb-2">Broadcast Type</label>
            <div className="space-y-2">
              {([
                { val: 'auto_match', label: 'Auto Match', desc: 'Automatically match buyers based on buy box criteria' },
                { val: 'manual_select', label: 'Manual Select', desc: 'Manually choose which buyers to send to' },
                { val: 'blast_all', label: 'Blast All', desc: 'Send to all active buyers regardless of buy box' },
              ] as const).map(opt => (
                <label
                  key={opt.val}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                    broadcastType === opt.val ? 'border-[var(--crm-brand)] bg-[var(--crm-brand)]/5' : 'border-[var(--crm-border)] hover:bg-[var(--crm-surface-subtle)]'
                  )}
                >
                  <input
                    type="radio"
                    name="broadcastType"
                    value={opt.val}
                    checked={broadcastType === opt.val}
                    onChange={() => setBroadcastType(opt.val)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-semibold text-[var(--crm-ink)]">{opt.label}</p>
                    <p className="text-xs text-[var(--crm-text-muted)]">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 bg-[var(--crm-surface)] border border-[var(--crm-border)] text-[var(--crm-text)] hover:bg-[var(--crm-surface-subtle)] rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={createBroadcast.isPending || !selectedLead}
              className="flex-1 bg-[var(--crm-brand)] text-[var(--crm-on-brand)] hover:bg-[var(--crm-brand-hover)] rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {createBroadcast.isPending ? 'Creating…' : 'Create Broadcast'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function BroadcastsPage() {
  const { data, isLoading } = useBroadcasts()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const broadcasts = data?.broadcasts ?? []

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 pb-32 max-w-[1440px] mx-auto">
      {showNew && (
        <NewBroadcastModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => { setShowNew(false); setSelectedId(id) }}
        />
      )}

      <div className="mb-5 overflow-hidden rounded-xl border border-[var(--crm-border)] shadow-[var(--crm-shadow-sm)]">
        <DispoPageHeader
          eyebrow="Buyer marketing"
          title="Marketing"
          description={isLoading ? 'Loading buyer marketing…' : `${broadcasts.length} campaign${broadcasts.length !== 1 ? 's' : ''}. Send a property to the right buyers and track the response.`}
          actions={(
            <button onClick={() => setShowNew(true)} className="crm-primary-button flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold">
              <Icon name="campaign" size="text-sm" />
              New campaign
            </button>
          )}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-[var(--crm-text-dim)] py-16 text-center">Loading broadcasts...</div>
      ) : broadcasts.length === 0 ? (
        <div className="text-center py-20">
          <Icon name="campaign" className="text-5xl text-[var(--crm-text-dim)] mb-4" />
          <p className="text-lg font-bold text-[var(--crm-ink)]">No campaigns yet</p>
          <p className="mt-1 mb-6 text-sm text-[var(--crm-text-muted)]">Choose a property and send it to matching buyers.</p>
          <button
            onClick={() => setShowNew(true)}
            className="bg-[var(--crm-brand)] text-[var(--crm-on-brand)] hover:bg-[var(--crm-brand-hover)] rounded-lg px-5 py-2.5 text-sm font-semibold"
          >
            Create first campaign
          </button>
        </div>
      ) : (
        <>
          <div className="bg-[var(--crm-surface)] rounded-xl border border-[var(--crm-border)] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]">
                    <th className="text-left px-4 py-3 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider">Deal Address</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider hidden sm:table-cell">Recipients</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider hidden md:table-cell">Sent At</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider hidden sm:table-cell">SMS Replies</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider hidden lg:table-cell">Email Opens</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-[var(--crm-text-muted)] uppercase tracking-wider hidden md:table-cell">Offers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--crm-border)]">
                  {broadcasts.map(bc => (
                    <tr
                      key={bc.id}
                      className={cn(
                        'hover:bg-[var(--crm-surface-subtle)] transition-colors cursor-pointer',
                        selectedId === bc.id && 'bg-[var(--crm-brand)]/5'
                      )}
                      onClick={() => setSelectedId(selectedId === bc.id ? null : bc.id)}
                    >
                      <td className="px-4 py-3 font-medium text-[var(--crm-ink)]">
                        {getAddress(bc.deal_snapshot)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize', statusBadge(bc.status))}>
                          {bc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--crm-text)] hidden sm:table-cell">{bc.total_recipients}</td>
                      <td className="px-4 py-3 text-[var(--crm-text-muted)] hidden md:table-cell">{formatDate(bc.sent_at)}</td>
                      <td className="px-4 py-3 text-[var(--crm-text)] hidden sm:table-cell">{bc.sms_replies}</td>
                      <td className="px-4 py-3 text-[var(--crm-text)] hidden lg:table-cell">{bc.email_opens}</td>
                      <td className="px-4 py-3 text-[var(--crm-text)] hidden md:table-cell">{bc.offers_received}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Inline detail */}
          {selectedId && (
            <BroadcastDetail
              broadcastId={selectedId}
              onClose={() => setSelectedId(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
