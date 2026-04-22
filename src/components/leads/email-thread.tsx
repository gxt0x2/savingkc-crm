'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface LeadEmail {
  id: string
  gmail_thread_id: string
  gmail_message_id: string
  subject: string | null
  from_address: string | null
  to_addresses: string[] | null
  cc_addresses: string[] | null
  body_snippet: string | null
  sent_at: string | null
  direction: 'inbound' | 'outbound' | null
  synced_from_user: string | null
}

function formatDate(d: string | null): string {
  if (!d) return ''
  const date = new Date(d)
  const now = new Date()
  const diffHrs = (now.getTime() - date.getTime()) / 3_600_000
  if (diffHrs < 24) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  if (diffHrs < 24 * 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function EmailThread({ leadId }: { leadId: string }) {
  const [emails, setEmails] = useState<LeadEmail[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch(`/api/leads/${leadId}/emails`)
      .then(r => r.json())
      .then(d => { if (alive) setEmails(d.emails || []) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [leadId])

  if (loading) {
    return (
      <div className="ck-card p-4">
        <p className="text-sm text-[var(--ck-text-muted)]">Loading emails…</p>
      </div>
    )
  }

  if (emails.length === 0) {
    return (
      <div className="ck-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon name="mail" size="text-lg" className="text-[var(--ck-text-muted)]" />
          <h3 className="text-sm font-bold text-[var(--ck-text)]">Email Thread</h3>
        </div>
        <p className="text-xs text-[var(--ck-text-muted)]">No emails synced yet. Connect Gmail in Settings to enable two-way sync.</p>
      </div>
    )
  }

  return (
    <div className="ck-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ck-border)]">
        <div className="flex items-center gap-2">
          <Icon name="mail" size="text-lg" className="text-[var(--ck-accent)]" />
          <h3 className="text-sm font-bold text-[var(--ck-text)]">Email Thread</h3>
          <span className="text-[11px] text-[var(--ck-text-muted)] font-medium">{emails.length}</span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[var(--ck-text-dim)]">Gmail Sync</span>
      </div>

      <div className="divide-y divide-[var(--ck-border)]">
        {emails.map(e => (
          <div key={e.id} className="px-4 py-3 hover:bg-white/5 transition-colors">
            <div className="flex items-start gap-3">
              {/* Direction indicator */}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                e.direction === 'outbound'
                  ? 'bg-[#E32E2E]/10 text-[#E32E2E]'
                  : 'bg-emerald-500/10 text-emerald-500'
              }`}>
                <Icon
                  name={e.direction === 'outbound' ? 'arrow_upward' : 'arrow_downward'}
                  size="text-sm"
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-[13px] font-semibold text-[var(--ck-text)] truncate">
                    {e.subject || '(no subject)'}
                  </p>
                  <span className="text-[11px] text-[var(--ck-text-dim)] flex-shrink-0">
                    {formatDate(e.sent_at)}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--ck-text-muted)] mb-1">
                  <span className="font-medium">{e.direction === 'outbound' ? 'To' : 'From'}:</span>{' '}
                  {e.direction === 'outbound'
                    ? e.to_addresses?.join(', ')
                    : e.from_address}
                </p>
                {e.body_snippet && (
                  <p className="text-[12px] text-[var(--ck-text-dim)] line-clamp-2">
                    {e.body_snippet}
                  </p>
                )}
                <a
                  href={`https://mail.google.com/mail/u/0/#inbox/${e.gmail_thread_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-[var(--ck-accent)] hover:underline mt-1 inline-block"
                >
                  Open in Gmail →
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
