'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { ForeclosureMap } from '@/components/prospecting/foreclosure-map'
import { ForeclosureStatusPill } from '@/components/prospecting/foreclosure-mobile'
import { ProspectingSectionNav } from '@/components/prospecting/prospecting-section-nav'
import { formatPhone } from '@/lib/format'
import { foreclosureAgentNote, foreclosureOwnerLabel, foreclosureOwnerLines, foreclosurePersonLabel, foreclosurePostalAddress } from '@/lib/prospecting/foreclosure-list'
import {
  FIRST_FORECLOSURE_COUNTIES,
  classifyOwnerEntity,
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
  mailingAddress?: string | null
  absentee?: boolean
  legalDescription?: string | null
  externalRowId?: string | null
  attorneyName?: string | null
  saleStatus?: SaleStatus | string | null
  noticeType?: ForeclosureNoticeType | null
  noticeTypeSource?: string | null
  noticeTimeline?: NoticeTimelineEvent[]
  ltv?: number | null
  noticeNumber?: number | null
  skipPhones?: SkipPhone[]
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return <div className="fc-fact"><dt>{term}</dt><dd>{children}</dd></div>
}

function Flag({ value }: { value: string }) {
  const tone = value === 'Yes' ? 'fc-flag-yes' : value === 'No' ? 'fc-flag-no' : ''
  return <span className={tone}>{value}</span>
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
  const [tab, setTab] = useState<'details' | 'ownership' | 'financials' | 'contacts' | 'notes' | 'notice' | 'maps'>('details')

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

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (prospect?.notes && !foreclosureAgentNote(prospect.notes)) return
    const notes = String(new FormData(event.currentTarget).get('notes') ?? '').trim()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/prospecting/foreclosure/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      const body = await readJson<{ prospect: ForeclosureDetailRecord }>(response)
      if (!response.ok) throw new Error(body.error || 'Note could not be saved.')
      setProspect(body.prospect)
      setNotice('Note saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Note could not be saved.')
    } finally {
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
  const agentNote = foreclosureAgentNote(prospect?.notes)
  const systemNotesHidden = Boolean(prospect?.notes && !agentNote)
  const llc = prospect ? (prospect.ownerEntity === 'llc' || classifyOwnerEntity(prospect.ownerName) === 'llc' ? 'Yes' : 'No') : 'Unknown'
  const absentee = prospect?.absentee ? 'Yes' : prospect?.mailingAddress
    ? (address.split(',')[0] && prospect.mailingAddress.toLowerCase().includes(address.split(',')[0].toLowerCase()) ? 'No' : 'Yes')
    : 'Unknown'
  const ltv = prospect ? formatLtv(prospect.ltv ?? loanToValuePercent(prospect.estValue, prospect.estDebt)) : '—'
  const mapsQuery = encodeURIComponent(address)
  const tabs = [
    ['details', 'Details'],
    ['ownership', 'Ownership'],
    ['financials', 'Financials'],
    ['contacts', 'Contacts'],
    ['notes', 'Notes'],
    ['notice', 'Notice file'],
    ['maps', 'Maps'],
  ] as const

  const daysTone = auctionUrgency(days)
  const lender = [prospect?.plaintiffLender, prospect?.trusteeOrFirm].filter(Boolean).join(' · ') || 'Not recorded'
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`

  return <>
    <WorkspaceChrome commandBar={<h1 className="truncate text-xl font-black text-[var(--crm-ink)]">Foreclosure</h1>} />
    <main className="fc-mobile min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
      <div className="mx-auto max-w-[90rem] space-y-3">
        <ProspectingSectionNav current="foreclosure" />
        {error ? <p role="alert" className="rounded-[14px] border border-[var(--fc-danger)]/30 bg-[var(--fc-danger-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-danger)]">{error}</p> : null}
        {notice ? <p role="status" className="rounded-[14px] border border-[var(--fc-success)]/30 bg-[var(--crm-success-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-success)]">{notice}</p> : null}
        {!prospect ? <p className="text-sm text-[var(--fc-text-secondary)]">Loading foreclosure prospect…</p> : <article className="space-y-3">
          <header className="fc-hero">
            <div>
              <Link href="/prospecting/foreclosure" className="fc-back">← Back</Link>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="fc-badge">Foreclosures</span>
                <ForeclosureStatusPill status={prospect.status} />
                {deceased ? <span className="fc-pill fc-pill-dead">Deceased</span> : null}
              </div>
              <h2>{address}</h2>
              <p className="mt-1 text-sm font-bold text-[var(--fc-text-secondary)]">{county}{prospect.externalRowId ? ` · Notice ${prospect.externalRowId}` : ''}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {prospect.dialReady ? <button type="button" disabled={busy} onClick={() => void startCall()} className="fc-call inline-flex h-10 items-center px-4 text-sm font-black">Call</button> : dialNote ? <p className="text-sm font-bold text-[var(--fc-text-secondary)]">{dialNote}</p> : null}
              {prospect.leadId ? <Link href={`/leads/${prospect.leadId}`} className="crm-secondary-button inline-flex h-10 items-center px-4 text-sm font-black">Open lead file</Link> : null}
              {prospect.status === 'callable' || prospect.status === 'skip_traced' ? <button type="button" disabled={busy} onClick={() => void setStatus('contacted')} className="crm-secondary-button h-10 px-4 text-sm font-black">Mark contacted</button> : null}
              <button type="button" disabled={busy} onClick={() => void setStatus('dnc')} className="crm-secondary-button h-10 px-4 text-sm font-black">Mark DNC</button>
              <button type="button" disabled={busy} onClick={() => void setStatus('dead')} className="crm-secondary-button h-10 px-4 text-sm font-black">Mark dead</button>
            </div>
          </header>
          <dl className="fc-kpi-strip" aria-label="Key performance indicators">
            <div><dt>Est. equity</dt><dd>{formatEquity(prospect.estEquity)}</dd></div>
            <div><dt>Est. debt</dt><dd>{formatEquity(prospect.estDebt)}</dd></div>
            <div><dt>LTV</dt><dd>{ltv}</dd></div>
            <div><dt>Days to auction</dt><dd className={daysTone === 'none' ? undefined : `fc-days-${daysTone}`}>{days == null ? '—' : String(days)}</dd></div>
            <div><dt>Sale status</dt><dd>{SALE_STATUS_LABELS[saleStatus]}</dd></div>
            <div><dt>LLC owned</dt><dd><Flag value={llc} /></dd></div>
            <div><dt>Absentee</dt><dd><Flag value={absentee} /></dd></div>
          </dl>
          <div className="fc-tabbar" role="tablist" aria-label="Prospect file">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`fc-tab-${id}`} aria-controls={`fc-panel-${id}`} aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'details' ? <div id="fc-panel-details" role="tabpanel" aria-labelledby="fc-tab-details" className="fc-split">
            <section className="fc-panel-card">
              <h3>Property</h3>
              <dl>
                <Fact term="Owners">{owners.length === 0 ? 'Owner unknown' : owners.map((line) => <span key={line} className="block">{line}</span>)}</Fact>
                <Fact term="Date of sale">{formatSaleDate(prospect.saleDate)}{prospect.saleTime ? ` · ${prospect.saleTime}` : ''} · {saleTimingLabel(prospect.saleDate, today)}</Fact>
                <Fact term="Filed">{formatUsDate(prospect.noticeOrFilingDate)}{noticeType ? ` · ${noticeType}` : ''}</Fact>
                <Fact term="Notice">{noticeOrdinal || 'Not numbered'}</Fact>
                <Fact term="County">{county}</Fact>
                {prospect.saleLocation ? <Fact term="Sale location">{prospect.saleLocation}</Fact> : null}
              </dl>
            </section>
            <section className="fc-panel-card">
              <h3>Financial & legal</h3>
              <dl>
                <Fact term="Sale status">{SALE_STATUS_LABELS[saleStatus]}</Fact>
                <Fact term="Est. equity">{formatEquity(prospect.estEquity)}</Fact>
                <Fact term="Est. debt">{formatEquity(prospect.estDebt)}</Fact>
                <Fact term="Attorney">{prospect.attorneyName || 'Not recorded'}</Fact>
                <Fact term="Lender / firm">{lender}</Fact>
                <Fact term="Case">{prospect.caseNumber || prospect.instrumentNumber || 'Not recorded'}</Fact>
                <Fact term="Source">{prospect.sourceUrl ? <a href={prospect.sourceUrl} className="font-bold text-[var(--fc-info)] hover:underline">{prospect.sourceName || 'Notice source'}</a> : (prospect.sourceName || 'Not recorded')}</Fact>
                {prospect.legalDescription ? <Fact term="Notice text">{prospect.legalDescription}</Fact> : null}
              </dl>
            </section>
          </div> : null}
          {tab === 'ownership' ? <div id="fc-panel-ownership" role="tabpanel" aria-labelledby="fc-tab-ownership" className="fc-panel-card">
            <h3>Owner data</h3>
            {owners.length === 0 && !prospect.mailingAddress ? <p className="fc-empty">No owner or mailing address is on this record.</p> : <dl>
              {owners.map((line) => <Fact key={line} term="Owner">{line}</Fact>)}
              <Fact term="Mailing">{prospect.mailingAddress || 'Not recorded'}</Fact>
              {prospect.legalDescription ? <Fact term="Legal description">{prospect.legalDescription}</Fact> : null}
            </dl>}
          </div> : null}
          {tab === 'financials' ? <div id="fc-panel-financials" role="tabpanel" aria-labelledby="fc-tab-financials" className="fc-panel-card">
            <h3>Equity and loan</h3>
            <dl>
              <Fact term="Est. value">{formatEquity(prospect.estValue)}{prospect.estValueSource ? ` · ${prospect.estValueSource}` : ''}</Fact>
              <Fact term="Est. equity">{formatEquity(prospect.estEquity)}</Fact>
              <Fact term="Est. debt">{formatEquity(prospect.estDebt)}{prospect.estDebtSource ? ` · ${prospect.estDebtSource}` : ''}</Fact>
              <Fact term="LTV">{ltv}</Fact>
              <Fact term="More than one mortgage">Not recorded</Fact>
            </dl>
          </div> : null}
          {tab === 'contacts' ? <div id="fc-panel-contacts" role="tabpanel" aria-labelledby="fc-tab-contacts" className="fc-panel-card">
            <h3>Owner information</h3>
            <dl>
              <Fact term="Life status">{deceased ? <span className="fc-pill fc-pill-dead">Deceased</span> : prospect.skiptraceVendor ? <span className="fc-flag-yes">Alive</span> : 'Not recorded'}</Fact>
              {prospect.email ? <Fact term="Email">{prospect.email}</Fact> : null}
            </dl>
            <section aria-label="Phones" className="fc-phones">
              <h4 className="fc-kicker">Phones</h4>
              {skipPhones.length === 0 ? <p className="fc-empty">No phone on file.</p> : <ol className="space-y-1">
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
          </div> : null}
          {tab === 'notes' ? <div id="fc-panel-notes" role="tabpanel" aria-labelledby="fc-tab-notes" className="fc-panel-card">
            <h3>Notes</h3>
            {systemNotesHidden ? <p className="fc-empty">Import notes are stored with the record and are not shown here.</p> : <>
              {agentNote ? <p className="mb-3 text-sm font-bold text-[var(--fc-text)]">{agentNote}</p> : <p className="fc-empty mb-3">No notes have been added yet.</p>}
              <form aria-label="Prospect note" onSubmit={(event) => void saveNote(event)} className="grid gap-2">
                <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Note
                  <textarea name="notes" aria-label="Note" defaultValue={agentNote ?? ''} rows={3} className="crm-field mt-1 w-full px-3 py-2 text-sm" placeholder="Add a note…" />
                </label>
                <button type="submit" disabled={busy} className="fc-call h-10 text-sm font-black">Save note</button>
              </form>
            </>}
          </div> : null}
          {tab === 'notice' ? <div id="fc-panel-notice" role="tabpanel" aria-labelledby="fc-tab-notice" className="space-y-3">
            <form aria-label="Notice file" onSubmit={(event) => void saveNoticeFile(event)} className="fc-panel-card grid gap-3 sm:grid-cols-2">
              <h3 className="sm:col-span-2">Notice file</h3>
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
            <form aria-label="Equity and SmartSkip" onSubmit={(event) => void saveFacts(event)} className="fc-panel-card grid gap-3 sm:grid-cols-2">
              <h3 className="sm:col-span-2">Equity and SmartSkip</h3>
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
          </div> : null}
          {tab === 'maps' ? <div id="fc-panel-maps" role="tabpanel" aria-labelledby="fc-tab-maps" className="space-y-3">
            <div className="fc-panel-card flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-[var(--fc-text)]">{address}</p>
              <a className="fc-call inline-flex h-10 items-center px-4 text-sm font-black" href={mapsHref} target="_blank" rel="noreferrer">Open in Google Maps</a>
            </div>
            {prospect.latitude != null && prospect.longitude != null
              ? <ForeclosureMap pins={foreclosureMapPins([{ ...prospect, ownerName: foreclosureOwnerLabel(prospect.ownerName) }])} heightClass="fc-map-canvas" />
              : <p className="fc-empty">Map coordinates are not on this record.</p>}
            <p className="fc-empty">Street View is not loaded on this page. Open Google Maps for the panorama.</p>
          </div> : null}
        </article>}
      </div>
    </main>
  </>
}
