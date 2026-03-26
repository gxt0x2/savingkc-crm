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
  link?: string // OPP-01: Deep link to opportunities or other pages
  linkLabel?: string
}

interface ActivityFeedProps {
  activities: FeedItem[]
}

const iconConfig: Record<ActivityType, { icon: string; bg: string; text: string }> = {
  sms: { icon: 'sms', bg: 'bg-blue-100', text: 'text-blue-600' },
  call: { icon: 'call', bg: 'bg-green-100', text: 'text-green-600' },
  email: { icon: 'email', bg: 'bg-purple-100', text: 'text-purple-600' },
  status_change: { icon: 'sync_alt', bg: 'bg-surface-container-high', text: 'text-on-surface-variant' },
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-black uppercase tracking-widest text-primary">
          Activity Feed
        </h2>
        <button className="text-secondary text-xs font-bold hover:underline">
          Log Interaction
        </button>
      </div>

      <div className="space-y-6">
        {activities.map((activity) => {
          const config = iconConfig[activity.type]
          return (
            <div key={activity.id} className="flex gap-4">
              <div
                className={`w-8 h-8 rounded-full ${config.bg} flex items-center justify-center ${config.text} shrink-0`}
              >
                <Icon name={config.icon} size="text-sm" />
              </div>
              <div>
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
                {/* OPP-01: Deep link to opportunities when relevant */}
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
