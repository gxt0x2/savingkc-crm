'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import type { ProspectingCampaignMemberContact } from '@/lib/prospecting/campaign-contract'

type ContactsResponse = {
  contacts?: ProspectingCampaignMemberContact[]
  error?: string
}

export function CampaignSmsRecipientReview({
  campaignId,
  memberId,
  label,
  onReviewed,
}: {
  campaignId: string
  memberId: string
  label: string
  onReviewed: (phone: string) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [contacts, setContacts] = useState<ProspectingCampaignMemberContact[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openReview() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (contacts.length > 0) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/prospecting/campaigns/${encodeURIComponent(campaignId)}/members/${encodeURIComponent(memberId)}/contacts`, { cache: 'no-store' })
      const body = await response.json().catch(() => null) as ContactsResponse | null
      if (!response.ok || !body?.contacts) throw new Error(body?.error || 'Recipients are unavailable')
      setContacts(body.contacts)
      setSelectedId(body.contacts.find((contact) => contact.selectedForSms)?.id || null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Recipients are unavailable')
    } finally {
      setLoading(false)
    }
  }

  async function saveReview() {
    if (!selectedId || saving) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/prospecting/campaigns/${encodeURIComponent(campaignId)}/members/${encodeURIComponent(memberId)}/contacts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: selectedId }),
      })
      const body = await response.json().catch(() => null) as { selection?: { phone?: string }; error?: string } | null
      if (!response.ok || !body?.selection?.phone) throw new Error(body?.error || 'Recipient could not be saved')
      setContacts((current) => current.map((contact) => ({ ...contact, selectedForSms: contact.id === selectedId })))
      setOpen(false)
      await onReviewed(body.selection.phone)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Recipient could not be saved')
    } finally {
      setSaving(false)
    }
  }

  return <div>
    <button type="button" onClick={() => void openReview()} className="rounded-lg px-2 py-1.5 text-[9px] font-black text-[var(--crm-brand)] hover:bg-[var(--crm-brand-soft)]" aria-expanded={open}>
      Review recipient
    </button>
    {open ? <div className="fixed inset-0 z-[90] grid place-items-center bg-[#101711]/60 p-4 backdrop-blur-sm" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}><section role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-2xl" aria-label={`Review SMS recipient for ${label}`}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-[var(--crm-ink)]">Choose one SMS recipient</p><p className="mt-1 text-[10px] leading-4 text-[var(--crm-text-muted)]">Nothing sends until the campaign is separately activated.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Close recipient review"><Icon name="close" /></button></div>
      {loading ? <p role="status" className="mt-3 text-xs text-[var(--crm-text-muted)]">Loading reviewed snapshots…</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-lg bg-[var(--crm-danger-soft)] p-2 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
      {!loading && contacts.length === 0 && !error ? <p className="mt-3 text-xs text-[var(--crm-text-muted)]">No phone snapshots are available.</p> : null}
      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{contacts.map((contact) => {
        const ready = contact.status === 'ready'
        return <label key={contact.id} className={`flex gap-2 rounded-lg border p-2 ${ready ? 'cursor-pointer border-[var(--crm-border)]' : 'cursor-not-allowed border-[var(--crm-danger-soft)] opacity-60'}`}>
          <input type="radio" name={`recipient-${memberId}`} checked={selectedId === contact.id} disabled={!ready} onChange={() => setSelectedId(contact.id)} />
          <span className="min-w-0"><span className="block text-xs font-black text-[var(--crm-ink)]">{contact.contactName || formatPhone(contact.phone)}</span><span className="block text-[10px] text-[var(--crm-text-muted)]">{formatPhone(contact.phone)}{contact.relationship ? ` · ${contact.relationship}` : ''}{contact.phoneType ? ` · ${contact.phoneType}` : ''}</span>{!ready ? <span className="block text-[9px] font-bold text-[var(--crm-danger)]">Blocked: {contact.suppressionReason || contact.status}</span> : null}</span>
        </label>
      })}</div>
      <button type="button" onClick={() => void saveReview()} disabled={!selectedId || saving} className="crm-primary-button mt-3 h-9 w-full rounded-lg text-xs font-black disabled:opacity-50">{saving ? 'Saving…' : 'Approve this recipient'}</button>
    </section></div> : null}
  </div>
}
