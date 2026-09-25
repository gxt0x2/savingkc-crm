'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
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
  STATUS_LABELS,
  chicagoDate,
  daysUntilSale,
  foreclosureMapPins,
  formatEquity,
  formatLtv,
  formatUsDate,
  listRowPhones,
  loanToValuePercent,
  type EquityBand,
  type ForeclosureNoticeType,
  type ForeclosureStatus,
} from '@/lib/prospecting/foreclosure'

interface ForeclosureListItem {
  id: string
  ownerName: string
  situs: string
  city: string | null
  state: string
  county: string
  saleDate: string | null
  noticeOrFilingDate: string | null
  noticesSent?: number
  outreachCount?: number
  caseNumber: string | null
  status: ForeclosureStatus
  estEquity: number | null
  estDebt?: number | null
  estValue?: number | null
  equityBand: EquityBand
  priority: boolean
  phones: string[]
  dialReady: boolean
  latitude: number | null
  longitude: number | null
  noticeType?: ForeclosureNoticeType | null
  ownerEntity?: string
  absentee?: boolean
}

interface IngestControl {
  county: string
  noticeType: ForeclosureNoticeType
  paused: boolean
  updatedSince: string | null
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return await response.json() as T & { error?: string }
}

function outreachOf(item: { outreachCount?: number; noticesSent?: number }) {
  return item.outreachCount ?? item.noticesSent ?? 0
}

function countyLabel(county: string, state: string) {
  return FIRST_FORECLOSURE_COUNTIES.find((item) => item.county === county)?.label ?? `${county} ${state}`
}

export function ForeclosureWorkspace() {
  const router = useRouter()
  const today = chicagoDate()
  const [prospects, setProspects] = useState<ForeclosureListItem[]>([])
  const [controls, setControls] = useState<IngestControl[]>([])
  const [county, setCounty] = useState('')
  const [status, setStatus] = useState('')
  const [dialReadyOnly, setDialReadyOnly] = useState(false)
  const [saleThisWeek, setSaleThisWeek] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (county) params.set('county', county)
    if (status) params.set('status', status)
    if (dialReadyOnly) params.set('dialReady', '1')
    if (saleThisWeek) params.set('saleThisWeek', '1')
    const response = await fetch(`/api/prospecting/foreclosure?${params.toString()}`, { cache: 'no-store' })
    const body = await readJson<{ prospects: ForeclosureListItem[] }>(response)
    if (!response.ok) throw new Error(body.error || 'Foreclosure prospects could not be loaded.')
    setProspects(body.prospects)
  }, [county, dialReadyOnly, saleThisWeek, status])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load()
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Foreclosure prospects could not be loaded.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [load])

  useEffect(() => {
    let cancelled = false
    fetch('/api/prospecting/foreclosure/ingest', { cache: 'no-store' })
      .then((response) => readJson<{ controls?: IngestControl[] }>(response).then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (cancelled || !response.ok || !Array.isArray(body.controls)) return
        setControls(body.controls)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const file = new FormData(form).get('file')
    if (!(file instanceof File) || file.size === 0) {
      setError('Choose a CSV file first.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/prospecting/foreclosure/import', { method: 'POST', body: new FormData(form) })
      const body = await readJson<{ imported: number; rejected: Array<{ row: number; reason: string }>; warnings: Array<{ row: number; message: string }> }>(response)
      if (!response.ok) throw new Error(body.error || 'Import failed.')
      const rejected = body.rejected.length ? ` ${body.rejected.length} rejected.` : ''
      const warned = body.warnings.length ? ` ${body.warnings.length} warning${body.warnings.length === 1 ? '' : 's'}.` : ''
      setNotice(`Imported ${body.imported} mortgage foreclosure row${body.imported === 1 ? '' : 's'}.${rejected}${warned}`)
      form.reset()
      await load()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  async function addProspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/prospecting/foreclosure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          county: form.get('county'),
          state: form.get('state'),
          ownerName: form.get('ownerName'),
          situs: form.get('situs'),
          city: form.get('city'),
          zip: form.get('zip'),
          saleDate: form.get('saleDate'),
          caseNumber: form.get('caseNumber'),
          estValue: form.get('estValue'),
          estDebt: form.get('estDebt'),
          estValueSource: form.get('estValue') ? 'manual' : null,
          estDebtSource: form.get('estDebt') ? 'manual' : null,
          skiptraceVendor: form.get('smartskip') === 'on' ? 'smartskip' : null,
          phone1: form.get('phone1'),
          deceased: form.get('deceased') === 'on',
          latitude: form.get('latitude'),
          longitude: form.get('longitude'),
          outreachCount: form.get('outreachCount'),
          noticeType: form.get('noticeType'),
          attorneyName: form.get('attorneyName'),
        }),
      })
      const body = await readJson<{ prospect: { id: string } }>(response)
      if (!response.ok) throw new Error(body.error || 'Prospect could not be added.')
      router.push(`/prospecting/foreclosure/${body.prospect.id}`)
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Prospect could not be added.')
      setBusy(false)
    }
  }

  async function startCall(id: string) {
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

  async function toggleIngest(control: IngestControl) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/prospecting/foreclosure/ingest', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ county: control.county, noticeType: control.noticeType, paused: !control.paused }),
      })
      const body = await readJson<{ controls?: IngestControl[] }>(response)
      if (!response.ok) throw new Error(body.error || 'Ingest pause could not be saved.')
      if (Array.isArray(body.controls)) setControls(body.controls)
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Ingest pause could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const pins = foreclosureMapPins(prospects)

  return <>
    <WorkspaceChrome commandBar={<h1 className="truncate text-xl font-black text-[var(--crm-ink)]">Foreclosure</h1>} />
    <main className="fc-mobile min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
      <div className="mx-auto max-w-[90rem] space-y-3">
        <ProspectingSectionNav current="foreclosure" />
        <div className="flex flex-wrap items-center gap-1.5">
          {FIRST_FORECLOSURE_COUNTIES.map((item) => <span key={item.county} className="fc-chip">{item.label}</span>)}
          <span className="fc-chip">$75k floor</span>
        </div>
        {error ? <p role="alert" className="rounded-[14px] border border-[var(--fc-danger)]/30 bg-[var(--fc-danger-soft)] px-3 py-2 text-sm font-bold text-[var(--crm-danger)]">{error}</p> : null}
        {notice ? <p role="status" className="rounded-[14px] border border-[var(--fc-success)]/30 bg-[var(--crm-success-soft)] px-3 py-2 text-sm font-bold text-[var(--crm-success)]">{notice}</p> : null}
        <ForeclosureMap pins={pins} heightClass="h-40" />
        <section className="crm-panel flex flex-wrap items-end gap-2 p-3">
          <label className="text-xs font-bold text-[var(--fc-text-secondary)]">County
            <select aria-label="County" value={county} onChange={(event) => setCounty(event.target.value)} className="crm-field mt-1 block h-9 px-2 text-sm font-semibold">
              <option value="">All counties</option>
              {FIRST_FORECLOSURE_COUNTIES.map((item) => <option key={item.county} value={item.county}>{item.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Status
            <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className="crm-field mt-1 block h-9 px-2 text-sm font-semibold">
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={dialReadyOnly} onChange={(event) => setDialReadyOnly(event.target.checked)} />
            Dial-ready only
          </label>
          <label className="flex h-9 items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={saleThisWeek} onChange={(event) => setSaleThisWeek(event.target.checked)} />
            Sale this week
          </label>
        </section>
        <details className="crm-panel px-3 py-2">
          <summary className="cursor-pointer text-xs font-black text-[var(--fc-text-secondary)]">Import or add a prospect</summary>
          <div className="mt-3 space-y-3">
            <form aria-label="Import foreclosure CSV" onSubmit={(event) => void importCsv(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-xs font-bold text-[var(--fc-text-secondary)]">Pilot CSV
                <input name="file" type="file" accept=".csv,text/csv" aria-label="Foreclosure CSV" className="crm-field mt-1 block w-full px-3 py-2 text-sm" />
              </label>
              <button type="submit" disabled={busy} className="crm-secondary-button inline-flex h-10 items-center justify-center px-4 text-sm font-black">Import</button>
            </form>
            <form aria-label="Add foreclosure prospect" onSubmit={(event) => void addProspect(event)} className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">County
                <select name="county" aria-label="New county" required className="crm-field mt-1 h-10 w-full px-3 text-sm" defaultValue="jackson">
                  {FIRST_FORECLOSURE_COUNTIES.map((item) => <option key={item.county} value={item.county}>{item.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">State
                <input name="state" aria-label="State" defaultValue="MO" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Owner
                <input name="ownerName" aria-label="Owner name" required className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Property
                <input name="situs" aria-label="Property address" required className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">City
                <input name="city" aria-label="City" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">ZIP
                <input name="zip" aria-label="ZIP" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Sale date
                <input name="saleDate" type="date" aria-label="Sale date" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Case or instrument
                <input name="caseNumber" aria-label="Case number" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Est. value
                <input name="estValue" inputMode="decimal" aria-label="Estimated value" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Est. debt
                <input name="estDebt" inputMode="decimal" aria-label="Estimated debt" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Latitude
                <input name="latitude" inputMode="decimal" aria-label="Latitude" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Longitude
                <input name="longitude" inputMode="decimal" aria-label="Longitude" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Notice type
                <select name="noticeType" aria-label="Notice type" className="crm-field mt-1 h-10 w-full px-3 text-sm" defaultValue="">
                  <option value="">Unknown filing</option>
                  {Object.entries(NOTICE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Attorney
                <input name="attorneyName" aria-label="Attorney" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)]">Outreach count
                <input name="outreachCount" inputMode="numeric" aria-label="Outreach count" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--fc-text-secondary)] sm:col-span-2">SmartSkip phone
                <input name="phone1" aria-label="SmartSkip phone" className="crm-field mt-1 h-10 w-full px-3 text-sm" />
              </label>
              <label className="flex items-center gap-2 text-sm font-bold"><input name="smartskip" type="checkbox" />Phones are from SmartSkip</label>
              <label className="flex items-center gap-2 text-sm font-bold"><input name="deceased" type="checkbox" />Deceased</label>
              <button type="submit" disabled={busy} className="crm-secondary-button h-10 text-sm font-black sm:col-span-2">Save prospect</button>
            </form>
            {controls.length > 0 ? <section aria-label="County ingest">
          <h2 className="text-sm font-black">County ingest</h2>
          <p className="mt-1 text-xs font-semibold text-[var(--fc-text-secondary)]">Pause a county and filing type. The watermark is the scraper updated_since cursor.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {controls.map((control) => {
              const label = `${countyLabel(control.county, '')} · ${NOTICE_TYPE_LABELS[control.noticeType]}`
              return <li key={`${control.county}:${control.noticeType}`} className="flex items-center justify-between gap-3 rounded-[14px] bg-[var(--fc-screen)] px-3 py-2">
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={control.paused}
                    disabled={busy}
                    aria-label={`Pause ${label}`}
                    onChange={() => void toggleIngest(control)}
                  />
                  {label}
                </label>
                <span className="text-xs font-semibold text-[var(--fc-text-secondary)]">{control.paused ? 'Paused' : 'Running'} · {control.updatedSince ? formatUsDate(control.updatedSince.slice(0, 10)) : 'No watermark'}</span>
              </li>
            })}
          </ul>
        </section> : null}
          </div>
        </details>
        <section className="space-y-2" aria-label="Foreclosure prospects">
          {loading ? <p className="crm-panel px-4 py-6 text-sm text-[var(--fc-text-secondary)]">Loading foreclosure prospects…</p> : null}
          {!loading && prospects.length === 0 ? <p className="crm-panel px-4 py-6 text-sm text-[var(--fc-text-secondary)]">No mortgage foreclosure prospects in this queue.</p> : null}
          {prospects.map((prospect) => {
            const phones = listRowPhones(prospect.dialReady, prospect.phones)
            const days = daysUntilSale(prospect.saleDate, today)
            const noticeType = prospect.noticeType ? NOTICE_TYPE_LABELS[prospect.noticeType] : null
            return <article key={prospect.id} className="crm-panel p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="fc-kicker">{countyLabel(prospect.county, prospect.state)}{noticeType ? ` · ${noticeType}` : ''}</p>
                  <Link href={`/prospecting/foreclosure/${prospect.id}`} className="fc-card-link">{prospect.ownerName}</Link>
                  <p className="text-sm text-[var(--fc-text-secondary)]">{prospect.situs}{prospect.city ? `, ${prospect.city}` : ''} {prospect.state}</p>
                </div>
                <ForeclosureStatusPill status={prospect.status} />
              </div>
              <div className="mt-3">
                <ForeclosureKpis items={[
                  { label: 'Equity', value: formatEquity(prospect.estEquity) },
                  { label: 'Loan balance', value: formatEquity(prospect.estDebt ?? null) },
                  { label: 'LTV', value: formatLtv(loanToValuePercent(prospect.estValue ?? null, prospect.estDebt ?? null)) },
                  { label: 'Days to auction', value: days == null ? '—' : String(days) },
                ]} />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-[var(--fc-text-secondary)]">
                  <span className="fc-chip">{EQUITY_BAND_LABELS[prospect.equityBand]}{prospect.priority ? ' · sorts first' : ''}</span>
                  <span className="fc-chip">Sale <span>{formatUsDate(prospect.saleDate)}</span></span>
                  <span className="fc-chip">Filed <span>{formatUsDate(prospect.noticeOrFilingDate)}</span></span>
                  <span className="fc-chip"><span>Outreach</span> <span>{outreachOf(prospect)}</span></span>
                  {prospect.caseNumber ? <span className="fc-chip">{prospect.caseNumber}</span> : null}
                  {prospect.absentee || (prospect.ownerEntity && prospect.ownerEntity !== 'person') ? <span className="fc-chip">Phones held</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{phones.length > 0 ? phones.map((phone) => formatPhone(phone)).join(', ') : '—'}</span>
                  {prospect.dialReady ? <button type="button" disabled={busy} onClick={() => void startCall(prospect.id)} className="fc-call inline-flex h-9 items-center gap-1 px-4 text-xs font-black"><Icon name="call" />Call</button> : <span className="text-xs font-bold text-[var(--fc-text-secondary)]">Not dial-ready</span>}
                </div>
              </div>
            </article>
          })}
        </section>
      </div>
    </main>
  </>
}
