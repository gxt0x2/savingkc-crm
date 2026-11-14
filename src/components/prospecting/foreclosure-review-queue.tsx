'use client'

import { useCallback, useEffect, useState } from 'react'
import { foreclosureCountyState } from '@/lib/prospecting/foreclosure-list'
import { EQUITY_BAND_LABELS, formatUsDate, type EquityBand } from '@/lib/prospecting/foreclosure'

interface TimelineEvent {
  date: string | null
  source: string | null
  stage: string | null
  sale_date: string | null
  url: string | null
}

export interface ReviewQueueRow {
  id: string
  demo?: boolean
  sourceName: string
  sourceUrl: string | null
  timeline: TimelineEvent[]
  saleDate: string | null
  county: string
  state: string | null
  ownerName: string | null
  trusteeOrFirm: string | null
  equityBand: string | null
  reviewStatus: 'pending' | 'approved' | 'rejected'
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return await response.json() as T & { error?: string }
}

function bandLabel(value: string | null): string {
  if (!value) return '—'
  return value in EQUITY_BAND_LABELS ? EQUITY_BAND_LABELS[value as EquityBand] : value
}

function timelineText(events: TimelineEvent[]): string {
  if (events.length === 0) return '—'
  return events.map((event) => [event.date ? formatUsDate(event.date) : null, event.stage, event.sale_date ? formatUsDate(event.sale_date) : null].filter(Boolean).join(' · ')).join(' → ')
}

const EMPTY_FIXTURES: ReviewQueueRow[] = []

export function ForeclosureReviewQueue({ fixtures = EMPTY_FIXTURES }: { fixtures?: ReviewQueueRow[] }) {
  const [rows, setRows] = useState<ReviewQueueRow[]>([])
  const [usingFixtures, setUsingFixtures] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/prospecting/foreclosure/intake/review', { cache: 'no-store' })
      const body = await readJson<{ rows?: ReviewQueueRow[] }>(response)
      if (!response.ok || !Array.isArray(body.rows)) {
        if (fixtures.length > 0) {
          setRows(fixtures)
          setUsingFixtures(true)
          setError(null)
          return
        }
        throw new Error(body.error || 'The review queue could not be loaded.')
      }
      setUsingFixtures(false)
      setRows(body.rows)
    } catch (loadError) {
      if (fixtures.length > 0) {
        setRows(fixtures)
        setUsingFixtures(true)
        setError(null)
        return
      }
      throw loadError
    }
  }, [fixtures])

  useEffect(() => {
    let cancelled = false
    fetch('/api/prospecting/foreclosure/intake/review', { cache: 'no-store' })
      .then((response) => readJson<{ rows?: ReviewQueueRow[] }>(response).then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (cancelled) return
        if (!response.ok || !Array.isArray(body.rows)) {
          if (fixtures.length > 0) {
            setRows(fixtures)
            setUsingFixtures(true)
            setError(null)
            return
          }
          throw new Error(body.error || 'The review queue could not be loaded.')
        }
        setUsingFixtures(false)
        setRows(body.rows)
      })
      .catch((loadError) => {
        if (cancelled) return
        if (fixtures.length > 0) {
          setRows(fixtures)
          setUsingFixtures(true)
          setError(null)
          return
        }
        setError(loadError instanceof Error ? loadError.message : 'The review queue could not be loaded.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fixtures])

  async function review(action: 'approve' | 'reject', ids: string[]) {
    const chosen = rows.filter((row) => ids.includes(row.id))
    if (chosen.length === 0) return
    if (chosen.every((row) => row.demo)) {
      setNotice(action === 'approve'
        ? 'Sample rows stay in the preview. Nothing was approved or added to Filings.'
        : 'Sample rows stay in the preview. Nothing was rejected.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/prospecting/foreclosure/intake/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids: chosen.filter((row) => !row.demo).map((row) => row.id) }),
      })
      const body = await readJson<{ rows?: ReviewQueueRow[]; approved?: string[]; rejected?: string[]; errors?: Array<{ reason: string }> }>(response)
      if (!response.ok) throw new Error(body.error || 'The review could not be saved.')
      if (Array.isArray(body.rows)) setRows(body.rows)
      else await load()
      setSelected([])
      const problem = body.errors?.[0]?.reason
      const count = action === 'approve' ? body.approved?.length ?? 0 : body.rejected?.length ?? 0
      setNotice(problem ? problem : `${action === 'approve' ? 'Approved' : 'Rejected'} ${count}.`)
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'The review could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id))

  return (
    <section aria-label="Foreclosure review queue" className="fc-queue">
      <div className="fc-filter-bar">
        <p className="fc-queue-note">Pending notices stay here until approved. They are not skip-traced, exported, or dialed.</p>
        <button type="button" className="fc-view" disabled={busy || selected.length === 0} onClick={() => void review('approve', selected)}>
          Approve selected
        </button>
      </div>
      {usingFixtures ? <p className="fc-queue-note">Sample review rows for this preview. They are not seller records.</p> : null}
      {error ? <p role="alert" className="rounded-[14px] border border-[var(--fc-danger)]/30 bg-[var(--fc-danger-soft)] px-3 py-2 text-sm font-bold text-[var(--crm-danger)]">{error}</p> : null}
      {notice ? <p role="status" className="rounded-[14px] border border-[var(--fc-success)]/30 bg-[var(--crm-success-soft)] px-3 py-2 text-sm font-bold text-[var(--crm-success)]">{notice}</p> : null}
      {loading ? <p className="fc-queue-note">Loading the review queue…</p> : null}
      {!loading && rows.length === 0 ? <p className="fc-queue-note">No pending foreclosure notices.</p> : null}
      {!loading && rows.length > 0 ? (
        <div className="fc-table-wrap">
          <table className="fc-table" aria-label="Foreclosure review">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all pending notices"
                    checked={allSelected}
                    onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])}
                  />
                </th>
                <th scope="col">Source</th>
                <th scope="col">Link</th>
                <th scope="col">Timeline</th>
                <th scope="col">Sale date</th>
                <th scope="col">County</th>
                <th scope="col">Owner</th>
                <th scope="col">Trustee</th>
                <th scope="col">Equity band</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="fc-row">
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.ownerName || 'notice'}`}
                      checked={selected.includes(row.id)}
                      onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))}
                    />
                  </td>
                  <td>
                    <span className="fc-status-cell">
                      {row.sourceName}
                      {row.demo ? <span className="fc-sample">Sample</span> : null}
                    </span>
                  </td>
                  <td>
                    {row.sourceUrl
                      ? <a className="fc-owner-link" href={row.sourceUrl} target="_blank" rel="noreferrer">Source</a>
                      : '—'}
                  </td>
                  <td>{timelineText(row.timeline)}</td>
                  <td>{formatUsDate(row.saleDate)}</td>
                  <td><span className="fc-county">{foreclosureCountyState(row.county, row.state)}</span></td>
                  <td>{row.ownerName || '—'}</td>
                  <td>{row.trusteeOrFirm || '—'}</td>
                  <td>{bandLabel(row.equityBand)}</td>
                  <td>
                    <div className="fc-actions">
                      <button type="button" className="fc-view" disabled={busy} onClick={() => void review('approve', [row.id])}>Approve</button>
                      <button type="button" className="fc-reject" disabled={busy} onClick={() => void review('reject', [row.id])}>Reject</button>
                    </div>
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
