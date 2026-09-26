'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { ForeclosureMap } from '@/components/prospecting/foreclosure-map'
import { ForeclosureKpis, ForeclosureStatusPill } from '@/components/prospecting/foreclosure-mobile'
import { ProspectingSectionNav } from '@/components/prospecting/prospecting-section-nav'
import { formatPhone } from '@/lib/format'
import { foreclosureOwnerLabel, foreclosureOwnerLines, foreclosurePersonLabel, foreclosurePostalAddress } from '@/lib/prospecting/foreclosure-list'
import {
  FIRST_FORECLOSURE_COUNTIES,
  NOTICE_TYPE_LABELS,
  SALE_STATUS_LABELS,
  SKIP_RELATIONSHIP_LABELS,
  STATUS_LABELS,
  auctionUrgency,
  chicagoDate,
  daysUntilSale,
  describeNoticeEvent,
  foreclosureMapPins,
  formatEquity,
  formatLtv,
  formatNoticeOrdinal,
  formatSaleDate,
  formatUsDate,
  loanToValuePercent,
  saleTimingLabel,
  type EquityBand,
  type ForeclosureNoticeType,
  type ForeclosureStatus,
  type NoticeTimelineEvent,
  type SaleStatus,
  type SkipPhone,
  type SkipRelationship,
} from '@/lib/prospecting/foreclosure'

interface ForeclosureDetailRecord {
  id: string
  ownerName: string
  ownerEntity: string
  situs: string
  city: string | null
  state: string
  zip: string | null
  county: string
  status: ForeclosureStatus
  noticeLifecycle: string
  saleDate: string | null
  noticeOrFilingDate: string | null
  noticesSent?: number
  outreachCount?: number
  saleTime: string | null
  saleLocation: string | null
  caseNumber: string | null
  instrumentNumber: string | null
  sourceName: string | null
  sourceUrl: string | null
  plaintiffLender: string | null
  trusteeOrFirm: string | null
  estValue: number | null
  estValueSource: string | null
  estDebt: number | null
  estDebtSource: string | null
  estEquity: number | null
  equityBand: EquityBand
  priority: boolean
  preferable: boolean
  phones: string[]
  email: string | null
  deceased: boolean
  skiptraceVendor: string | null
  skiptraceDate: string | null
  dialReady: boolean
  dialBlockers: string[]
  latitude: number | null
  longitude: number | null
  prospectId: string | null
  leadId: string | null
  notes: string | null
  attorneyName?: string | null
  saleStatus?: SaleStatus | string | null
  noticeType?: ForeclosureNoticeType | null
  noticeTypeSource?: string | null
  noticeTimeline?: NoticeTimelineEvent[]
  absentee?: boolean
  ownerSignals?: string[]
  mailingAddress?: string | null
  ltv?: number | null
  noticeNumber?: number | null
  skipPhones?: SkipPhone[]
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return await response.json() as T & { error?: string }
}

function outreachOf(prospect: { outreachCount?: number; noticesSent?: number }) {
  return prospect.outreachCount ?? prospect.noticesSent ?? 0
}

function rankedPhones(prospect: ForeclosureDetailRecord | null): SkipPhone[] {
  if (!prospect) return []
  if (prospect.skipPhones && prospect.skipPhones.length > 0) return [...prospect.skipPhones].sort((left, right) => left.rank - right.rank)
  return prospect.phones.map((phone, index) => ({
    phone,
    contactName: index === 0 ? prospect.ownerName : 'Contact',
    relationship: (index === 0 ? 'subject' : 'other') as SkipRelationship,
    rank: index + 1,
  }))
}

function saleStatusOf(prospect: ForeclosureDetailRecord): SaleStatus {
  if (prospect.saleStatus && prospect.saleStatus in SALE_STATUS_LABELS) return prospect.saleStatus as SaleStatus
  if (prospect.noticeLifecycle === 'scheduled_sale' || prospect.noticeLifecycle === 'confirmed') return 'scheduled'
  if (prospect.noticeLifecycle === 'sold' || prospect.noticeLifecycle === 'cancelled' || prospect.noticeLifecycle === 'reinstated') {
    return prospect.noticeLifecycle
  }
  return 'unknown'
}

export function ForeclosureDetail({ id }: { id: string }) {
  const router = useRouter()
  const [prospect, setProspect] = useState<ForeclosureDetailRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [noticeFileOpen, setNoticeFileOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/prospecting/foreclosure/${id}`, { cache: 'no-store' })
      .then((response) => readJson<{ prospect: ForeclosureDetailRecord }>(response).then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (cancelled) return
        if (!response.ok) throw new Error(body.error || 'Foreclosure prospect was not found.')
        setProspect(body.prospect)
      })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Foreclosure prospect was not found.') })
    return () => { cancelled = true }
  }, [id])

  async function saveFacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/prospecting/foreclosure/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estValue: form.get('estValue'),
          estDebt: form.get('estDebt'),
          estValueSource: form.get('estValueSource') || 'manual',
          estDebtSource: form.get('estDebtSource') || 'manual',
          skiptraceVendor: form.get('smartskip') === 'on' ? 'smartskip' : null,
          phone1: form.get('phone1'),
          phone2: form.get('phone2'),
          phone3: form.get('phone3'),
          deceased: form.get('deceased') === 'on',
          email: form.get('email'),
        }),
      })
      const body = await readJson<{ prospect: ForeclosureDetailRecord }>(response)
      if (!response.ok) throw new Error(body.error || 'Foreclosure prospect could not be saved.')
      setProspect(body.prospect)
      setNotice(`Status is now ${STATUS_LABELS[body.prospect.status]}.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Foreclosure prospect could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function saveNoticeFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/prospecting/foreclosure/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleStatus: form.get('saleStatus'),
          saleDate: form.get('saleDate'),
          attorneyName: form.get('attorneyName'),
          outreachCount: form.get('outreachCount'),
          noticeType: form.get('noticeType'),
          noticeNumber: form.get('noticeNumber'),
        }),
      })
      const body = await readJson<{ prospect: ForeclosureDetailRecord }>(response)
      if (!response.ok) throw new Error(body.error || 'Notice file could not be saved.')
      setProspect(body.prospect)
      setNotice('Notice file updated.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Notice file could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(status: ForeclosureStatus) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/prospecting/foreclosure/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await readJson<{ prospect: ForeclosureDetailRecord }>(response)
      if (!response.ok) throw new Error(body.error || 'Status could not be changed.')
      setProspect(body.prospect)
      setNotice(`Marked ${STATUS_LABELS[body.prospect.status]}.`)
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Status could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  async function startCall() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/prospecting/foreclosure/${id}/call`, { method: 'POST' })
      const body = await readJson<{ href: string }>(response)
      if (!response.ok || !body.href) throw new Error(body.error || 'This prospect is not ready to call.')
      router.push(body.href)
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'This prospect is not ready to call.')
      setBusy(false)
    }
  }

  const today = chicagoDate()
  const county = prospect ? (FIRST_FORECLOSURE_COUNTIES.find((item) => item.county === prospect.county)?.label ?? `${prospect.county} ${prospect.state}`) : ''
  const saleStatus = prospect ? saleStatusOf(prospect) : 'unknown'
  const days = prospect ? daysUntilSale(prospect.saleDate, today) : null
  const timeline = prospect?.noticeTimeline ?? []
  const noticeType = prospect?.noticeType ? NOTICE_TYPE_LABELS[prospect.noticeType] : null
  const noticeOrdinal = formatNoticeOrdinal(prospect?.noticeNumber ?? null)
  const skipPhones = rankedPhones(prospect)
  const owners = prospect ? foreclosureOwnerLines(prospect.ownerName) : []
  const address = prospect ? foreclosurePostalAddress(prospect.situs, prospect) : ''
  const deceased = Boolean(prospect?.deceased || prospect?.status === 'dead')
  const dialNote = prospect?.dialBlockers.find((item) => !/equity floor|\$75,000|75,000/i.test(item)) ?? null

  return <>
    <WorkspaceChrome commandBar={<h1 className="truncate text-xl font-black text-[var(--crm-ink)]">Foreclosure</h1>} />
    <main className="fc-mobile min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
      <div className="mx-auto max-w-[90rem] space-y-3">
        <ProspectingSectionNav current="foreclosure" />
        <Link href="/prospecting/foreclosure" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--fc-text-secondary)] hover:text-[var(--fc-text)]">All foreclosure prospects</Link>
        {error ? <p role="alert" className="rounded-[14px] border border-[var(--fc-danger)]/30 bg-[var(--fc-danger-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-danger)]">{error}</p> : null}
        {notice ? <p role="status" className="rounded-[14px] border border-[var(--fc-success)]/30 bg-[var(--crm-success-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-success)]">{notice}</p> : null}
        {!prospect ? <p className="text-sm text-[var(--fc-text-secondary)]">Loading foreclosure prospect…</p> : <div className="fc-stage">
        <article className="min-w-0 space-y-3">
          <section className="crm-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="fc-kicker">{county} · {SALE_STATUS_LABELS[saleStatus]}{noticeType ? ` · ${noticeType}` : ''}{noticeOrdinal ? ` · ${noticeOrdinal}` : ''}</p>
              <ForeclosureStatusPill status={prospect.status} />
            </div>
            <h2 className="fc-owner-heading">{owners.length === 0 ? 'Owner unknown' : owners.map((line) => <span key={line}>{line}</span>)}</h2>
            {deceased ? <p className="fc-pill fc-pill-dead mt-1">Deceased</p> : null}
            <p className="text-sm text-[var(--fc-text-secondary)]">{address}</p>
            <div className="mt-3">
              <ForeclosureKpis items={[
                { label: 'Equity', value: formatEquity(prospect.estEquity) },
                { label: 'Loan balance', value: formatEquity(prospect.estDebt) },
                { label: 'LTV', value: formatLtv(prospect.ltv ?? loanToValuePercent(prospect.estValue, prospect.estDebt)) },
                { label: 'Days to auction', value: days == null ? '—' : String(days), tone: auctionUrgency(days) },
              ]} />
            </div>
            <dl className="fc-meta">
              <div><dt>Notice</dt><dd>{noticeOrdinal || 'Not numbered'}</dd></div>
              <div><dt>Sale status</dt><dd>{SALE_STATUS_LABELS[saleStatus]}</dd></div>
              <div><dt>Date of sale</dt><dd>{formatSaleDate(prospect.saleDate)}{prospect.saleTime ? ` · ${prospect.saleTime}` : ''} · {saleTimingLabel(prospect.saleDate, today)}</dd></div>
              <div><dt>Attorney</dt><dd>{prospect.attorneyName || 'Not recorded'}</dd></div>
              <div><dt>Outreach</dt><dd>{outreachOf(prospect)}</dd></div>
              <div><dt>Filing</dt><dd>{formatUsDate(prospect.noticeOrFilingDate)}{noticeType ? ` · ${noticeType}` : ''}</dd></div>
              <div><dt>Case</dt><dd>{prospect.caseNumber || prospect.instrumentNumber || 'Not recorded'}</dd></div>
              <div><dt>Lender / firm</dt><dd>{[prospect.plaintiffLender, prospect.trusteeOrFirm].filter(Boolean).join(' · ') || 'Not recorded'}</dd></div>
              <div><dt>Location</dt><dd>{prospect.saleLocation || 'Venue not recorded'}</dd></div>
              <div><dt>Source</dt><dd>{prospect.sourceUrl ? <a href={prospect.sourceUrl} className="font-bold text-[var(--fc-info)] hover:underline">{prospect.sourceName || 'Notice source'}</a> : (prospect.sourceName || 'Not recorded')}</dd></div>
            </dl>
            <section aria-label="Phones" className="fc-phones">
              <h3 className="fc-kicker">Phones</h3>
              {skipPhones.length === 0 ? <p className="text-sm font-bold text-[var(--fc-text-secondary)]">No phone on file</p> : <ol className="space-y-1">
                {skipPhones.map((row) => {
                  const contact = foreclosurePersonLabel(row.contactName, prospect.ownerName)
                  return <li key={`${row.rank}-${row.phone}`} className="fc-phone">
                    <span className="fc-phone-rank">{row.rank}</span>
                    <span>{contact}</span>
                    <span className="fc-phone-role">{SKIP_RELATIONSHIP_LABELS[row.relationship] || row.relationship}</span>
                    <span>{formatPhone(row.phone)}</span>
                  </li>
                })}
              </ol>}
            </section>
            <div className="mt-3 flex flex-wrap gap-2">
              {prospect.dialReady ? <button type="button" disabled={busy} onClick={() => void startCall()} className="fc-call inline-flex h-10 items-center px-4 text-sm font-black">Call</button> : dialNote ? <p className="text-sm font-bold text-[var(--fc-text-secondary)]">{dialNote}</p> : null}
              {prospect.leadId ? <Link href={`/leads/${prospect.leadId}`} className="crm-secondary-button inline-flex h-10 items-center px-4 text-sm font-black">Open lead file</Link> : null}
              {prospect.status === 'callable' || prospect.status === 'skip_traced' ? <button type="button" disabled={busy} onClick={() => void setStatus('contacted')} className="crm-secondary-button h-10 px-4 text-sm font-black">Mark contacted</button> : null}
              <button type="button" disabled={busy} onClick={() => void setStatus('dnc')} className="crm-secondary-button h-10 px-4 text-sm font-black">Mark DNC</button>
              <button type="button" disabled={busy} onClick={() => void setStatus('dead')} className="crm-secondary-button h-10 px-4 text-sm font-black">Mark dead</button>
            </div>
          </section>
          <div className="fc-file-tabs">
            <button type="button" role="tab" id="fc-tab-notice" aria-controls="fc-panel-notice" aria-selected={noticeFileOpen} onClick={() => setNoticeFileOpen((open) => !open)}>
              Notice file
            </button>
          </div>
          <div id="fc-panel-notice" role="tabpanel" aria-labelledby="fc-tab-notice" hidden={!noticeFileOpen} className="space-y-3">
          <form aria-label="Notice file" onSubmit={(event) => void saveNoticeFile(event)} className="crm-panel grid gap-3 p-4 sm:grid-cols-2">
            <h3 className="text-base font-black sm:col-span-2">Notice file</h3>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Sale status
              <select name="saleStatus" aria-label="Sale status" defaultValue={saleStatus} key={`status-${saleStatus}`} className="crm-field mt-1 h-10 w-full px-3 text-sm">
                {Object.entries(SALE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Date of sale
              <input name="saleDate" type="date" aria-label="Date of sale" defaultValue={prospect.saleDate ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Attorney
              <input name="attorneyName" aria-label="Attorney" defaultValue={prospect.attorneyName ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Outreach
              <input name="outreachCount" inputMode="numeric" aria-label="Outreach count" defaultValue={outreachOf(prospect)} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Notice number
              <input name="noticeNumber" inputMode="numeric" aria-label="Notice number" defaultValue={prospect.noticeNumber ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Notice type
              <select name="noticeType" aria-label="Notice type" defaultValue={prospect.noticeType ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm">
                <option value="">Unknown filing</option>
                {Object.entries(NOTICE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {timeline.length > 0 ? <div className="sm:col-span-2">
              <h4 className="text-xs font-black uppercase tracking-wide text-[var(--fc-text-secondary)]">Update timeline</h4>
              <ul className="fc-timeline mt-2">
                {timeline.map((event, index) => <li key={`${event.at}-${event.field}-${index}`}>{describeNoticeEvent(event)}</li>)}
              </ul>
            </div> : null}
            <button type="submit" disabled={busy} className="fc-call h-10 text-sm font-black sm:col-span-2">Save notice file</button>
          </form>
          <form aria-label="Equity and SmartSkip" onSubmit={(event) => void saveFacts(event)} className="crm-panel grid gap-3 p-4 sm:grid-cols-2">
            <h3 className="text-base font-black sm:col-span-2">Equity and SmartSkip</h3>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Est. value
              <input name="estValue" aria-label="Estimated value" defaultValue={prospect.estValue ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Value source
              <input name="estValueSource" aria-label="Value source" defaultValue={prospect.estValueSource ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Est. debt
              <input name="estDebt" aria-label="Estimated debt" defaultValue={prospect.estDebt ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Debt source
              <input name="estDebtSource" aria-label="Debt source" defaultValue={prospect.estDebtSource ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Phone 1
              <input name="phone1" aria-label="Phone 1" defaultValue={prospect.phones[0] ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Phone 2
              <input name="phone2" aria-label="Phone 2" defaultValue={prospect.phones[1] ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Phone 3
              <input name="phone3" aria-label="Phone 3" defaultValue={prospect.phones[2] ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Email
              <input name="email" aria-label="Email" defaultValue={prospect.email ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm font-bold"><input name="smartskip" type="checkbox" defaultChecked={prospect.skiptraceVendor === 'smartskip'} />SmartSkip phones</label>
            <label className="flex items-center gap-2 text-sm font-bold"><input name="deceased" type="checkbox" defaultChecked={prospect.deceased} />Deceased</label>
            <button type="submit" disabled={busy} className="fc-call h-10 text-sm font-black sm:col-span-2">Save equity and phones</button>
          </form>
          </div>
        </article>
        {prospect.latitude != null && prospect.longitude != null ? <div className="fc-stage-map"><ForeclosureMap pins={foreclosureMapPins([{ ...prospect, ownerName: foreclosureOwnerLabel(prospect.ownerName) }])} heightClass="fc-map-canvas" /></div> : null}
        </div>}
      </div>
    </main>
  </>
}
