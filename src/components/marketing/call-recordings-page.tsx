'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CALL_REVIEW_FRAMEWORKS, CALL_REVIEW_TAGS, type CallReviewFrameworkId } from '@/lib/call-review-frameworks'
import type { RecordingReviewOutcome, StoredRecordingReviewOutcome } from '@/lib/marketing/call-recordings'

type RecordingSummary = {
  total: number
  needsReview: number
  seller: number
  spam: number
  followUp: number
  googleAds: number
  overFiveMinutes: number
  averageDurationSeconds: number
}

type CallRecordingItem = {
  id: string
  leadId: string | null
  leadName: string
  leadPhoneDisplay: string | null
  leadUrl: string | null
  leadSource: string | null
  leadStation: string | null
  leadPriority: string | null
  propertyAddress: string | null
  city: string | null
  state: string | null
  recordingSid: string
  recordingUrl: string
  callSid: string | null
  direction: string | null
  fromDisplay: string | null
  toDisplay: string | null
  durationSeconds: number
  createdAt: string
  campaign: string | null
  trafficSource: string | null
  trackingNumber: string | null
  phoneProfile: string | null
  isGoogleAds: boolean
  outcome: StoredRecordingReviewOutcome
  reviewNote: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  transcript: string | null
  analysisSummary: string | null
  classification: string | null
  opportunityScore: number | null
  reviewWorkflow: { status: 'available' | 'submitted' | 'completed'; framework: CallReviewFrameworkId | null; assignedReviewer: string | null; score: number | null; tags: string[] }
}

type CallRecordingsResponse = {
  generatedAt: string
  filters: {
    days: number
    minDuration: number
    since: string
  }
  summary: RecordingSummary
  recordings: CallRecordingItem[]
  reviewers: Array<{ name: string; email: string }>
}

type RecordingFilter = 'all' | 'needs_review' | 'google_ads' | 'seller' | 'spam' | 'follow_up'

const DAY_OPTIONS = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
] as const

const DURATION_OPTIONS = [
  { value: 120, label: '2m+' },
  { value: 300, label: '5m+' },
] as const

const FILTERS: Array<{ value: RecordingFilter; label: string }> = [
  { value: 'all', label: 'All calls' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'seller', label: 'Sellers' },
  { value: 'spam', label: 'Spam / wrong #' },
  { value: 'follow_up', label: 'Follow up' },
]

const REVIEW_ACTIONS: Array<{ outcome: RecordingReviewOutcome; label: string; tone: string }> = [
  { outcome: 'seller', label: 'Seller lead', tone: 'green' },
  { outcome: 'follow_up', label: 'Follow up', tone: 'blue' },
  { outcome: 'review_later', label: 'Review later', tone: 'slate' },
  { outcome: 'spam', label: 'Spam/vendor', tone: 'red' },
  { outcome: 'wrong_number', label: 'Wrong #', tone: 'red' },
]

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${minutes}:${String(remaining).padStart(2, '0')}`
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function outcomeLabel(value: StoredRecordingReviewOutcome): string {
  if (value === 'unreviewed') return 'Unreviewed'
  if (value === 'wrong_number') return 'Wrong number'
  if (value === 'review_later') return 'Review later'
  if (value === 'follow_up') return 'Follow up'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isNeedsReview(row: CallRecordingItem): boolean {
  return row.outcome === 'unreviewed' || row.outcome === 'review_later'
}

function filterRecording(row: CallRecordingItem, filter: RecordingFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'needs_review') return isNeedsReview(row)
  if (filter === 'google_ads') return row.isGoogleAds
  if (filter === 'seller') return row.outcome === 'seller'
  if (filter === 'spam') return row.outcome === 'spam' || row.outcome === 'wrong_number'
  if (filter === 'follow_up') return row.outcome === 'follow_up'
  return true
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`recording-stat ${tone ? `tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function CallRecordingsPage() {
  const [days, setDays] = useState(30)
  const [minDuration, setMinDuration] = useState(120)
  const [filter, setFilter] = useState<RecordingFilter>('needs_review')
  const [data, setData] = useState<CallRecordingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [reviewerByCall, setReviewerByCall] = useState<Record<string, string>>({})
  const [frameworkByCall, setFrameworkByCall] = useState<Record<string, CallReviewFrameworkId>>({})
  const [tagsByCall, setTagsByCall] = useState<Record<string, string[]>>({})

  const loadRecordings = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/marketing/call-recordings?days=${days}&minDuration=${minDuration}`, {
        cache: 'no-store',
        signal,
      })
      if (!response.ok) throw new Error(`Unable to load recordings (${response.status})`)
      const payload = await response.json() as CallRecordingsResponse
      setData(payload)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [days, minDuration])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => loadRecordings(controller.signal))
    return () => controller.abort()
  }, [loadRecordings])

  const recordings = useMemo(() => (data?.recordings || []).filter((row) => filterRecording(row, filter)), [data, filter])

  async function markReview(row: CallRecordingItem, outcome: RecordingReviewOutcome) {
    setPendingId(row.id)
    setError(null)
    try {
      const response = await fetch('/api/marketing/call-recordings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId: row.id,
          outcome,
          note: notes[row.id] ?? row.reviewNote ?? '',
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || `Review failed (${response.status})`)
      }
      await loadRecordings()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPendingId(null)
    }
  }

  async function submitForCoaching(row: CallRecordingItem) {
    const assignedReviewer = reviewerByCall[row.id] || data?.reviewers[0]?.email
    if (!assignedReviewer) return setError('No reviewer is available.')
    setPendingId(row.id)
    setError(null)
    try {
      const response = await fetch('/api/marketing/call-recordings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: row.id, action: 'submit', assignedReviewer, framework: frameworkByCall[row.id] || 'junior_acquisitions', tags: tagsByCall[row.id] || [], note: notes[row.id] || '' }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || `Submission failed (${response.status})`)
      }
      await loadRecordings()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPendingId(null)
    }
  }

  const summary = data?.summary

  return (
    <>
      <style>{CALL_RECORDINGS_STYLES}</style>
      <main className="call-recordings" data-theme="dark">
        <div className="recording-wrap">
          <header className="recording-header">
            <div>
              <Link className="back-link" href="/my-day">My Day</Link>
              <h1>Scorecard</h1>
              <p>Tag recorded calls, select a scorecard and reviewer, then submit only the calls that need review.</p>
            </div>
            <button className="refresh-button" type="button" onClick={() => loadRecordings()} disabled={loading}>
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
          </header>

          <section className="recording-stats" aria-label="Call recording summary">
            <Stat label="Recordings" value={summary?.total ?? '--'} />
            <Stat label="Needs Review" value={summary?.needsReview ?? '--'} tone="amber" />
            <Stat label="Seller Leads" value={summary?.seller ?? '--'} tone="green" />
            <Stat label="Google Ads" value={summary?.googleAds ?? '--'} tone="blue" />
            <Stat label="5m+" value={summary?.overFiveMinutes ?? '--'} />
            <Stat label="Avg" value={summary ? formatDuration(summary.averageDurationSeconds) : '--'} />
          </section>

          <section className="recording-controls" aria-label="Call recording filters">
            <div className="segmented">
              {DAY_OPTIONS.map((option) => (
                <button key={option.value} type="button" className={days === option.value ? 'active' : ''} onClick={() => setDays(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="segmented">
              {DURATION_OPTIONS.map((option) => (
                <button key={option.value} type="button" className={minDuration === option.value ? 'active' : ''} onClick={() => setMinDuration(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="segmented wide">
              {FILTERS.map((option) => (
                <button key={option.value} type="button" className={filter === option.value ? 'active' : ''} onClick={() => setFilter(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          {error ? <div className="recording-error" role="alert">{error}</div> : null}

          <section className="recording-list" aria-label="Call recordings">
            {loading && !data ? (
              <div className="recording-empty">Loading recordings.</div>
            ) : recordings.length === 0 ? (
              <div className="recording-empty">No recordings match this view.</div>
            ) : (
              recordings.map((row) => (
                <article className={`recording-row outcome-${row.outcome}`} key={row.id}>
                  <div className="row-main">
                    <div className="row-title">
                      <div>
                        <h2>{row.leadName}</h2>
                        <p>
                          {[row.propertyAddress, row.city, row.state].filter(Boolean).join(', ') || row.leadPhoneDisplay || row.fromDisplay || 'No lead details'}
                        </p>
                      </div>
                      <div className="row-badges">
                        <span className="duration-pill">{formatDuration(row.durationSeconds)}</span>
                        <span className={`outcome-pill ${isNeedsReview(row) ? 'needs' : ''}`}>{outcomeLabel(row.outcome)}</span>
                        {row.isGoogleAds ? <span className="source-pill">Google Ads</span> : null}
                      </div>
                    </div>

                    <div className="call-meta">
                      <span>{formatDateTime(row.createdAt)}</span>
                      {row.direction ? <span>{row.direction}</span> : null}
                      {row.fromDisplay ? <span>From {row.fromDisplay}</span> : null}
                      {row.toDisplay ? <span>To {row.toDisplay}</span> : null}
                      {row.campaign ? <span>{row.campaign}</span> : null}
                      {row.leadStation ? <span>{row.leadStation.replace(/_/g, ' ')}</span> : null}
                      {row.opportunityScore !== null ? <span>Score {row.opportunityScore}</span> : null}
                    </div>

                    <audio controls preload="metadata" src={row.recordingUrl} />

                    <div className="review-line">
                      <input
                        aria-label={`Review note for ${row.leadName}`}
                        value={notes[row.id] ?? row.reviewNote ?? ''}
                        onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                        placeholder="Optional review note"
                      />
                      <div className="review-actions">
                        {REVIEW_ACTIONS.map((action) => (
                          <button
                            key={action.outcome}
                            className={`review-button tone-${action.tone}`}
                            type="button"
                            disabled={pendingId === row.id}
                            onClick={() => markReview(row, action.outcome)}
                          >
                            {pendingId === row.id ? 'Saving' : action.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="review-line coaching-line">
                      <select aria-label={`Scorecard for ${row.leadName}`} disabled={row.reviewWorkflow.status !== 'available'} value={row.reviewWorkflow.framework || frameworkByCall[row.id] || 'junior_acquisitions'} onChange={(event) => setFrameworkByCall((current) => ({ ...current, [row.id]: event.target.value as CallReviewFrameworkId }))}>
                        {CALL_REVIEW_FRAMEWORKS.map((framework) => <option key={framework.id} value={framework.id}>{framework.label}</option>)}
                      </select>
                      <select aria-label={`Reviewer for ${row.leadName}`} disabled={row.reviewWorkflow.status !== 'available'} value={reviewerByCall[row.id] || data?.reviewers[0]?.email || ''} onChange={(event) => setReviewerByCall((current) => ({ ...current, [row.id]: event.target.value }))}>
                        {(data?.reviewers || []).map((reviewer) => <option key={reviewer.email} value={reviewer.email}>{reviewer.name}</option>)}
                      </select>
                      <button className="review-button tone-blue" type="button" disabled={pendingId === row.id || row.reviewWorkflow.status !== 'available'} onClick={() => submitForCoaching(row)}>
                        {row.reviewWorkflow.status === 'submitted' ? `Assigned to ${row.reviewWorkflow.assignedReviewer}` : row.reviewWorkflow.status === 'completed' ? `Reviewed ${row.reviewWorkflow.score ?? 0}%` : 'Submit for coaching'}
                      </button>
                    </div>
                    {row.reviewWorkflow.status === 'available' ? <div className="flex flex-wrap gap-2">{CALL_REVIEW_TAGS.map((tag) => {
                      const selected = (tagsByCall[row.id] || []).includes(tag)
                      return <button key={tag} type="button" onClick={() => setTagsByCall((current) => ({ ...current, [row.id]: selected ? (current[row.id] || []).filter((value) => value !== tag) : [...(current[row.id] || []), tag] }))} className={`review-button ${selected ? 'tone-blue' : ''}`}>{tag}</button>
                    })}</div> : <div className="flex flex-wrap gap-2">{row.reviewWorkflow.tags.map((tag) => <span key={tag} className="source-pill">{tag}</span>)}</div>}
                  </div>

                  <aside className="row-side">
                    <div className="lead-links">
                      {row.leadUrl ? <Link href={row.leadUrl}>Open lead</Link> : <span>No lead linked</span>}
                      <span className="mono">{row.recordingSid}</span>
                    </div>

                    {row.analysisSummary ? (
                      <div className="side-block">
                        <span>AI Summary</span>
                        <p>{row.analysisSummary}</p>
                      </div>
                    ) : null}

                    {row.transcript ? (
                      <details className="transcript-block">
                        <summary>Transcript</summary>
                        <p>{row.transcript}</p>
                      </details>
                    ) : (
                      <div className="side-block muted">
                        <span>Transcript</span>
                        <p>Not available yet.</p>
                      </div>
                    )}
                  </aside>
                </article>
              ))
            )}
          </section>
        </div>
      </main>
    </>
  )
}

const CALL_RECORDINGS_STYLES = `
.call-recordings {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(227,46,46,.16), transparent 34rem),
    linear-gradient(180deg, #050505 0%, #101010 48%, #070707 100%);
  color: #f5f5f5;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
.call-recordings * { box-sizing: border-box; }
.call-recordings button,
.call-recordings input { font-family: var(--font-sans); }
.recording-wrap { max-width: 1500px; margin: 0 auto; padding: 32px clamp(18px,4vw,48px) 80px; }
.recording-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
.recording-header h1 { margin: 8px 0 8px; font-size: clamp(32px,4vw,58px); line-height: .95; letter-spacing: 0; font-weight: 900; }
.recording-header p { margin: 0; color: #a3a3a3; font-size: 15px; line-height: 1.5; }
.back-link { color: #ffb4b4; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-decoration: none; text-transform: uppercase; }
.back-link:hover { color: #fff; }
.refresh-button,
.segmented button,
.review-button { border: 1px solid rgba(255,255,255,.12); color: #f8fafc; background: rgba(255,255,255,.06); border-radius: 10px; cursor: pointer; font-weight: 800; transition: transform .14s ease, border-color .14s ease, background .14s ease; }
.refresh-button { min-height: 38px; padding: 0 16px; }
.refresh-button:hover,
.segmented button:hover,
.review-button:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.24); background: rgba(255,255,255,.1); }
.refresh-button:disabled,
.review-button:disabled { cursor: wait; opacity: .65; transform: none; }
.recording-stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.recording-stat { min-height: 92px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.055); border-radius: 14px; padding: 18px; box-shadow: 0 20px 50px -30px #000; }
.recording-stat span { display: block; color: #a3a3a3; font-size: 11px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
.recording-stat strong { display: block; margin-top: 10px; font-size: 30px; line-height: 1; font-weight: 900; letter-spacing: 0; }
.recording-stat.tone-amber strong { color: #fbbf24; }
.recording-stat.tone-green strong { color: #22c55e; }
.recording-stat.tone-blue strong { color: #60a5fa; }
.recording-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 0 0 18px; }
.segmented { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid rgba(255,255,255,.1); background: rgba(0,0,0,.3); border-radius: 14px; }
.segmented.wide { flex: 1 1 520px; }
.segmented button { min-height: 32px; padding: 0 13px; font-size: 12px; color: #a3a3a3; }
.segmented button.active { color: #fff; border-color: rgba(227,46,46,.65); background: rgba(227,46,46,.18); box-shadow: inset 0 0 0 1px rgba(227,46,46,.12); }
.recording-error { margin-bottom: 14px; border: 1px solid rgba(239,68,68,.36); background: rgba(239,68,68,.12); color: #fecaca; border-radius: 12px; padding: 13px 15px; font-size: 13px; font-weight: 750; }
.recording-list { display: grid; gap: 14px; }
.recording-empty { min-height: 180px; display: grid; place-items: center; border: 1px dashed rgba(255,255,255,.16); border-radius: 16px; color: #a3a3a3; background: rgba(255,255,255,.035); font-weight: 800; }
.recording-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(310px, .42fr); gap: 18px; border: 1px solid rgba(255,255,255,.11); background: rgba(18,18,18,.88); border-radius: 16px; padding: 18px; box-shadow: 0 22px 60px -34px #000; }
.recording-row.outcome-unreviewed { border-color: rgba(251,191,36,.24); }
.row-main { min-width: 0; display: grid; gap: 14px; }
.row-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.row-title h2 { margin: 0 0 6px; font-size: 22px; line-height: 1.1; font-weight: 900; letter-spacing: 0; }
.row-title p { margin: 0; color: #a3a3a3; font-size: 13px; line-height: 1.45; }
.row-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.duration-pill,
.outcome-pill,
.source-pill { display: inline-flex; min-height: 28px; align-items: center; border-radius: 999px; border: 1px solid rgba(255,255,255,.13); padding: 0 10px; font-size: 11px; font-weight: 900; white-space: nowrap; }
.duration-pill { color: #fff; background: rgba(255,255,255,.08); font-variant-numeric: tabular-nums; }
.outcome-pill { color: #cbd5e1; background: rgba(148,163,184,.12); }
.outcome-pill.needs { color: #fde68a; background: rgba(251,191,36,.12); border-color: rgba(251,191,36,.32); }
.source-pill { color: #bfdbfe; background: rgba(59,130,246,.14); border-color: rgba(59,130,246,.32); }
.call-meta { display: flex; flex-wrap: wrap; gap: 8px; color: #a3a3a3; font-size: 12px; }
.call-meta span { min-height: 26px; display: inline-flex; align-items: center; border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.035); border-radius: 999px; padding: 0 9px; }
.recording-row audio { width: 100%; height: 42px; border-radius: 999px; background: #18181b; }
.review-line { display: grid; grid-template-columns: minmax(230px, .42fr) minmax(0, 1fr); gap: 10px; align-items: center; }
.review-line input { width: 100%; min-height: 38px; border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.24); color: #fff; border-radius: 10px; padding: 0 12px; outline: none; font-size: 13px; }
.review-line input:focus { border-color: rgba(227,46,46,.7); box-shadow: 0 0 0 3px rgba(227,46,46,.14); }
.coaching-line { grid-template-columns: minmax(190px, .6fr) minmax(150px, .45fr) minmax(160px, .45fr); }
.coaching-line select { width: 100%; min-height: 38px; border: 1px solid rgba(255,255,255,.12); background: #171717; color: #fff; border-radius: 10px; padding: 0 10px; outline: none; font-size: 12px; font-weight: 800; }
.coaching-line select:focus { border-color: rgba(96,165,250,.7); box-shadow: 0 0 0 3px rgba(96,165,250,.12); }
.review-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.review-button { min-height: 34px; padding: 0 11px; font-size: 12px; }
.review-button.tone-green { color: #bbf7d0; border-color: rgba(34,197,94,.3); background: rgba(34,197,94,.1); }
.review-button.tone-blue { color: #bfdbfe; border-color: rgba(96,165,250,.3); background: rgba(96,165,250,.1); }
.review-button.tone-red { color: #fecaca; border-color: rgba(239,68,68,.32); background: rgba(239,68,68,.1); }
.row-side { min-width: 0; display: grid; align-content: start; gap: 12px; border-left: 1px solid rgba(255,255,255,.08); padding-left: 18px; }
.lead-links { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.lead-links a,
.lead-links span:first-child { color: #fca5a5; font-size: 12px; font-weight: 900; text-decoration: none; }
.lead-links a:hover { color: #fff; }
.mono { color: #737373; font-family: var(--font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side-block,
.transcript-block { border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.035); border-radius: 12px; padding: 12px; }
.side-block span,
.transcript-block summary { color: #e5e5e5; font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.side-block p,
.transcript-block p { margin: 8px 0 0; color: #b8b8b8; font-size: 12.5px; line-height: 1.55; }
.side-block.muted p { color: #737373; }
.transcript-block summary { cursor: pointer; }
@media (max-width: 1100px) {
  .recording-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .recording-row { grid-template-columns: 1fr; }
  .row-side { border-left: 0; border-top: 1px solid rgba(255,255,255,.08); padding: 14px 0 0; }
}
@media (max-width: 720px) {
  .recording-wrap { padding-inline: 14px; }
  .recording-header { display: grid; }
  .recording-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .row-title,
  .review-line { grid-template-columns: 1fr; display: grid; }
  .coaching-line { grid-template-columns: 1fr; }
  .row-badges { justify-content: flex-start; }
  .segmented.wide { overflow-x: auto; flex-wrap: nowrap; }
}
`
