'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface StatusItem {
  id: string
  type: 'bug' | 'feature'
  section: string
  description: string
  status: string
  created_at: string
}

/**
 * FBK-10: Agent-Facing Status Page
 * Simplified view for agents: known issues, coming soon, recently shipped
 */
export function AgentStatusPage() {
  const [knownIssues, setKnownIssues] = useState<StatusItem[]>([])
  const [comingSoon, setComingSoon] = useState<StatusItem[]>([])
  const [recentlyShipped, setRecentlyShipped] = useState<StatusItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStatus()
  }, [])

  async function fetchStatus() {
    try {
      const res = await fetch('/api/system-health/agent-status')
      if (res.ok) {
        const data = await res.json()
        setKnownIssues(data.known_issues || [])
        setComingSoon(data.coming_soon || [])
        setRecentlyShipped(data.recently_shipped || [])
      }
    } catch (err) {
      console.error('Failed to fetch agent status:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-48 bg-slate-200 rounded-2xl" />
        <div className="h-48 bg-slate-200 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Known Issues */}
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <h2 className="text-sm font-black uppercase tracking-widest text-red-600 mb-5 flex items-center gap-2">
          <Icon name="bug_report" size="text-base" />
          Known Issues
        </h2>
        {knownIssues.length === 0 ? (
          <div className="text-sm text-on-surface-variant py-4">No known issues — all systems operational!</div>
        ) : (
          <div className="space-y-3">
            {knownIssues.map((issue) => (
              <div key={issue.id} className="p-3 bg-surface-container rounded-lg border border-red-100">
                <div className="flex items-start gap-2">
                  <Icon name="error" size="text-sm" className="text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-xs font-bold text-red-600 uppercase mb-0.5">{issue.section}</div>
                    <div className="text-sm">{issue.description}</div>
                    <div className="text-xs text-on-surface-variant mt-1 capitalize">Status: {issue.status.replace('_', ' ')}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Coming Soon */}
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <h2 className="text-sm font-black uppercase tracking-widest text-blue-600 mb-5 flex items-center gap-2">
          <Icon name="schedule" size="text-base" />
          Coming Soon
        </h2>
        {comingSoon.length === 0 ? (
          <div className="text-sm text-on-surface-variant py-4">No features in progress right now.</div>
        ) : (
          <div className="space-y-3">
            {comingSoon.map((feature) => (
              <div key={feature.id} className="p-3 bg-surface-container rounded-lg border border-blue-100">
                <div className="flex items-start gap-2">
                  <Icon name="lightbulb" size="text-sm" className="text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-xs font-bold text-blue-600 uppercase mb-0.5">{feature.section}</div>
                    <div className="text-sm">{feature.description}</div>
                    <div className="text-xs text-on-surface-variant mt-1 capitalize">Status: {feature.status.replace('_', ' ')}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recently Shipped */}
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <h2 className="text-sm font-black uppercase tracking-widest text-green-600 mb-5 flex items-center gap-2">
          <Icon name="check_circle" size="text-base" />
          Recently Shipped (Last 14 Days)
        </h2>
        {recentlyShipped.length === 0 ? (
          <div className="text-sm text-on-surface-variant py-4">Nothing shipped recently.</div>
        ) : (
          <div className="space-y-2">
            {recentlyShipped.map((item) => (
              <div key={item.id} className="flex items-start gap-2 p-2">
                <Icon name="check" size="text-sm" className="text-green-600 mt-0.5" />
                <div className="flex-1">
                  <div className="text-xs font-bold text-green-600 uppercase">{item.section}</div>
                  <div className="text-sm">{item.description}</div>
                </div>
                <div className="text-xs text-on-surface-variant">
                  {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
