'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { ForeclosureMap } from '@/components/prospecting/foreclosure-map'
import { ProspectingSectionNav } from '@/components/prospecting/prospecting-section-nav'
import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import {
  EQUITY_BAND_LABELS,
  FIRST_FORECLOSURE_COUNTIES,
  STATUS_LABELS,
  chicagoDate,
  foreclosureMapPins,
  formatEquity,
  formatSaleDate,
  listRowPhones,
  saleTimingLabel,
  type EquityBand,
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
  caseNumber: string | null
  status: ForeclosureStatus
  estEquity: number | null
  equityBand: EquityBand
  priority: boolean
  phones: string[]
  dialReady: boolean
  latitude: number | null
  longitude: number | null
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return await response.json() as T & { error?: string }
}

export function ForeclosureWorkspace() {
  const router = useRouter()
  const today = chicagoDate()
  const [prospects, setProspects] = useState<ForeclosureListItem[]>([])
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

  const pins = foreclosureMapPins(prospects)

  return <>
    <WorkspaceChrome commandBar={<h1 className="truncate text-xl font-black text-[var(--crm-ink)]">Foreclosure</h1>} />
    <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7">
      <div className="mx-auto max-w-6xl space-y-3">
        <ProspectingSectionNav current="foreclosure" />
        <p className="text-sm text-[var(--crm-text-muted)]">Jackson MO and Johnson KS mortgage sales. $75k equity floor. Calls use the Prospecting dialer.</p>
        {error ? <p role="alert" className="rounded-xl border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-danger)]">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl border border-[var(--crm-success)]/30 bg-[var(--crm-success-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-success)]">{notice}</p> : null}
        <ForeclosureMap pins={pins} />
        <section className="crm-panel flex flex-wrap items-end gap-3 rounded-2xl p-3">
          <label className="text-xs font-bold text-[var(--crm-text-muted)]">County
            <select aria-label="County" value={county} onChange={(event) => setCounty(event.target.value)} className="crm-field mt-1 block h-10 rounded-lg px-3 text-sm font-semibold">
              <option value="">All counties</option>
              {FIRST_FORECLOSURE_COUNTIES.map((item) => <option key={item.county} value={item.county}>{item.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-[var(--crm-text-muted)]">Status
            <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className="crm-field mt-1 block h-10 rounded-lg px-3 text-sm font-semibold">
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="flex h-10 items-center gap-2 text-sm font-bold text-[var(--crm-text)]">
            <input type="checkbox" checked={dialReadyOnly} onChange={(event) => setDialReadyOnly(event.target.checked)} />
            Dial-ready only
          </label>
          <label className="flex h-10 items-center gap-2 text-sm font-bold text-[var(--crm-text)]">
            <input type="checkbox" checked={saleThisWeek} onChange={(event) => setSaleThisWeek(event.target.checked)} />
            Sale this week
          </label>
        </section>
        <details className="crm-panel rounded-2xl px-4 py-3">
          <summary className="cursor-pointer text-sm font-black text-[var(--crm-text-muted)]">Import or add a prospect</summary>
          <div className="mt-3 space-y-3">
            <form aria-label="Import foreclosure CSV" onSubmit={(event) => void importCsv(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-xs font-bold text-[var(--crm-text-muted)]">Pilot CSV
                <input name="file" type="file" accept=".csv,text/csv" aria-label="Foreclosure CSV" className="crm-field mt-1 block w-full rounded-lg px-3 py-2 text-sm" />
              </label>
              <button type="submit" disabled={busy} className="crm-secondary-button inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-black">Import</button>
            </form>
            <form aria-label="Add foreclosure prospect" onSubmit={(event) => void addProspect(event)} className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">County
                <select name="county" aria-label="New county" required className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" defaultValue="jackson">
                  {FIRST_FORECLOSURE_COUNTIES.map((item) => <option key={item.county} value={item.county}>{item.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">State
                <input name="state" aria-label="State" defaultValue="MO" className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">Owner
                <input name="ownerName" aria-label="Owner name" required className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">Property
                <input name="situs" aria-label="Property address" required className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">City
                <input name="city" aria-label="City" className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">ZIP
                <input name="zip" aria-label="ZIP" className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">Sale date
                <input name="saleDate" type="date" aria-label="Sale date" className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">Case or instrument
                <input name="caseNumber" aria-label="Case number" className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">Est. value
                <input name="estValue" inputMode="decimal" aria-label="Estimated value" className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">Est. debt
                <input name="estDebt" inputMode="decimal" aria-label="Estimated debt" className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">Latitude
                <input name="latitude" inputMode="decimal" aria-label="Latitude" className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)]">Longitude
                <input name="longitude" inputMode="decimal" aria-label="Longitude" className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="text-xs font-bold text-[var(--crm-text-muted)] sm:col-span-2">SmartSkip phone
                <input name="phone1" aria-label="SmartSkip phone" className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
              </label>
              <label className="flex items-center gap-2 text-sm font-bold"><input name="smartskip" type="checkbox" />Phones are from SmartSkip</label>
              <label className="flex items-center gap-2 text-sm font-bold"><input name="deceased" type="checkbox" />Deceased</label>
              <button type="submit" disabled={busy} className="crm-secondary-button h-10 rounded-lg text-sm font-black sm:col-span-2">Save prospect</button>
            </form>
          </div>
        </details>
        <section className="crm-panel overflow-x-auto rounded-2xl" aria-label="Foreclosure prospects">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-[var(--crm-text-muted)]">
              <tr>
                <th className="px-4 py-3 font-black">Sale</th>
                <th className="px-4 py-3 font-black">Owner / property</th>
                <th className="px-4 py-3 font-black">Equity</th>
                <th className="px-4 py-3 font-black">Phones</th>
                <th className="px-4 py-3 font-black">Status</th>
                <th className="px-4 py-3 font-black">Call</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="px-4 py-8 text-[var(--crm-text-muted)]">Loading foreclosure prospects…</td></tr> : null}
              {!loading && prospects.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-[var(--crm-text-muted)]">No mortgage foreclosure prospects in this queue.</td></tr> : null}
              {prospects.map((prospect) => {
                const phones = listRowPhones(prospect.dialReady, prospect.phones)
                return <tr key={prospect.id} className="border-t border-[var(--crm-border)]">
                  <td className="px-4 py-3">
                    <p className="font-black">{formatSaleDate(prospect.saleDate)}</p>
                    <p className="text-[var(--crm-text-muted)]">{saleTimingLabel(prospect.saleDate, today)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/prospecting/foreclosure/${prospect.id}`} className="font-black text-[var(--crm-ink)] hover:underline">{prospect.ownerName}</Link>
                    <p className="text-[var(--crm-text-muted)]">{prospect.situs}{prospect.city ? `, ${prospect.city}` : ''} {prospect.state}</p>
                    <p className="text-xs capitalize text-[var(--crm-text-muted)]">{prospect.county}{prospect.caseNumber ? ` · ${prospect.caseNumber}` : ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-black">{formatEquity(prospect.estEquity)}</p>
                    <p className="text-[var(--crm-text-muted)]">{EQUITY_BAND_LABELS[prospect.equityBand]}{prospect.priority ? ' · sorts first' : ''}</p>
                  </td>
                  <td className="px-4 py-3 font-bold">{phones.length > 0 ? phones.map((phone) => formatPhone(phone)).join(', ') : '—'}</td>
                  <td className="px-4 py-3 font-bold">{STATUS_LABELS[prospect.status]}</td>
                  <td className="px-4 py-3">
                    {prospect.dialReady ? <button type="button" disabled={busy} onClick={() => void startCall(prospect.id)} className="crm-primary-button inline-flex h-9 items-center gap-1 rounded-lg px-3 text-xs font-black"><Icon name="call" />Call</button> : <span className="text-xs font-bold text-[var(--crm-text-muted)]">Not dial-ready</span>}
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  </>
}
