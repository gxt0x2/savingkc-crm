'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import Link from 'next/link'
import type { ActivityType } from '@/types'

interface FeedItem {
  id: string
  type: ActivityType
  title: string
  content?: string
  timestamp: string
  statusBadge?: string
  link?: string
  linkLabel?: string
  recordingUrl?: string
  rawType?: string
}

interface ActivityFeedProps {
  activities: FeedItem[]
}

const iconConfig: Record<string, { icon: string; bg: string; text: string }> = {
  sms: { icon: 'sms', bg: 'bg-blue-100', text: 'text-blue-600' },
  call: { icon: 'call', bg: 'bg-green-100', text: 'text-green-600' },
  email: { icon: 'email', bg: 'bg-purple-100', text: 'text-purple-600' },
  status_change: { icon: 'sync_alt', bg: 'bg-surface-container-high', text: 'text-on-surface-variant' },
}

function CallRecordingPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  return (
    <div className="mt-2 bg-green-50 border border-green-200 rounded-lg p-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setPlaying(!playing)}
          className="w-8 h-8 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center transition-colors"
        >
          <Icon name={playing ? 'pause' : 'play_arrow'} size="text-sm" />
        </button>
        <div className="flex-1">
          <audio
            src={url}
            controls
            className="w-full h-8"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        </div>
        <button
          onClick={() => setSpeed(s => s === 2 ? 1 : s + 0.5)}
          className="text-[10px] font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full hover:bg-green-200 transition-colors"
        >
          {speed}x
        </button>
      </div>
    </div>
  )
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-black uppercase tracking-widest text-primary">
          Activity Feed
        </h2>
        <span className="text-xs text-on-surface-variant">{activities.length} events</span>
      </div>

      <div className="space-y-6">
        {activities.length === 0 ? (
          <p className="text-sm text-on-surface-variant italic text-center py-4">No activities recorded yet</p>
        ) : activities.map((activity) => {
          const config = iconConfig[activity.type] || iconConfig.status_change
          return (
            <div key={activity.id} className="flex gap-4">
              <div
                className={`w-8 h-8 rounded-full ${config.bg} flex items-center justify-center ${config.text} shrink-0`}
              >
                <Icon name={config.icon} size="text-sm" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-primary mb-1">
                  {activity.title}
                  {activity.statusBadge && (
                    <span className="px-2 py-0.5 bg-secondary-container text-on-secondary-fixed text-[10px] rounded ml-1">
                      {activity.statusBadge}
                    </span>
                  )}
                  <span className="text-on-surface-variant font-normal ml-2">
                    {activity.timestamp}
                  </span>
                </p>
                {activity.content && (
                  <p className={`text-sm text-on-surface-variant ${activity.type === 'sms' ? 'italic' : ''}`}>
                    {activity.content}
                  </p>
                )}
                {/* Call Recording Player */}
                {activity.recordingUrl && (
                  <CallRecordingPlayer url={activity.recordingUrl} />
                )}
                {activity.link && (
                  <Link
                    href={activity.link}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:underline mt-1"
                  >
                    <Icon name="arrow_forward" size="text-xs" />
                    {activity.linkLabel || 'View'}
                  </Link>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
