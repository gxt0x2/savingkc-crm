'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { CONVERSATION_TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { formatPhone, toProperCase } from '@/lib/format'

interface SmsActivity {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface SmsThreadPanelProps {
  leadId: string
  leadName?: string | null
  phone?: string | null
  propertyAddress?: string | null
  activities: SmsActivity[]
  defaultFromPhone?: string | null
  agent?: string
  onRefresh?: () => void
}

const SMS_TYPES = new Set(['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound'])
const DEFAULT_FROM_PHONE = CONVERSATION_TWILIO_NUMBERS[0]?.value || '+18163077835'

function isSmsActivity(activity: Pick<SmsActivity, 'activity_type'>): boolean {
  return SMS_TYPES.has(activity.activity_type)
}

function metadata(activity: SmsActivity): Record<string, unknown> {
  return activity.metadata || {}
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function smsDirection(activity: SmsActivity): 'inbound' | 'outbound' {
  const direction = textValue(metadata(activity).direction)?.toLowerCase()
  if (direction === 'inbound' || direction === 'received' || direction === 'in') return 'inbound'
  if (activity.activity_type === 'sms_received' || activity.activity_type === 'sms_inbound') return 'inbound'
  return 'outbound'
}

function smsBody(activity: SmsActivity): string {
  const md = metadata(activity)
  return textValue(md.body) || textValue(md.message) || activity.description || ''
}

function smsPeerPhone(activity: SmsActivity, fallback?: string | null): string | null {
  const md = metadata(activity)
  if (smsDirection(activity) === 'inbound') return textValue(md.from) || fallback || null
  return textValue(md.to) || fallback || null
}

function smsSystemPhone(activity: SmsActivity, fallback?: string | null): string | null {
  const md = metadata(activity)
  if (smsDirection(activity) === 'inbound') return textValue(md.to) || fallback || null
  return textValue(md.from) || fallback || null
}

function timeLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function SmsThreadPanel({
  leadId,
  leadName,
  phone,
  propertyAddress,
  activities,
  defaultFromPhone,
  agent = 'Ernest',
  onRefresh,
}: SmsThreadPanelProps) {
  const [message, setMessage] = useState('')
  const [fromPhone, setFromPhone] = useState(defaultFromPhone || DEFAULT_FROM_PHONE)
  const [fromPhoneTouched, setFromPhoneTouched] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const thread = useMemo(() => {
    return activities
      .filter(isSmsActivity)
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }, [activities])

  const lastInbound = useMemo(() => {
    return thread.slice().reverse().find((activity) => smsDirection(activity) === 'inbound') || null
  }, [thread])

  const latestMessage = thread[thread.length - 1] || null
  const recipientPhone = phone || (latestMessage ? smsPeerPhone(latestMessage) : null)
  const replyFromPhone = lastInbound
    ? smsSystemPhone(lastInbound, defaultFromPhone || DEFAULT_FROM_PHONE)
    : defaultFromPhone || DEFAULT_FROM_PHONE

  const fromOptions = useMemo(() => {
    const numbers: Array<{ label: string; value: string }> = CONVERSATION_TWILIO_NUMBERS.map((number) => ({
      label: number.label,
      value: number.value,
    }))
    if (replyFromPhone && !numbers.some((number) => number.value === replyFromPhone)) {
      numbers.unshift({
        label: `${formatPhone(replyFromPhone) || replyFromPhone} - last inbound line`,
        value: replyFromPhone,
      })
    }
    return numbers
  }, [replyFromPhone])

  useEffect(() => {
    setMessage('')
    setError(null)
    setSent(false)
    setFromPhoneTouched(false)
  }, [leadId])

  useEffect(() => {
    if (!fromPhoneTouched && replyFromPhone) setFromPhone(replyFromPhone)
  }, [fromPhoneTouched, replyFromPhone])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [leadId, thread.length])

  useEffect(() => {
    if (!onRefresh) return
    const supabase = createClient()
    const channel = supabase
      .channel(`dialer-sms-thread-${leadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'lead_activities', filter: `lead_id=eq.${leadId}` },
        (payload: { new?: { activity_type?: string } }) => {
          if (payload.new?.activity_type && SMS_TYPES.has(payload.new.activity_type)) onRefresh()
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [leadId, onRefresh])

  async function handleSend() {
    const body = message.trim()
    if (!body || sending) return
    if (!recipientPhone) {
      setError('No seller phone number is attached to this lead.')
      return
    }

    setSending(true)
    setError(null)
    setSent(false)

    try {
      const response = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          phone: recipientPhone,
          body,
          mode: 'sms',
          fromPhone,
          agent,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'SMS send failed')

      setMessage('')
      setSent(true)
      window.setTimeout(() => setSent(false), 1800)
      onRefresh?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SMS send failed')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSend()
    }
  }

  const displayName = toProperCase(leadName) || 'Seller'
  const lastInboundLabel = lastInbound ? timeLabel(lastInbound.created_at) : 'No inbound texts'

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-[var(--ck-text)]">Text Hub</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--ck-text-muted)]">
            {displayName}
            {recipientPhone ? ` - ${formatPhone(recipientPhone)}` : ''}
            {propertyAddress ? ` - ${propertyAddress}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-black leading-none text-[var(--ck-text)] tabular-nums">{thread.length}</p>
          <p className="mt-0.5 text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">Texts</p>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="h-[340px] overflow-y-auto rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3"
      >
        {thread.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="text-xs text-[var(--ck-text-dim)]">No text history yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {thread.map((activity) => {
              const inbound = smsDirection(activity) === 'inbound'
              const peer = smsPeerPhone(activity, recipientPhone)
              const system = smsSystemPhone(activity, fromPhone)
              return (
                <div key={activity.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[86%] ${inbound ? 'text-left' : 'text-right'}`}>
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-sm leading-snug shadow-sm ${
                        inbound
                          ? 'rounded-bl-md bg-[var(--ck-surface)] text-[var(--ck-text)] border border-[var(--ck-border)]'
                          : 'rounded-br-md bg-[#E32E2E] text-white'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{smsBody(activity) || '[empty message]'}</p>
                    </div>
                    <p className="mt-1 px-1 text-[10px] text-[var(--ck-text-dim)]">
                      {inbound ? 'Seller' : activity.agent || agent} - {timeLabel(activity.created_at)}
                      {peer ? ` - ${formatPhone(peer)}` : ''}
                      {system ? ` via ${formatPhone(system)}` : ''}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ck-border)] px-3 py-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">From</span>
          <select
            value={fromPhone}
            onChange={(event) => {
              setFromPhone(event.target.value)
              setFromPhoneTouched(true)
            }}
            className="max-w-full flex-1 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-2 py-1.5 text-xs font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E] sm:min-w-[190px]"
          >
            {fromOptions.map((number) => (
              <option key={number.value} value={number.value}>{number.label}</option>
            ))}
          </select>
          <span className="ml-auto text-[10px] text-[var(--ck-text-dim)]">{lastInboundLabel}</span>
        </div>

        <div className="flex items-end gap-2 p-3">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder={recipientPhone ? 'Type a text...' : 'No phone number'}
            disabled={sending || !recipientPhone}
            className="min-h-[84px] flex-1 resize-none rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-2.5 text-sm text-[var(--ck-text)] placeholder:text-[var(--ck-text-dim)] outline-none focus:border-[#E32E2E] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !message.trim() || !recipientPhone}
            className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E32E2E] text-white transition-colors hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-35"
            title="Send text"
            aria-label="Send text"
          >
            {sending ? (
              <Icon name="progress_activity" size="text-lg" className="animate-spin" />
            ) : sent ? (
              <Icon name="check" size="text-lg" />
            ) : (
              <Icon name="send" size="text-lg" />
            )}
          </button>
        </div>
        {error && <p className="border-t border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[#ff7777]">{error}</p>}
      </div>
    </div>
  )
}
