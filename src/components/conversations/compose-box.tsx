'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'

type ComposeMode = 'sms' | 'email' | 'call'

const modes: { key: ComposeMode; label: string; icon: string }[] = [
  { key: 'sms', label: 'SMS', icon: 'sms' },
  { key: 'email', label: 'Email', icon: 'mail' },
  { key: 'call', label: 'Call', icon: 'call' },
]

export function ComposeBox() {
  const [activeMode, setActiveMode] = useState<ComposeMode>('sms')

  return (
    <div className="p-8 pt-0 relative z-10 flex-shrink-0">
      <div className="bg-white rounded-3xl shadow-[0px_8px_32px_rgba(0,0,0,0.08)] border border-outline-variant/10 overflow-hidden">
        {/* Toggle Tabs */}
        <div className="flex border-b border-outline-variant/5">
          {modes.map((mode) => (
            <button
              key={mode.key}
              onClick={() => setActiveMode(mode.key)}
              className={cn(
                'px-8 py-4 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all',
                activeMode === mode.key
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-on-surface-variant/40 hover:text-on-surface-variant'
              )}
            >
              <Icon name={mode.icon} className="text-sm" />
              {mode.label}
            </button>
          ))}
        </div>

        {/* Input Area */}
        <div className="p-4 flex items-end gap-4">
          <div className="flex-1">
            <textarea
              className="w-full border-none focus:ring-0 text-sm p-2 resize-none h-20 bg-transparent focus:outline-none"
              placeholder={
                activeMode === 'sms'
                  ? 'Type your message...'
                  : activeMode === 'email'
                    ? 'Compose email...'
                    : 'Add call notes...'
              }
              spellCheck={false}
            />
            <div className="flex gap-2 p-2">
              <button className="p-1.5 hover:bg-surface-container rounded-lg transition-all">
                <Icon name="mood" className="text-on-surface-variant text-lg" />
              </button>
              <button className="p-1.5 hover:bg-surface-container rounded-lg transition-all">
                <Icon name="attach_file" className="text-on-surface-variant text-lg" />
              </button>
              <button className="p-1.5 hover:bg-surface-container rounded-lg transition-all">
                <Icon name="bolt" className="text-on-surface-variant text-lg" />
              </button>
            </div>
          </div>
          <button className="bg-primary text-on-primary w-12 h-12 rounded-2xl flex items-center justify-center hover:scale-[1.02] active:scale-95 transition-all shadow-lg mb-2">
            <Icon name="send" />
          </button>
        </div>
      </div>
    </div>
  )
}
