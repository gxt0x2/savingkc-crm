'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { ProspectingSectionNav } from '@/components/prospecting/prospecting-section-nav'
import { Icon } from '@/components/ui/icon'
import { CRM_DIALER_OPEN_EVENT } from '@/lib/telephony/dialer-events'
import { STAGE_LABELS } from '@/types/pipeline'
import { EXCESS_PROCEEDS_STAGE_PATH, type ExcessProceedsFile, type ExcessProceedsFilter, type ExcessProceedsSort } from '@/types/excess-proceeds'

function money(amount: number | null) {
  if (amount === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
}

function deadlineLabel(file: ExcessProceedsFile) {
  if (file.days_to_claim_deadline === null) return 'No sale date'
  if (file.claim_period_elapsed) return `${Math.abs(file.days_to_claim_deadline)} days past deadline`
  if (file.days_to_claim_deadline === 0) return 'Deadline today'
  return `${file.days_to_claim_deadline} days to deadline`
}

function stageLabel(station: string | null) {
  if (station && station in STAGE_LABELS) return STAGE_LABELS[station as keyof typeof STAGE_LABELS]
  return station || 'New'
}

const FILTERS: { id: ExcessProceedsFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'payout_ready', label: 'Payout ready' },
  { id: 'application_filed', label: 'Application filed' },
  { id: 'claim_elapsed', label: 'Claim period elapsed' },
  { id: 'handoff_ready', label: 'Handoff ready' },
]

export function ExcessProceedsWorkspace() {
  const [files, setFiles] = useState<ExcessProceedsFile[]>([])
  const [sort, setSort] = useState<ExcessProceedsSort>('excess_amount')
  const [filter, setFilter] = useState<ExcessProceedsFilter>('all')
  const [feeIncome, setFeeIncome] = useState<number | null>(null)
  const [recovered, setRecovered] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams({ sort, filter })
    const response = await fetch(`/api/prospecting/excess-proceeds?${params}`, { cache: 'no-store' })
    const body = await response.json() as { files?: ExcessProceedsFile[]; error?: string }
    if (!response.ok) throw new Error(body.error || 'Excess-proceeds files could not be loaded.')
    setFiles(body.files ?? [])
  }, [filter, sort])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load()
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Excess-proceeds files could not be loaded.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [load])

  useEffect(() => {
    let cancelled = false
    const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric' }).format(new Date())
    fetch(`/api/deal-ledger?summary=ytd&year=${year}`, { cache: 'no-store' })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (cancelled || !response.ok) return
        setFeeIncome(typeof body.excessProceedsFeeIncome === 'number' ? body.excessProceedsFeeIncome : 0)
        setRecovered(typeof body.excessProceedsRecovered === 'number' ? body.excessProceedsRecovered : 0)
      })
      .catch(() => { if (!cancelled) { setFeeIncome(null); setRecovered(null) } })
    return () => { cancelled = true }
  }, [])

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/prospecting/excess-proceeds/import', { method: 'POST', body: new FormData(form) })
      const body = await response.json() as { inserted?: number; updated?: number; error?: string; errors?: { message?: string }[]; warnings?: unknown[] }
      if (!response.ok) throw new Error(body.error || 'CSV could not be imported.')
      const problems = body.errors?.length ? ` ${body.errors.length} row${body.errors.length === 1 ? '' : 's'} need a look.` : ''
      setNotice(`Opened ${body.inserted ?? 0} Deal File${body.inserted === 1 ? '' : 's'} and updated ${body.updated ?? 0}.${problems}`)
      form.reset()
      await load()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'CSV could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  function callFile(file: ExcessProceedsFile) {
    if (!file.phone) return
    window.dispatchEvent(new CustomEvent(CRM_DIALER_OPEN_EVENT, {
      detail: { phone: file.phone, name: file.owner_name || file.property_address || 'Owner', leadId: file.lead_id },
    }))
  }

  return (
    <>
      <WorkspaceChrome commandBar={<h1 className="truncate text-xl font-black text-[var(--crm-ink)]">Excess proceeds</h1>} />
      <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mx-auto max-w-[90rem] space-y-3">
          <ProspectingSectionNav current="excess-proceeds" />
          <p className="text-sm text-[var(--crm-text-muted)]">
            Jackson DLT surplus claims live on Deal Files. Path: {EXCESS_PROCEEDS_STAGE_PATH.map((step) => step.lane).join(' → ')}.
            Under contract is the services agreement. Closed means the funds were recovered.
          </p>
          <section className="grid gap-2 sm:grid-cols-2" aria-label="Excess proceeds year to date">
            <div className="rounded-2xl border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--crm-brand)]">Fee income YTD</p>
              <p className="mt-1 text-lg font-black text-[var(--crm-ink)]">{feeIncome === null ? '—' : money(feeIncome)}</p>
            </div>
            <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--crm-text-muted)]">Surplus recovered YTD</p>
              <p className="mt-1 text-lg font-black text-[var(--crm-ink)]">{recovered === null ? '—' : money(recovered)}</p>
            </div>
          </section>
          {error ? <p role="alert" className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2 text-sm font-bold text-[var(--crm-ink)]">{error}</p> : null}
          {notice ? <p role="status" className="rounded-xl border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-2 text-sm font-bold text-[var(--crm-ink)]">{notice}</p> : null}
          <section className="flex flex-wrap items-end gap-2 rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
            <label className="text-xs font-bold text-[var(--crm-ink)]">Sort
              <select aria-label="Sort excess proceeds" value={sort} onChange={(event) => setSort(event.target.value as ExcessProceedsSort)} className="mt-1 block h-9 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-2 text-sm font-semibold text-[var(--crm-ink)]">
                <option value="excess_amount">Excess amount</option>
                <option value="score">Score</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Excess proceeds filters">
              {FILTERS.map((item) => (
                <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`rounded-full px-3 py-1 text-xs font-bold ${filter === item.id ? 'bg-[var(--crm-brand)] text-[var(--crm-on-brand)]' : 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'}`}>
                  {item.label}
                </button>
              ))}
            </div>
            <form className="ml-auto flex flex-wrap items-center gap-2" onSubmit={importCsv}>
              <label className="text-xs font-bold text-[var(--crm-ink)]">County CSV
                <input name="file" type="file" accept=".csv,text/csv" required className="mt-1 block text-xs text-[var(--crm-text-muted)]" />
              </label>
              <button type="submit" disabled={busy} className="rounded-lg bg-[var(--crm-brand)] px-3 py-2 text-xs font-black text-[var(--crm-on-brand)] disabled:opacity-60">
                {busy ? 'Importing…' : 'Upsert'}
              </button>
            </form>
          </section>
          {loading ? <p className="text-sm font-semibold text-[var(--crm-text-muted)]">Loading excess-proceeds files…</p> : null}
          {!loading && files.length === 0 ? <p className="text-sm font-semibold text-[var(--crm-text-muted)]">No Jackson excess-proceeds Deal Files yet. Import a county CSV.</p> : null}
          {files.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)]">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] font-bold uppercase text-[var(--crm-text-muted)]">
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Suit / parcel</th>
                    <th className="px-3 py-2">Excess</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Claim clock</th>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2">Call</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr key={file.id} className="border-t border-[var(--crm-border)] text-[var(--crm-ink)]">
                      <td className="px-3 py-2">
                        <Link href={`/leads/${file.lead_id}`} className="font-bold text-[var(--crm-brand)]">{file.owner_name || 'Unnamed owner'}</Link>
                        <p className="text-xs text-[var(--crm-text-muted)]">{file.property_address || 'No address'}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {file.claim_period_elapsed ? <span className="rounded-full bg-[var(--crm-surface-subtle)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-text-muted)]">Claim period elapsed</span> : null}
                          {file.payout_ready ? <span className="rounded-full bg-[var(--crm-brand-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-brand)]">Payout ready</span> : null}
                          {file.excess_application_filed_date ? <span className="rounded-full border border-[var(--crm-brand-border)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-brand)]">Application filed</span> : null}
                          {file.handoff_ready ? <span className="rounded-full bg-[var(--crm-brand)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-on-brand)]">Handoff ready</span> : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{file.suit_no}<br />{file.parcel_no}</td>
                      <td className="px-3 py-2 font-bold">{money(file.excess_amount)}</td>
                      <td className="px-3 py-2">{file.score ?? '—'}</td>
                      <td className="px-3 py-2">{deadlineLabel(file)}</td>
                      <td className="px-3 py-2">{stageLabel(file.station)}</td>
                      <td className="px-3 py-2">
                        <button type="button" disabled={!file.phone} onClick={() => callFile(file)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--crm-brand-border)] px-2 py-1 text-xs font-bold text-[var(--crm-brand)] disabled:opacity-40" title={file.phone ? 'Call with the CRM dialer' : 'No phone on this Deal File'}>
                          <Icon name="call" size="text-sm" />
                          Call
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </main>
    </>
  )
}
