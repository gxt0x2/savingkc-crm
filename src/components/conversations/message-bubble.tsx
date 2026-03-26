'use client'

import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'

export type MessageType = 'sms' | 'email' | 'call'
export type MessageDirection = 'sent' | 'received'

export interface Message {
  id: string
  type: MessageType
  direction: MessageDirection
  content: string
  timestamp: string
  senderInitials: string
  // email-specific
  subject?: string
  emailMeta?: string
  // call-specific
  callDuration?: string
}

function SmsBubble({ message }: { message: Message }) {
  const isSent = message.direction === 'sent'

  return (
    <div className={cn('flex', isSent ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex gap-3 max-w-[70%]', isSent && 'justify-end')}>
        {!isSent && (
          <div className="w-8 h-8 rounded-full bg-slate-300 text-slate-800 flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-1">
            {message.senderInitials}
          </div>
        )}
        <div className="flex-1">
          <div
            className={cn(
              'rounded-2xl p-4 text-sm leading-snug shadow-sm',
              isSent
                ? 'bg-primary text-on-primary rounded-tr-none shadow-md'
                : 'bg-surface-container-high text-on-surface rounded-tl-none'
            )}
          >
            {message.content}
          </div>
          <span
            className={cn(
              'text-[10px] text-on-surface-variant/50 mt-1 block px-1',
              isSent && 'text-right'
            )}
          >
            {isSent ? 'Sent' : 'Received'} &bull; {message.timestamp}
          </span>
        </div>
        {isSent && (
          <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-1">
            ED
          </div>
        )}
      </div>
    </div>
  )
}

function EmailCard({ message }: { message: Message }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-2xl w-full bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center">
              <Icon name="mail" className="text-white text-sm" />
            </div>
            <div>
              <h4 className="text-sm font-bold">{message.subject}</h4>
              <p className="text-[10px] text-on-surface-variant/60">
                {message.emailMeta || `Sent via Outbound Sales Server`} &bull; {message.timestamp}
              </p>
            </div>
          </div>
          <Icon name="expand_more" className="text-on-surface-variant/40" />
        </div>
        <div className="text-sm text-on-surface-variant leading-relaxed">
          {message.content}
        </div>
      </div>
    </div>
  )
}

function CallPill({ message }: { message: Message }) {
  const isSent = message.direction === 'sent'

  return (
    <div className="flex justify-center">
      <div className="bg-primary-container text-on-primary rounded-full px-6 py-3 flex items-center gap-4 shadow-lg">
        <Icon
          name={isSent ? 'call_made' : 'call_received'}
          className="text-secondary-fixed"
        />
        <div className="text-xs">
          <span className="font-bold">
            {isSent ? 'Outgoing' : 'Incoming'} call ({message.callDuration})
          </span>
          <span className="opacity-50 mx-2">|</span>
          <span>{message.timestamp}</span>
        </div>
        <button className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
          <Icon name="play_arrow" className="text-white text-sm" filled />
        </button>
      </div>
    </div>
  )
}

export function MessageBubble({ message }: { message: Message }) {
  switch (message.type) {
    case 'email':
      return <EmailCard message={message} />
    case 'call':
      return <CallPill message={message} />
    default:
      return <SmsBubble message={message} />
  }
}
