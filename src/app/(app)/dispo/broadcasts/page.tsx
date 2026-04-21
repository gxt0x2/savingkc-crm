'use client'

import { useState, useEffect, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn, formatCurrency } from '@/lib/utils'
import { useBroadcasts, useBroadcast, useCreateBroadcast, useSendBroadcast } from '@/hooks/use-broadcasts'
import type { DealBroadcast, BroadcastRecipient } from '@/types/dispo'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusBadge(status: DealBroadcast['status']) {
  const map: Record<DealBroadcast['status'], string> = {
    draft: 'bg-slate-500/20 text-slate-300',
    scheduled: 'bg-blue-500/20 text-blue-300',
    sending: 'bg-amber-500/20 text-amber-300',
    sent: 'bg-emerald-500/20 text-emerald-300',
    cancelled: 'bg-red-500/20 text-red-300',
  }
  return map[status] ?? 'bg-slate-100 text-slate-600'
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
    if (recipient.sms_replied) return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300">Replied</span>
    if (recipient.sms_sent_at) return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-300">Sent</span>
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/20 text-slate-400">Not sent</span>
  }

  function emailBadge() {
    if (recipient.email_clicked_at) return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300">Clicked</span>
    if (recipient.email_opened_at) return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-300">Opened</span>
    if (recipient.email_sent_at) return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/20 text-slate-400">Sent</span>
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/20 text-slate-400">—</span>
  }

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="px-4 py-2.5 text-sm font-medium text-slate-900">{name}</td>
      <td className="px-4 py-2.5 text-sm text-slate-500">{buyer?.company_name ?? '—'}</td>
      <td className="px-4 py-2.5">{smsBadge()}</td>
      <td className="px-4 py-2.5">{emailBadge()}</td>
      <td className="px-4 py-2.5 text-xs text-slate-400">{recipient.match_score ?? '—'}</td>
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
      <div className="mt-4 bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center text-slate-400">
        {isLoading ? 'Loading broadcast…' : 'Broadcast not found'}
      </div>
    )
  }

  const snap = broadcast.deal_snapshot
  const address = getAddress(snap)

  return (
    <div className="mt-4 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-slate-900">{address}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Broadcast {broadcast.id.slice(0, 8)}… · {formatDateTime(broadcast.sent_at ?? broadcast.created_at)}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
          <Icon name="close" />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
        {[
          { label: 'Recipients', val: broadcast.total_recipients },
          { label: 'SMS Replies', val: broadcast.sms_replies },
          { label: 'Email Opens', val: broadcast.email_opens },
          { label: 'Offers', val: broadcast.offers_received },
        ].map(({ label, val }) => (
          <div key={label} className="px-5 py-4 text-center">
            <p className="text-2xl font-bold text-slate-900">{val}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Deal snapshot */}
      {Object.keys(snap).length > 0 && (
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Deal Snapshot</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(['arv', 'asking_price', 'est_assignment', 'beds', 'baths', 'sqft'] as string[])
              .filter(k => snap[k] != null)
              .map(k => (
                <div key={k} className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">{k.replace(/_/g, ' ')}</p>
                  <p className="text-sm font-semibold text-slate-900">
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
        <div className="px-5 py-4 border-b border-slate-100">
          {feedback && (
            <div className="mb-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-3 py-2">{feedback}</div>
          )}
          {!showSendForm ? (
            <button
              onClick={() => setShowSendForm(true)}
              className="bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2"
            >
              <Icon name="send" size="text-sm" />
              Send Broadcast
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Compose Message</p>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">SMS Body</label>
                <textarea
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                  rows={3}
                  value={smsBody}
                  onChange={e => setSmsBody(e.target.value)}
                  placeholder="Hey {{first_name}}, I have a deal in {{zip}} that matches your buy box..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Email Subject</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  placeholder="New Deal Available — 64112"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Email Body</label>
                <textarea
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                  rows={4}
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                  placeholder="Hi {{first_name}}, we have a new deal available..."
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSendForm(false)}
                  className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={sendBroadcast.isPending}
                  className="bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 flex items-center gap-2"
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
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          Recipients ({recipients.length})
        </p>
        {recipients.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No recipients yet</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Buyer</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Company</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">SMS</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Email</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Score</th>
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">New Broadcast</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" size="text-lg" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Search Lead by Address</label>
            <div className="relative">
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={leadSearch}
                onChange={e => { setLeadSearch(e.target.value); debouncedSearchLeads(e.target.value) }}
                placeholder="123 Main St..."
              />
              {searching && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            {leads.length > 0 && (
              <div className="mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {leads.map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => { setSelectedLead(lead); setLeads([]); setLeadSearch(lead.property_address ?? lead.id) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0"
                  >
                    <p className="font-medium text-slate-900">{lead.property_address ?? 'Unknown address'}</p>
                    <p className="text-xs text-slate-500">{lead.full_name ?? ''}</p>
                  </button>
                ))}
              </div>
            )}
            {selectedLead && (
              <div className="mt-2 flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold rounded-lg px-3 py-2">
                <Icon name="check_circle" size="text-sm" />
                {selectedLead.property_address}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Broadcast Type</label>
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
                    broadcastType === opt.val ? 'border-primary bg-primary/5' : 'border-slate-200 hover:bg-slate-50'
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
                    <p className="text-sm font-semibold text-slate-900">{opt.label}</p>
                    <p className="text-xs text-slate-500">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={createBroadcast.isPending || !selectedLead}
              className="flex-1 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
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

      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Broadcasts</h1>
          <p className="text-slate-500 text-sm">
            {isLoading ? 'Loading…' : `${broadcasts.length} broadcast${broadcasts.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold self-start sm:self-auto"
        >
          <Icon name="campaign" size="text-sm" />
          New Broadcast
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-slate-400 py-16 text-center">Loading broadcasts...</div>
      ) : broadcasts.length === 0 ? (
        <div className="text-center py-20">
          <Icon name="campaign" className="text-5xl text-slate-200 mb-4" />
          <p className="text-slate-400 font-medium text-lg">No broadcasts yet</p>
          <p className="text-slate-400 text-sm mt-1 mb-6">Create a broadcast to blast your buyers about a new deal</p>
          <button
            onClick={() => setShowNew(true)}
            className="bg-primary text-white hover:bg-primary/90 rounded-lg px-5 py-2.5 text-sm font-semibold"
          >
            Create First Broadcast
          </button>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Deal Address</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Recipients</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden md:table-cell">Sent At</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">SMS Replies</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Email Opens</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden md:table-cell">Offers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {broadcasts.map(bc => (
                    <tr
                      key={bc.id}
                      className={cn(
                        'hover:bg-slate-50 transition-colors cursor-pointer',
                        selectedId === bc.id && 'bg-primary/5'
                      )}
                      onClick={() => setSelectedId(selectedId === bc.id ? null : bc.id)}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {getAddress(bc.deal_snapshot)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize', statusBadge(bc.status))}>
                          {bc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 hidden sm:table-cell">{bc.total_recipients}</td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{formatDate(bc.sent_at)}</td>
                      <td className="px-4 py-3 text-slate-700 hidden sm:table-cell">{bc.sms_replies}</td>
                      <td className="px-4 py-3 text-slate-700 hidden lg:table-cell">{bc.email_opens}</td>
                      <td className="px-4 py-3 text-slate-700 hidden md:table-cell">{bc.offers_received}</td>
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
