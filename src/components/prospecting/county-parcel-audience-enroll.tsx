'use client'

import { useMemo, useState } from 'react'
import { parsePastedCountyParcelIds, prospectingCampaignListTypeForCampaign } from '@/lib/prospecting/campaign-contract'

export function CountyParcelAudienceEnroll({
  campaignId,
  campaignName,
  campaignKind,
  onEnrolled,
}: {
  campaignId: string
  campaignName?: string
  campaignKind?: 'dialer' | 'sms'
  onEnrolled?: () => void | Promise<void>
}) {
  const listType = prospectingCampaignListTypeForCampaign({ id: campaignId, name: campaignName ?? '' })
  const [paste, setPaste] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [enrolling, setEnrolling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => {
    try {
      return { parcelIds: parsePastedCountyParcelIds(paste), error: null as string | null }
    } catch (caught) {
      return { parcelIds: [] as string[], error: paste.trim() ? (caught instanceof Error ? caught.message : 'Parcel list is invalid') : null }
    }
  }, [paste])

  async function enrollReviewedParcels() {
    if (!campaignId || parsed.parcelIds.length < 1 || enrolling) return
    setEnrolling(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/prospecting/campaigns/${encodeURIComponent(campaignId)}/members`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countyAudience: {
          parcelIds: parsed.parcelIds,
          reviewedCount: parsed.parcelIds.length,
        } }),
      })
      const body = await response.json().catch(() => null) as { enrollment?: { subjects?: number; eligible?: number; needsReview?: number; suppressed?: number; missing?: number }; error?: string } | null
      if (!response.ok || !body?.enrollment) throw new Error(body?.error || 'Parcel audience could not be enrolled')
      const result = body.enrollment
      setConfirmOpen(false)
      setNotice(campaignKind === 'sms'
        ? `${Number(result.subjects) || 0} seller groups added. ${Number(result.needsReview) || 0} require an explicit SMS recipient before activation.`
        : `${Number(result.subjects) || 0} seller groups added with ${Number(result.eligible) || 0} ready to call. No calls were placed.`)
      await onEnrolled?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Parcel audience could not be enrolled')
    } finally {
      setEnrolling(false)
    }
  }

  return <section className="mt-5 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4" aria-label="Jackson parcel ID enrollment">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="crm-eyebrow">Exact Jackson parcels</p>
        <h3 className="mt-1 text-sm font-black text-[var(--crm-ink)]">Enroll by parcel ID</h3>
        <p className="mt-1 text-xs text-[var(--crm-text-muted)]">{listType === 'tax_3_plus' ? 'Paste living Tax 3+ Jackson parcel IDs only. Deceased rows are rejected and stay off this campaign.' : listType === 'deceased' ? 'Paste deceased or inherited Jackson parcel IDs only. Living Tax 3+ rows belong on a separate campaign.' : 'Paste reviewed Jackson source parcel IDs, one per line or comma-separated. This does not use a Saved View and does not create CRM leads.'}</p>
      </div>
      <span className="rounded-full bg-[var(--crm-info-soft)] px-3 py-1 text-[10px] font-black text-[var(--crm-info)]">{parsed.parcelIds.length.toLocaleString()} unique parcel{parsed.parcelIds.length === 1 ? '' : 's'}</span>
    </div>

    <label className="mt-4 block">
      <span className="text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Parcel IDs</span>
      <textarea
        value={paste}
        onChange={(event) => { setPaste(event.target.value); setError(null); setNotice(null) }}
        rows={6}
        spellCheck={false}
        aria-label="Jackson parcel IDs"
        placeholder={'SYN-JACKSON-PARCEL-0001\nSYN-JACKSON-PARCEL-0002'}
        className="crm-field mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs leading-5"
      />
    </label>
    {parsed.error ? <p role="alert" className="mt-2 text-xs font-bold text-[var(--crm-danger)]">{parsed.error}</p> : null}

    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--crm-border)] pt-4">
      <p className="max-w-xl text-[10px] leading-4 text-[var(--crm-text-muted)]">Only matching Jackson source prospects are enrolled. Every associated phone is snapshotted. Nothing is called or messaged.</p>
      <button type="button" onClick={() => { setError(null); setConfirmOpen(true) }} disabled={parsed.parcelIds.length < 1 || Boolean(parsed.error) || enrolling} className="crm-primary-button h-10 rounded-lg px-4 text-xs font-black disabled:opacity-40">Review {parsed.parcelIds.length.toLocaleString()} parcels</button>
    </div>
    {notice ? <p role="status" className="mt-3 rounded-lg bg-[var(--crm-success-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-success)]">{notice}</p> : null}
    {error && !confirmOpen ? <p role="alert" className="mt-3 rounded-lg bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}

    {confirmOpen ? <div className="fixed inset-0 z-[90] grid place-items-center bg-[#101711]/60 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !enrolling) setConfirmOpen(false) }}>
      <section role="dialog" aria-modal="true" aria-labelledby="parcel-enrollment-title" className="crm-panel w-full max-w-lg rounded-2xl p-6 shadow-2xl">
        <p className="crm-eyebrow">Reviewed parcel enrollment</p>
        <h2 id="parcel-enrollment-title" className="mt-1 text-xl font-black text-[var(--crm-ink)]">Add {parsed.parcelIds.length.toLocaleString()} Jackson parcels?</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--crm-text-muted)]">The reviewed count must still match these exact parcel IDs. Missing, extra, or non-Jackson rows are rejected.</p>
        <div className="mt-4 rounded-xl bg-[var(--crm-surface-subtle)] p-4 text-xs leading-5 text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">This is inert enrollment.</strong> Unlinked county records remain source Prospects. Blocked phones stay visible but unusable. {campaignKind === 'sms' ? 'Every source Prospect waits for an explicit recipient choice.' : 'Calls begin only after campaign activation and a human starts the calling floor.'}</div>
        {error ? <p role="alert" className="mt-3 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmOpen(false)} disabled={enrolling} className="crm-secondary-button h-10 rounded-lg px-4 text-xs font-black">Cancel</button>
          <button type="button" onClick={() => void enrollReviewedParcels()} disabled={enrolling} className="crm-primary-button h-10 rounded-lg px-4 text-xs font-black disabled:opacity-50">{enrolling ? 'Adding reviewed parcels…' : 'Add reviewed parcels'}</button>
        </div>
      </section>
    </div> : null}
  </section>
}
