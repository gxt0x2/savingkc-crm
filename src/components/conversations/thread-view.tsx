'use client'

import { useRef, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { MessageBubble, type Message } from './message-bubble'
import { ComposeBox } from './compose-box'

interface ThreadContact {
  name: string
  initials: string
  address: string
  county: string
  tags: string[]
  verified?: boolean
}

interface DateGroup {
  label: string
  messages: Message[]
}

export function ThreadView({
  contact,
  dateGroups,
}: {
  contact: ThreadContact
  dateGroups: DateGroup[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [dateGroups])

  return (
    <section className="flex-1 flex flex-col bg-surface min-w-0">
      {/* Thread Header */}
      <header className="bg-surface-container-low px-8 py-6 flex justify-between items-center flex-shrink-0">
        <div className="flex gap-6 items-center">
          <div className="w-14 h-14 rounded-full bg-slate-900 flex items-center justify-center text-white text-xl font-black">
            {contact.initials}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black text-primary tracking-tight">
                {contact.name}
              </h2>
              {contact.verified && (
                <Icon name="verified" className="text-secondary text-lg" filled />
              )}
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-sm font-medium text-on-surface-variant">
                {contact.address}
              </span>
              <span className="text-xs text-on-surface-variant/40">&bull;</span>
              <span className="text-sm font-medium text-on-surface-variant">
                {contact.county}
              </span>
              <div className="flex gap-2 ml-2">
                {contact.tags.map((tag) => (
                  <span
                    key={tag}
                    className={
                      tag === 'Pre-foreclosure'
                        ? 'px-2 py-0.5 bg-tertiary-container text-on-tertiary-container text-[10px] font-bold rounded'
                        : 'px-2 py-0.5 bg-surface-container-highest text-on-surface-variant text-[10px] font-bold rounded'
                    }
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            className="text-sm font-bold text-primary border-b-2 border-primary-fixed pb-0.5 hover:border-primary transition-all cursor-pointer"
            href="#"
          >
            View Profile
          </a>
          <button className="p-2 bg-white rounded-lg shadow-sm">
            <Icon name="more_vert" className="text-on-surface-variant" />
          </button>
        </div>
      </header>

      {/* Chat Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth">
        {dateGroups.map((group) => (
          <div key={group.label} className="space-y-8">
            {/* Date Divider */}
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-outline-variant/20" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">
                {group.label}
              </span>
              <div className="flex-1 h-px bg-outline-variant/20" />
            </div>

            {/* Messages */}
            {group.messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        ))}
      </div>

      {/* Compose Box */}
      <ComposeBox />
    </section>
  )
}
