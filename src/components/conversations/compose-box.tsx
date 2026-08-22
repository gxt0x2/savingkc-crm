'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import { MessageTemplatePicker } from './message-template-picker'
import type { MessageTemplate } from '@/lib/conversations/message-template'
import { CONVERSATION_TWILIO_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { formatPhone } from '@/lib/format'

type ComposeMode = 'sms' | 'email' | 'note'

const DEFAULT_CONVERSATION_PHONE = '+18163077835'

const modes: { key: ComposeMode; label: string; icon: string }[] = [
  { key: 'sms', label: 'SMS', icon: 'sms' },
  { key: 'email', label: 'Email', icon: 'mail' },
  { key: 'note', label: 'Internal note', icon: 'edit_note' },
]

interface ComposeBoxProps {
  leadId?: string
  phone?: string
  email?: string
  onSent?: () => void
  replyFromPhone?: string // Auto-select the Twilio number the lead last texted
  draftMessage?: string
  initialMode?: ComposeMode
  fullName?: string | null
  propertyAddress?: string | null
}

export function ComposeBox({ leadId, phone, email, onSent, replyFromPhone, draftMessage, initialMode = 'sms', fullName, propertyAddress }: ComposeBoxProps) {
  const senderThreadKey = `${leadId || 'unmatched'}:${phone || 'no-phone'}:${replyFromPhone || 'new'}`
  const [activeMode, setActiveMode] = useState<ComposeMode>(draftMessage ? 'sms' : initialMode)
  const [message, setMessage] = useState(draftMessage || '')
  const [subject, setSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deliveryWarning, setDeliveryWarning] = useState<string | null>(null)
  const [senderSelection, setSenderSelection] = useState({
    threadKey: senderThreadKey,
    value: replyFromPhone || DEFAULT_CONVERSATION_PHONE,
  })
  const fromPhone = senderSelection.threadKey === senderThreadKey
    ? senderSelection.value
    : replyFromPhone || DEFAULT_CONVERSATION_PHONE
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [templateActorName, setTemplateActorName] = useState<string | null>(null)
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setTemplatesLoading(true)
    fetch('/api/sms-templates', { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { templates?: MessageTemplate[]; actorName?: string | null; error?: string }
        if (!response.ok) throw new Error(data.error || 'Quick replies could not be loaded.')
        setTemplates(Array.isArray(data.templates) ? data.templates : [])
        setTemplateActorName(typeof data.actorName === 'string' ? data.actorName : null)
      })
      .catch((caught) => { if (!controller.signal.aborted) setTemplatesError(caught instanceof Error ? caught.message : 'Quick replies could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setTemplatesLoading(false) })
    return () => controller.abort()
  }, [])

  async function handleSend() {
    if (!message.trim()) return
    if (activeMode === 'sms' && !phone) { setError('No phone number for this contact'); return }
    if (activeMode === 'email' && !email) { setError('No email address for this contact'); return }
    if (activeMode === 'note' && (!leadId || leadId.startsWith('unmatched:'))) { setError('Create or link this contact before adding an internal note.'); return }

    setSending(true)
    setError(null)
    setDeliveryWarning(null)

    try {
      const isInternalNote = activeMode === 'note'
      const res = await fetch(
        isInternalNote ? `/api/leads/${leadId}/activities` : '/api/conversations/send',
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isInternalNote ? {
          description: message.trim(),
        } : {
          leadId: leadId?.startsWith('unmatched:') ? null : leadId,
          phone,
          to: activeMode === 'email' ? email : undefined,
          subject: activeMode === 'email' ? subject.trim() || 'Message from Saving KC' : undefined,
          body: message.trim(),
          mode: activeMode,
          // Existing-thread replies are resolved from SMS history on the
          // server. Only new outreach carries an explicit manual selection.
          fromPhone: activeMode === 'sms' && !replyFromPhone ? fromPhone : undefined,
          resolveSenderFromConversation: activeMode === 'sms' && Boolean(replyFromPhone),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')

      if (data.deliveryState === 'delivered_not_persisted') {
        setDeliveryWarning(data.warning || 'Message delivered, but CRM history could not be saved. Do not resend it.')
      }

      setMessage('')
      setSubject('')
      onSent?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  function modeUnavailable(mode: ComposeMode) {
    if (mode === 'sms') return !phone
    if (mode === 'email') return !email
    return !leadId || leadId.startsWith('unmatched:')
  }

  return (
    <div className="sticky bottom-0 z-10 flex-shrink-0 border-t border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 md:p-4">
      <div className="overflow-hidden rounded-xl border border-[var(--crm-border-strong)] bg-[var(--crm-surface)]">
        {/* Toggle Tabs */}
        <div className="flex border-b border-outline-variant/5">
          {modes.map((mode) => (
            <button
              key={mode.key}
              type="button"
              onClick={() => { setActiveMode(mode.key); setShowTemplates(false) }}
              disabled={modeUnavailable(mode.key)}
              aria-pressed={activeMode === mode.key}
              className={cn(
                'flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40 md:px-5',
                activeMode === mode.key
                  ? 'border-[var(--crm-brand)] text-[var(--crm-brand)]'
                  : 'border-transparent text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'
              )}
            >
              <Icon name={mode.icon} className="text-sm" />
              {mode.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div role="alert" className="px-6 pt-3 text-xs text-red-500 font-medium">{error}</div>
        )}
        {deliveryWarning && (
          <div role="status" className="px-6 pt-3 text-xs font-semibold text-[var(--crm-warning)]">
            {deliveryWarning}
          </div>
        )}

        {/* From number (SMS only) — auto-detected from conversation, manual only for new outreach */}
        {activeMode === 'sms' && (
          <div className="px-6 pt-3 flex items-center gap-2">
            <span className="text-xs text-on-surface-variant/60 font-medium">From:</span>
            {replyFromPhone ? (
              <span className="rounded-lg bg-[var(--crm-surface-subtle)] px-2 py-1 text-xs font-medium text-[var(--crm-text)]">
                {TWILIO_NUMBERS.find(n => n.value === replyFromPhone)?.label || formatPhone(replyFromPhone)}
              </span>
            ) : (
              <select
                aria-label="Sending phone number"
                value={fromPhone}
                onChange={(e) => setSenderSelection({ threadKey: senderThreadKey, value: e.target.value })}
                className="crm-field rounded-lg px-2 py-1 text-xs"
              >
                {TWILIO_NUMBERS.map((n) => (
                  <option key={n.value} value={n.value}>{n.label}</option>
                ))}
              </select>
            )}
          </div>
        )}
        {activeMode === 'email' ? (
          <div className="border-t border-[#eef1f4] px-5 py-2">
            <input aria-label="Email subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Email subject" className="h-8 w-full border-0 bg-transparent text-xs font-semibold text-[var(--crm-text)] outline-none placeholder:text-[var(--crm-text-dim)]" />
          </div>
        ) : null}

        {/* Input Area */}
        <div className="flex items-end gap-3 p-3">
          <div className="relative flex-1">
            <textarea
              aria-label={activeMode === 'note' ? 'Internal note' : activeMode === 'email' ? 'Email message' : 'Text message'}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-14 w-full resize-none border-none bg-transparent p-2 text-sm text-[var(--crm-text)] focus:outline-none focus:ring-0"
              placeholder={
                activeMode === 'sms'
                  ? 'Type your message... (Enter to send)'
                  : activeMode === 'email'
                    ? 'Compose email...'
                  : 'Add an internal note...'
              }
              spellCheck={false}
              disabled={sending}
            />
            <div className="flex gap-2 p-2">
              <button type="button" onClick={() => setMessage((value) => `${value}${value ? ' ' : ''}🙂`)} aria-label="Add emoji" title="Add emoji" className="p-1.5 hover:bg-surface-container rounded-lg transition-all">
                <Icon name="mood" className="text-on-surface-variant text-lg" />
              </button>
              <button
                type="button"
                onClick={() => setShowTemplates(!showTemplates)}
                disabled={activeMode !== 'sms'}
                aria-expanded={showTemplates}
                aria-label="Open message templates"
                className="relative rounded-lg p-1.5 transition-all hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-35"
                title={activeMode === 'sms' ? 'Quick replies' : 'Quick replies are available for SMS'}
              >
                <Icon name="bolt" className="text-on-surface-variant text-lg" />
              </button>
            </div>
            {showTemplates ? <MessageTemplatePicker templates={templates} loading={templatesLoading} error={templatesError} context={{ fullName, propertyAddress, agentName: templateActorName }} onSelect={(body) => { setMessage(body); setShowTemplates(false) }} onClose={() => setShowTemplates(false)} /> : null}
          </div>
          <button
            type="button"
            onClick={handleSend}
            aria-label={activeMode === 'note' ? 'Add internal note' : activeMode === 'email' ? 'Send email' : 'Send text message'}
            disabled={sending || !message.trim()}
            className={cn(
              'mb-2 flex h-10 w-16 items-center justify-center rounded-md text-sm font-bold transition-all',
              sending || !message.trim()
                ? 'cursor-not-allowed bg-[var(--crm-surface-subtle)] text-[var(--crm-text-disabled)]'
                : 'crm-primary-button'
            )}
          >
            {sending
              ? <Icon name="hourglass_empty" className="text-sm animate-spin" />
              : <Icon name="send" />
            }
          </button>
        </div>
      </div>
    </div>
  )
}
