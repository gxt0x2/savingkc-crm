'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { BULK_SMS_MAX, type BulkSmsSummary } from '@/lib/bulk-sms'
import {
  SMS_HARD_PER_HOUR,
  SMS_HARD_PER_DAY,
  SMS_DEFAULT_PER_HOUR,
  SMS_DEFAULT_PER_DAY,
  SMS_PACE_PRESETS,
  clampPerHour,
  clampPerDay,
  type SmsBudget,
} from '@/lib/sms-rate-limit'

interface SmsTemplate {
  id: string
  name: string
  category: string
  body: string
}

interface BulkSmsModalProps {
  open: boolean
  onClose: () => void
  leadIds: string[]
  agent?: string
  fromPhone?: string
}

/** Combine per-batch summaries into one running total for the whole audience. */
function mergeBulkSummary(a: BulkSmsSummary | null, b: BulkSmsSummary): BulkSmsSummary {
  if (!a) return b
  return {
    total: a.total + b.total,
    sent: a.sent + b.sent,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
    breakdown: {
      opted_out: a.breakdown.opted_out + b.breakdown.opted_out,
      duplicate: a.breakdown.duplicate + b.breakdown.duplicate,
      no_phone: a.breakdown.no_phone + b.breakdown.no_phone,
      not_found: a.breakdown.not_found + b.breakdown.not_found,
    },
  }
}

/** Format an ISO instant as a Central-time clock label, e.g. "4:05 PM". */
function fmtTime(iso?: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
  } catch {
    return ''
  }
}

export function BulkSmsModal({ open, onClose, leadIds, agent, fromPhone }: BulkSmsModalProps) {
  const [templates, setTemplates] = useState<SmsTemplate[]>([])
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<BulkSmsSummary | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [perHour, setPerHour] = useState(SMS_DEFAULT_PER_HOUR)
  const [perDay, setPerDay] = useState(SMS_DEFAULT_PER_DAY)
  const [budget, setBudget] = useState<SmsBudget | null>(null)
  const [deferred, setDeferred] = useState(0)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSummary(null)
    setDeferred(0)
    // Restore the operator's last-used pace.
    try {
      const saved = JSON.parse(localStorage.getItem('sms_pace') || 'null')
      if (saved && typeof saved === 'object') {
        setPerHour(clampPerHour(saved.perHour))
        setPerDay(clampPerDay(saved.perDay))
      }
    } catch {
      /* ignore */
    }
    fetch('/api/sms-templates')
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []))
      .catch(() => {})
    // Current account-wide usage (counts are pace-independent; remaining is
    // computed client-side from the chosen pace).
    fetch('/api/sms/bulk')
      .then((r) => r.json())
      .then((d) => { if (d?.budget) setBudget(d.budget as SmsBudget) })
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) return
    try {
      localStorage.setItem('sms_pace', JSON.stringify({ perHour, perDay }))
    } catch {
      /* ignore */
    }
  }, [open, perHour, perDay])

  if (!open) return null

  const ids = Array.from(new Set(leadIds))
  const total = ids.length

  const usedHour = budget?.usedHour ?? 0
  const usedDay = budget?.usedDay ?? 0
  const remHour = Math.max(0, perHour - usedHour)
  const remDay = Math.max(0, perDay - usedDay)
  const allowedNow = Math.min(remHour, remDay)
  const capReached = budget !== null && allowedNow === 0

  async function send() {
    if (!message.trim() || sending || total === 0) return
    setSending(true)
    setError(null)
    setDeferred(0)
    setProgress({ done: 0, total })
    // Send the whole audience in sequential batches of BULK_SMS_MAX. The server
    // re-checks the account-wide rate budget on every request and caps each
    // batch to what's left, so it can never push the numbers over the limit.
    let agg: BulkSmsSummary | null = null
    let dispatched = 0
    try {
      for (let i = 0; i < total; i += BULK_SMS_MAX) {
        const chunk = ids.slice(i, i + BULK_SMS_MAX)
        const res = await fetch('/api/sms/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds: chunk, body: message.trim(), agent, fromPhone, perHour, perDay }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Failed to send')
          break
        }
        if (data.budget) setBudget(data.budget as SmsBudget)
        if (data.summary) {
          agg = mergeBulkSummary(agg, data.summary as BulkSmsSummary)
          dispatched += (data.summary as BulkSmsSummary).total
        }
        setProgress({ done: Math.min(dispatched, total), total })
        if (data.rateLimited) {
          // Server hit the cap — the rest waits for the window to free up.
          setDeferred(Math.max(0, total - dispatched))
          break
        }
      }
      if (agg) setSummary(agg)
    } catch {
      setError('Network error — could not send.')
      if (agg) setSummary(agg)
    } finally {
      setSending(false)
      setProgress(null)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="ck-card w-full max-w-lg flex flex-col" style={{ maxHeight: '85vh' }}>
          <div className="flex items-center justify-between border-b border-[var(--ck-border)] px-5 py-4">
            <div className="flex items-center gap-2">
              <Icon name="forum" size="text-lg" className="text-[#ff7777]" />
              <h2 className="text-sm font-black uppercase tracking-wider text-[var(--ck-text)]">
                Text {total.toLocaleString()} {total === 1 ? 'lead' : 'leads'}
              </h2>
            </div>
            <button onClick={onClose} className="text-[var(--ck-text-dim)] hover:text-[var(--ck-text)]"><Icon name="close" size="text-lg" /></button>
          </div>

          {summary ? (
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <Icon name="check_circle" size="text-xl" />
                <p className="text-sm font-bold">{summary.sent.toLocaleString()} message{summary.sent === 1 ? '' : 's'} sent</p>
              </div>
              <ul className="space-y-1 text-xs text-[var(--ck-text-muted)]">
                {summary.breakdown.opted_out > 0 && <li>· {summary.breakdown.opted_out} skipped — opted out</li>}
                {summary.breakdown.duplicate > 0 && <li>· {summary.breakdown.duplicate} skipped — texted within 24h</li>}
                {summary.breakdown.no_phone > 0 && <li>· {summary.breakdown.no_phone} skipped — no phone number</li>}
                {summary.breakdown.not_found > 0 && <li>· {summary.breakdown.not_found} skipped — lead not found</li>}
                {summary.failed > 0 && <li className="text-[#ff7777]">· {summary.failed} failed to send</li>}
              </ul>
              {deferred > 0 && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                  {deferred.toLocaleString()} not sent — sending cap reached.{' '}
                  {budget?.hourResetsAt ? `Hourly budget frees ~${fmtTime(budget.hourResetsAt)} CT.` : `Daily cap resets ${fmtTime(budget?.dayResetsAt)} CT.`}{' '}
                  Re-open to continue once it frees up.
                </p>
              )}
              <p className="text-[11px] text-[var(--ck-text-dim)]">Each message is logged to the recipient&apos;s Communication Hub.</p>
              {error && <p className="text-xs font-bold text-[#ff7777]">Stopped early — {error}</p>}
              <button onClick={onClose} className="w-full rounded-lg bg-[#E32E2E] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-[#C42626]">Done</button>
            </div>
          ) : (
            <div className="p-5 space-y-4 overflow-auto">
              {templates.length > 0 && (
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Template</span>
                  <select
                    onChange={(e) => { const t = templates.find((x) => x.name === e.target.value); if (t) setMessage(t.body) }}
                    defaultValue=""
                    className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                  >
                    <option value="">Start from a template…</option>
                    {templates.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </label>
              )}

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Message</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder="Hi {firstName}, this is Saving KC about {propertyAddress}…"
                  className="mt-2 w-full resize-none rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                />
                <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--ck-text-dim)]">
                  <span>Merge: <code>{'{firstName}'}</code> <code>{'{propertyAddress}'}</code></span>
                  <span>{message.length} chars</span>
                </div>
              </label>

              {/* Sending pace — operator-adjustable, clamped to the hard cap. */}
              <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Sending pace</span>
                  <span className={`text-[11px] font-semibold ${capReached ? 'text-amber-300' : 'text-[var(--ck-text-muted)]'}`}>
                    {remHour.toLocaleString()}/{perHour.toLocaleString()} left this hr · {remDay.toLocaleString()}/{perDay.toLocaleString()} today
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {SMS_PACE_PRESETS.map((p) => {
                    const active = perHour === p.perHour && perDay === p.perDay
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setPerHour(p.perHour); setPerDay(p.perDay) }}
                        className={`rounded-lg px-2 py-1.5 text-[11px] font-bold transition-colors ${active ? 'bg-white text-black' : 'border border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'}`}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Per hour · max {SMS_HARD_PER_HOUR}</span>
                    <input
                      type="number"
                      min={1}
                      max={SMS_HARD_PER_HOUR}
                      value={perHour}
                      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) setPerHour(Math.min(SMS_HARD_PER_HOUR, Math.floor(v))) }}
                      className="mt-1 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--ck-text-dim)]">Per day · max {SMS_HARD_PER_DAY}</span>
                    <input
                      type="number"
                      min={1}
                      max={SMS_HARD_PER_DAY}
                      value={perDay}
                      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) setPerDay(Math.min(SMS_HARD_PER_DAY, Math.floor(v))) }}
                      className="mt-1 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                    />
                  </label>
                </div>
                <p className="text-[10px] text-[var(--ck-text-dim)]">
                  Hard cap {SMS_HARD_PER_HOUR}/hr · {SMS_HARD_PER_DAY}/day, enforced account-wide — protects the sending numbers and can&apos;t be exceeded.
                </p>
              </div>

              {total > 0 && (
                <p className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${capReached ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)]'}`}>
                  {capReached
                    ? `Sending cap reached. ${budget?.hourResetsAt ? `Frees ~${fmtTime(budget.hourResetsAt)} CT.` : `Resets ${fmtTime(budget?.dayResetsAt)} CT.`}`
                    : allowedNow >= total
                      ? `Sends in ${Math.max(1, Math.ceil(total / BULK_SMS_MAX))} batch${Math.ceil(total / BULK_SMS_MAX) === 1 ? '' : 'es'} of up to ${BULK_SMS_MAX}. Keep this window open until it finishes.`
                      : `Cap allows ${allowedNow.toLocaleString()} now; the other ${(total - allowedNow).toLocaleString()} will wait for the budget to free up.`}
                </p>
              )}

              <p className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-[11px] text-[var(--ck-text-muted)] leading-relaxed">
                Opt-outs and numbers texted in the last 24h are skipped automatically. Texting hours: Mon–Sat, 9am–7pm CT.
              </p>

              {error && <p className="text-xs font-bold text-[#ff7777]">{error}</p>}

              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 rounded-lg border border-[var(--ck-border)] px-4 py-2.5 text-xs font-bold text-[var(--ck-text-muted)] hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]">Cancel</button>
                <button
                  onClick={send}
                  disabled={!message.trim() || sending || total === 0 || capReached}
                  className="flex-[2] inline-flex items-center justify-center gap-2 rounded-lg bg-[#E32E2E] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="send" size="text-sm" />
                  {sending
                    ? (progress ? `Sending… ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}` : 'Sending…')
                    : capReached ? 'Cap reached' : `Send to ${Math.min(total, allowedNow || total).toLocaleString()}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
