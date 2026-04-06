'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

interface QuickReplyInputProps {
  leadId: string
  phone: string
  onSent: () => void
  onCancel: () => void
}

export function QuickReplyInput({ leadId, phone, onSent, onCancel }: QuickReplyInputProps) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    if (!message.trim()) return
    setSending(true)
    setError(null)

    try {
      const res = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          phone,
          body: message.trim(),
          mode: 'sms',
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')

      setMessage('')
      onSent()
    } catch (err: any) {
      setError(err.message || 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="px-5 pb-3">
      <div className="flex gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            if (e.key === 'Escape') onCancel()
          }}
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none h-16 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
          placeholder="Type your reply... (Enter to send)"
          autoFocus
          disabled={sending}
        />
        <div className="flex flex-col gap-1">
          <button
            onClick={handleSend}
            disabled={sending || !message.trim()}
            className={cn(
              'px-3 py-2 rounded-lg text-xs font-bold transition-colors',
              sending || !message.trim()
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-primary text-white hover:bg-primary/90'
            )}
          >
            {sending ? <Icon name="hourglass_empty" className="text-sm animate-spin" /> : 'Send'}
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}
