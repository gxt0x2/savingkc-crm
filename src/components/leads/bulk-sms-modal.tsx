'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { BULK_SMS_MAX, type BulkSmsSummary } from '@/lib/bulk-sms'

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

export function BulkSmsModal({ open, onClose, leadIds, agent, fromPhone }: BulkSmsModalProps) {
  const [templates, setTemplates] = useState<SmsTemplate[]>([])
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<BulkSmsSummary | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSummary(null)
    fetch('/api/sms-templates')
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []))
      .catch(() => {})
  }, [open])

  if (!open) return null

  const ids = Array.from(new Set(leadIds))
  const total = ids.length
  const batches = Math.max(1, Math.ceil(total / BULK_SMS_MAX))

  async function send() {
    if (!message.trim() || sending || total === 0) return
    setSending(true)
    setError(null)
    setProgress({ done: 0, total })
    // Send the whole audience in sequential batches of BULK_SMS_MAX — the API
    // rejects more than that per request. Stop on the first hard error (e.g.
    // outside texting hours) but keep whatever already went out.
    let agg: BulkSmsSummary | null = null
    try {
      for (let i = 0; i < total; i += BULK_SMS_MAX) {
        const chunk = ids.slice(i, i + BULK_SMS_MAX)
        const res = await fetch('/api/sms/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds: chunk, body: message.trim(), agent, fromPhone }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Failed to send')
          break
        }
        agg = mergeBulkSummary(agg, data.summary as BulkSmsSummary)
        setProgress({ done: Math.min(i + BULK_SMS_MAX, total), total })
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

              {total > BULK_SMS_MAX && (
                <p className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-[11px] text-[var(--ck-text-muted)]">
                  {total.toLocaleString()} recipients — sends automatically in {batches} batches of up to {BULK_SMS_MAX}. Keep this window open until it finishes.
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
                  disabled={!message.trim() || sending || total === 0}
                  className="flex-[2] inline-flex items-center justify-center gap-2 rounded-lg bg-[#E32E2E] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="send" size="text-sm" />
                  {sending ? (progress ? `Sending… ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}` : 'Sending…') : `Send to ${total.toLocaleString()}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
