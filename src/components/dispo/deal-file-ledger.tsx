'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { DEAL_LEDGER_CATEGORY_LABELS, type DealLedgerLine } from '@/types/deal-ledger'

function money(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function signedAmount(line: DealLedgerLine) {
  return line.direction === 'out' ? -line.amount : line.amount
}

export function DealFileLedger({
  leadId,
  fileNumber,
}: {
  leadId: string
  fileNumber: string | null
}) {
  const [lines, setLines] = useState<DealLedgerLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (leadId) params.set('lead_id', leadId)
    if (fileNumber) params.set('file_number', fileNumber)

    async function load() {
      try {
        const res = await fetch(`/api/deal-ledger?${params}`, { cache: 'no-store', signal: controller.signal })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load ledger')
        setLines(data.lines ?? [])
        setError(null)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load ledger')
        setLines([])
      }
    }

    load()
    return () => controller.abort()
  }, [fileNumber, leadId])

  const net = useMemo(() => (lines ?? []).reduce((sum, line) => sum + signedAmount(line), 0), [lines])

  return (
    <section className="mt-4 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-raised)] p-3" aria-label="Deal File ledger">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="account_balance" size="text-base" className="text-[var(--crm-brand)]" />
          <h3 className="text-sm font-black text-[var(--crm-ink)]">Ledger</h3>
        </div>
        {lines && lines.length > 0 ? (
          <p className="text-xs font-bold text-[var(--crm-text-muted)]">Net {money(net)}</p>
        ) : null}
      </div>

      {error ? <p className="text-sm font-semibold text-[var(--crm-danger)]">{error}</p> : null}
      {!error && lines === null ? <p className="text-sm font-semibold text-[var(--crm-text-muted)]">Loading ledger…</p> : null}
      {!error && lines && lines.length === 0 ? (
        <p className="text-sm font-semibold text-[var(--crm-text-muted)]">No money posted on this file yet.</p>
      ) : null}

      {lines && lines.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] font-bold uppercase text-[var(--crm-text-muted)]">
                <th className="py-1 pr-3">Date</th>
                <th className="py-1 pr-3">Category</th>
                <th className="py-1 pr-3">Memo</th>
                <th className="py-1 pr-3">Source</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-t border-[var(--crm-border)] text-[var(--crm-ink)]">
                  <td className="py-2 pr-3 whitespace-nowrap">{line.posted_on}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{DEAL_LEDGER_CATEGORY_LABELS[line.category]}</td>
                  <td className="py-2 pr-3">{line.memo || '—'}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-[var(--crm-text-muted)]">{line.source}</td>
                  <td className={`py-2 text-right font-bold whitespace-nowrap ${line.direction === 'out' ? 'text-[var(--crm-danger)]' : 'text-[var(--crm-success)]'}`}>
                    {line.direction === 'out' ? '−' : '+'}{money(line.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
