'use client'

import { useEffect, useState } from 'react'
import { gapsForLane } from '@/lib/prospecting/court-filing-coverage'
import type { FilingLane, FilingLaneRow } from '@/lib/prospecting/court-filing-source'

export function FilingsLane({ lane }: { lane: FilingLane }) {
  const [rows, setRows] = useState<FilingLaneRow[]>([])
  const [loading, setLoading] = useState(true)
  const gaps = gapsForLane(lane)
  const label = lane === 'divorce' ? 'Divorce filings' : 'Lien filings'

  useEffect(() => {
    let cancelled = false
    fetch(`/api/prospecting/foreclosure/filings?lane=${lane}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json() as { rows?: FilingLaneRow[] }
        if (!cancelled && response.ok && Array.isArray(body.rows)) setRows(body.rows.filter((row) => row.dialerEnrolled === false))
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [lane])

  return (
    <section aria-label={label} className="space-y-3">
      <p className="fc-queue-note">These rows stay out of the foreclosure dial queue.</p>
      <ul className="space-y-2">
        {gaps.map((gap) => (
          <li key={`${gap.county}:${gap.leadType}`} className="rounded-[14px] bg-[var(--fc-screen)] px-3 py-2 text-sm">
            <span className="font-black">{gap.county} · {gap.leadType.replaceAll('_', ' ')}</span>
            <span className="mt-1 block text-[var(--fc-text-secondary)]">{gap.reason}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs font-semibold text-[var(--fc-text-secondary)]">Clay, Wyandotte, Platte, and Cass are not in this pass.</p>
      {loading ? <p className="fc-queue-note">Loading {label.toLowerCase()}…</p> : null}
      {!loading && rows.length === 0 ? <p className="fc-queue-note">No stored {label.toLowerCase()}.</p> : null}
      {!loading && rows.length > 0 ? (
        <table className="w-full text-sm" aria-label={label}>
          <thead>
            <tr>
              <th className="px-2 py-1 text-left">Party</th>
              <th className="px-2 py-1 text-left">County</th>
              <th className="px-2 py-1 text-left">Case</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-2 py-1">{row.partyName}</td>
                <td className="px-2 py-1">{row.county}</td>
                <td className="px-2 py-1">{row.caseNumber || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}
