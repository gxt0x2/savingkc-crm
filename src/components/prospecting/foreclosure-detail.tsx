'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { ForeclosureMap } from '@/components/prospecting/foreclosure-map'
import { ForeclosureKpis, ForeclosureStatusPill } from '@/components/prospecting/foreclosure-mobile'
import { ProspectingSectionNav } from '@/components/prospecting/prospecting-section-nav'
import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import {
  EQUITY_BAND_LABELS,
  FIRST_FORECLOSURE_COUNTIES,
  NOTICE_TYPE_LABELS,
  SALE_STATUS_LABELS,
  STATUS_LABELS,
  chicagoDate,
  daysUntilSale,
  describeNoticeEvent,
  foreclosureMapPins,
  formatEquity,
  formatLtv,
  formatSaleDate,
  formatUsDate,
  loanToValuePercent,
  saleTimingLabel,
  type EquityBand,
  type ForeclosureNoticeType,
  type ForeclosureStatus,
  type NoticeTimelineEvent,
  type SaleStatus,
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
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return await response.json() as T & { error?: string }
}

function outreachOf(prospect: { outreachCount?: number; noticesSent?: number }) {
  return prospect.outreachCount ?? prospect.noticesSent ?? 0
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

  return <>
    <WorkspaceChrome commandBar={<h1 className="truncate text-xl font-black text-[var(--crm-ink)]">Foreclosure</h1>} />
    <main className="fc-mobile min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
      <div className="mx-auto max-w-4xl space-y-3">
        <ProspectingSectionNav current="foreclosure" />
        <Link href="/prospecting/foreclosure" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--fc-text-secondary)] hover:text-[var(--fc-text)]"><Icon name="arrow_back" />All foreclosure prospects</Link>
        {error ? <p role="alert" className="rounded-[14px] border border-[var(--fc-danger)]/30 bg-[var(--fc-danger-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-danger)]">{error}</p> : null}
        {notice ? <p role="status" className="rounded-[14px] border border-[var(--fc-success)]/30 bg-[var(--crm-success-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-success)]">{notice}</p> : null}
        {!prospect ? <p className="text-sm text-[var(--fc-text-secondary)]">Loading foreclosure prospect…</p> : <article className="space-y-3">
          <section className="crm-panel p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="fc-kicker">{county} · {SALE_STATUS_LABELS[saleStatus]}{noticeType ? ` · ${noticeType}` : ''}</p>
              <ForeclosureStatusPill status={prospect.status} />
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--fc-text)]">{prospect.ownerName}</h2>
            <p className="mt-1 text-sm text-[var(--fc-text-secondary)]">{prospect.situs}{prospect.city ? `, ${prospect.city}` : ''} {prospect.state} {prospect.zip || ''}</p>
            <p className="mt-2 text-sm font-bold">Owner is a {prospect.ownerEntity}. {prospect.ownerEntity === 'person' ? 'Phones can follow the equity floor.' : 'Owner-name gate holds phones.'}{prospect.absentee ? ' Absentee signal is on.' : ''}</p>
            <div className="mt-4">
              <ForeclosureKpis items={[
                { label: 'Equity', value: formatEquity(prospect.estEquity) },
                { label: 'Loan balance', value: formatEquity(prospect.estDebt) },
                { label: 'LTV', value: formatLtv(prospect.ltv ?? loanToValuePercent(prospect.estValue, prospect.estDebt)) },
                { label: 'Days to auction', value: days == null ? '—' : String(days) },
              ]} />
            </div>
            <p className="mt-3 text-sm font-bold text-[var(--fc-text-secondary)]">{EQUITY_BAND_LABELS[prospect.equityBand]}{prospect.priority ? ' · sorts first' : ''}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="font-bold text-[var(--fc-text-secondary)]">Sale status</dt><dd>{SALE_STATUS_LABELS[saleStatus]}</dd></div>
              <div><dt className="font-bold text-[var(--fc-text-secondary)]">Date of sale</dt><dd>{formatSaleDate(prospect.saleDate)}{prospect.saleTime ? ` · ${prospect.saleTime}` : ''} · {saleTimingLabel(prospect.saleDate, today)}</dd></div>
              <div><dt className="font-bold text-[var(--fc-text-secondary)]">Attorney</dt><dd>{prospect.attorneyName || 'Not recorded'}</dd></div>
              <div><dt className="font-bold text-[var(--fc-text-secondary)]">Outreach</dt><dd>{outreachOf(prospect)}</dd></div>
              <div><dt className="font-bold text-[var(--fc-text-secondary)]">Filing</dt><dd>{formatUsDate(prospect.noticeOrFilingDate)}{noticeType ? ` · ${noticeType}` : ''}{prospect.noticeTypeSource ? ` · ${prospect.noticeTypeSource}` : ''}</dd></div>
              <div><dt className="font-bold text-[var(--fc-text-secondary)]">Case</dt><dd>{prospect.caseNumber || prospect.instrumentNumber || 'Not recorded'}</dd></div>
              <div><dt className="font-bold text-[var(--fc-text-secondary)]">Lender / firm</dt><dd>{prospect.plaintiffLender || 'Not recorded'}{prospect.trusteeOrFirm ? ` · ${prospect.trusteeOrFirm}` : ''}</dd></div>
              <div><dt className="font-bold text-[var(--fc-text-secondary)]">Location</dt><dd>{prospect.saleLocation || 'Venue not recorded'}</dd></div>
              <div><dt className="font-bold text-[var(--fc-text-secondary)]">Phones</dt><dd>{prospect.phones.length > 0 ? prospect.phones.map((phone) => formatPhone(phone)).join(', ') : 'No SmartSkip phone'}</dd></div>
              <div><dt className="font-bold text-[var(--fc-text-secondary)]">Source</dt><dd>{prospect.sourceUrl ? <a href={prospect.sourceUrl} className="font-bold text-[var(--fc-info)] hover:underline">{prospect.sourceName || 'Notice source'}</a> : (prospect.sourceName || 'Not recorded')}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-[var(--fc-text-secondary)]">Value {formatEquity(prospect.estValue)} ({prospect.estValueSource || 'no source'}) minus debt {formatEquity(prospect.estDebt)} ({prospect.estDebtSource || 'no source'}). Preferable haircut is a sort flag only{prospect.preferable ? ' and this row clears it' : ''}.</p>
            {prospect.notes ? <p className="mt-3 text-sm">{prospect.notes}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {prospect.dialReady ? <button type="button" disabled={busy} onClick={() => void startCall()} className="fc-call inline-flex h-10 items-center gap-2 px-4 text-sm font-black"><Icon name="call" />Call</button> : <p className="text-sm font-bold text-[var(--fc-text-secondary)]">{prospect.dialBlockers[0] || 'Not dial-ready'}</p>}
              {prospect.leadId ? <Link href={`/leads/${prospect.leadId}`} className="crm-secondary-button inline-flex h-10 items-center px-4 text-sm font-black">Open lead file</Link> : null}
              {prospect.status === 'callable' || prospect.status === 'skip_traced' ? <button type="button" disabled={busy} onClick={() => void setStatus('contacted')} className="crm-secondary-button h-10 px-4 text-sm font-black">Mark contacted</button> : null}
              <button type="button" disabled={busy} onClick={() => void setStatus('dnc')} className="crm-secondary-button h-10 px-4 text-sm font-black">Mark DNC</button>
              <button type="button" disabled={busy} onClick={() => void setStatus('dead')} className="crm-secondary-button h-10 px-4 text-sm font-black">Mark dead</button>
            </div>
          </section>
          {prospect.latitude != null && prospect.longitude != null ? <ForeclosureMap pins={foreclosureMapPins([prospect])} heightClass="h-48" /> : null}
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
            <label className="text-xs font-bold text-[var(--fc-text-secondary)] sm:col-span-2">Notice type
              <select name="noticeType" aria-label="Notice type" defaultValue={prospect.noticeType ?? ''} className="crm-field mt-1 h-10 w-full px-3 text-sm">
                <option value="">Unknown filing</option>
                {Object.entries(NOTICE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <div className="sm:col-span-2">
              <h4 className="text-xs font-black uppercase tracking-wide text-[var(--fc-text-secondary)]">Update timeline</h4>
              {timeline.length === 0 ? <p className="mt-2 text-sm text-[var(--fc-text-secondary)]">No attorney or sale-date changes yet.</p> : <ul className="fc-timeline mt-2">
                {timeline.map((event, index) => <li key={`${event.at}-${event.field}-${index}`}>{describeNoticeEvent(event)}</li>)}
              </ul>}
            </div>
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
            <p className="text-xs leading-5 text-[var(--fc-text-secondary)] sm:col-span-2">SmartSkip runs only after the $75,000 equity floor, and only for a person owner. LLC, trust, and estate names are gated before phones. Relatives skip is not used.</p>
            <button type="submit" disabled={busy} className="fc-call h-10 text-sm font-black sm:col-span-2">Save equity and phones</button>
          </form>
        </article>}
      </div>
    </main>
  </>
}
