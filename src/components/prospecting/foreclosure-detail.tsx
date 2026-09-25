'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { ForeclosureMap } from '@/components/prospecting/foreclosure-map'
import { ProspectingSectionNav } from '@/components/prospecting/prospecting-section-nav'
import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import {
  EQUITY_BAND_LABELS,
  STATUS_LABELS,
  chicagoDate,
  foreclosureMapPins,
  formatEquity,
  formatSaleDate,
  saleTimingLabel,
  type EquityBand,
  type ForeclosureStatus,
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
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return await response.json() as T & { error?: string }
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

  return <>
    <WorkspaceChrome commandBar={<h1 className="truncate text-xl font-black text-[var(--crm-ink)]">Foreclosure</h1>} />
    <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7">
      <div className="mx-auto max-w-4xl space-y-4">
        <ProspectingSectionNav current="foreclosure" />
        <Link href="/prospecting/foreclosure" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]"><Icon name="arrow_back" />All foreclosure prospects</Link>
        {error ? <p role="alert" className="rounded-xl border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-danger)]">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl border border-[var(--crm-success)]/30 bg-[var(--crm-success-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-success)]">{notice}</p> : null}
        {!prospect ? <p className="text-sm text-[var(--crm-text-muted)]">Loading foreclosure prospect…</p> : <article className="space-y-4">
          <section className="crm-panel rounded-2xl p-4 sm:p-5">
            <p className="crm-eyebrow capitalize">{prospect.county} {prospect.state} · {prospect.noticeLifecycle.split('_').join(' ')}</p>
            <p className="mt-2 text-sm font-bold uppercase tracking-wide text-[var(--crm-text-muted)]">Sale</p>
            <p className="text-2xl font-black text-[var(--crm-ink)]">{formatSaleDate(prospect.saleDate)}{prospect.saleTime ? ` · ${prospect.saleTime}` : ''}</p>
            <p className="text-sm font-bold text-[var(--crm-text)]">{saleTimingLabel(prospect.saleDate, chicagoDate())} · {prospect.saleLocation || 'Venue not recorded'}</p>
            <h2 className="mt-4 text-xl font-black text-[var(--crm-ink)]">{prospect.ownerName}</h2>
            <p className="mt-1 text-sm text-[var(--crm-text-muted)]">{prospect.situs}{prospect.city ? `, ${prospect.city}` : ''} {prospect.state} {prospect.zip || ''}</p>
            <p className="mt-1 text-sm font-bold">Owner is a {prospect.ownerEntity}. Status: {STATUS_LABELS[prospect.status]}.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--crm-border)] px-3 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--crm-text-muted)]">Equity</p>
                <p className="text-xl font-black">{formatEquity(prospect.estEquity)}</p>
                <p className="text-sm text-[var(--crm-text-muted)]">{EQUITY_BAND_LABELS[prospect.equityBand]}{prospect.priority ? ' · sorts first' : ''}</p>
              </div>
              <div className="rounded-xl border border-[var(--crm-border)] px-3 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--crm-text-muted)]">Phones</p>
                {prospect.phones.length > 0 ? prospect.phones.map((phone) => <p key={phone} className="text-lg font-black">{formatPhone(phone)}</p>) : <p className="text-sm font-bold text-[var(--crm-text-muted)]">No SmartSkip phone</p>}
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="font-bold text-[var(--crm-text-muted)]">Case</dt><dd>{prospect.caseNumber || prospect.instrumentNumber || 'Not recorded'}</dd></div>
              <div><dt className="font-bold text-[var(--crm-text-muted)]">Lender / firm</dt><dd>{prospect.plaintiffLender || 'Not recorded'}{prospect.trusteeOrFirm ? ` · ${prospect.trusteeOrFirm}` : ''}</dd></div>
              <div><dt className="font-bold text-[var(--crm-text-muted)]">Source</dt><dd>{prospect.sourceUrl ? <a href={prospect.sourceUrl} className="font-bold text-[var(--crm-info)] hover:underline">{prospect.sourceName || 'Notice source'}</a> : (prospect.sourceName || 'Not recorded')}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-[var(--crm-text-muted)]">Value {formatEquity(prospect.estValue)} ({prospect.estValueSource || 'no source'}) minus debt {formatEquity(prospect.estDebt)} ({prospect.estDebtSource || 'no source'}). Preferable haircut is a sort flag only{prospect.preferable ? ' and this row clears it' : ''}.</p>
            {prospect.notes ? <p className="mt-3 text-sm">{prospect.notes}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {prospect.dialReady ? <button type="button" disabled={busy} onClick={() => void startCall()} className="crm-primary-button inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-black"><Icon name="call" />Call</button> : <p className="text-sm font-bold text-[var(--crm-text-muted)]">{prospect.dialBlockers[0] || 'Not dial-ready'}</p>}
              {prospect.leadId ? <Link href={`/leads/${prospect.leadId}`} className="crm-secondary-button inline-flex h-10 items-center rounded-lg px-4 text-sm font-black">Open lead file</Link> : null}
              {prospect.status === 'callable' || prospect.status === 'skip_traced' ? <button type="button" disabled={busy} onClick={() => void setStatus('contacted')} className="crm-secondary-button h-10 rounded-lg px-4 text-sm font-black">Mark contacted</button> : null}
              <button type="button" disabled={busy} onClick={() => void setStatus('dnc')} className="crm-secondary-button h-10 rounded-lg px-4 text-sm font-black">Mark DNC</button>
              <button type="button" disabled={busy} onClick={() => void setStatus('dead')} className="crm-secondary-button h-10 rounded-lg px-4 text-sm font-black">Mark dead</button>
            </div>
          </section>
          {prospect.latitude != null && prospect.longitude != null ? <ForeclosureMap pins={foreclosureMapPins([prospect])} heightClass="h-48" /> : null}
          <form aria-label="Equity and SmartSkip" onSubmit={(event) => void saveFacts(event)} className="crm-panel grid gap-3 rounded-2xl p-4 sm:grid-cols-2">
            <h3 className="text-base font-black sm:col-span-2">Equity and SmartSkip</h3>
            <label className="text-xs font-bold text-[var(--crm-text-muted)]">Est. value
              <input name="estValue" aria-label="Estimated value" defaultValue={prospect.estValue ?? ''} className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--crm-text-muted)]">Value source
              <input name="estValueSource" aria-label="Value source" defaultValue={prospect.estValueSource ?? ''} className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--crm-text-muted)]">Est. debt
              <input name="estDebt" aria-label="Estimated debt" defaultValue={prospect.estDebt ?? ''} className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--crm-text-muted)]">Debt source
              <input name="estDebtSource" aria-label="Debt source" defaultValue={prospect.estDebtSource ?? ''} className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--crm-text-muted)]">Phone 1
              <input name="phone1" aria-label="Phone 1" defaultValue={prospect.phones[0] ?? ''} className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--crm-text-muted)]">Phone 2
              <input name="phone2" aria-label="Phone 2" defaultValue={prospect.phones[1] ?? ''} className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--crm-text-muted)]">Phone 3
              <input name="phone3" aria-label="Phone 3" defaultValue={prospect.phones[2] ?? ''} className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
            </label>
            <label className="text-xs font-bold text-[var(--crm-text-muted)]">Email
              <input name="email" aria-label="Email" defaultValue={prospect.email ?? ''} className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm font-bold"><input name="smartskip" type="checkbox" defaultChecked={prospect.skiptraceVendor === 'smartskip'} />SmartSkip phones</label>
            <label className="flex items-center gap-2 text-sm font-bold"><input name="deceased" type="checkbox" defaultChecked={prospect.deceased} />Deceased</label>
            <p className="text-xs leading-5 text-[var(--crm-text-muted)] sm:col-span-2">SmartSkip runs only after the $75,000 equity floor, and only for a person owner. LLC, trust, and estate names are stored without phones.</p>
            <button type="submit" disabled={busy} className="crm-primary-button h-10 rounded-lg text-sm font-black sm:col-span-2">Save equity and phones</button>
          </form>
        </article>}
      </div>
    </main>
  </>
}
