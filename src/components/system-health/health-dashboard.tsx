'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface SystemHealthStats {
  feature_completion: { current: number; total: number; percentage: number }
  open_bugs: number
  error_rate_trend: { date: string; count: number }[]
  workers: {
    name: string
    status: 'healthy' | 'degraded' | 'down' | 'unknown'
    last_run: string | null
    failure_count: number
  }[]
}

/**
 * FBK-05: Visual Health Dashboard
 * Shows feature completion, bugs, error trends, worker health
 */
export function HealthDashboard() {
  const [stats, setStats] = useState<SystemHealthStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  async function fetchStats() {
    try {
      const res = await fetch('/api/system-health/stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (err) {
      console.error('Failed to fetch system health stats:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-48 bg-slate-200 rounded-2xl" />
        <div className="h-64 bg-slate-200 rounded-2xl" />
      </div>
    )
  }

  if (!stats) {
    return <div className="text-center py-8 text-on-surface-variant">Failed to load system health data</div>
  }

  const statusColors = {
    healthy: 'bg-green-500',
    degraded: 'bg-amber-500',
    down: 'bg-red-500',
    unknown: 'bg-slate-400',
  }

  return (
    <div className="space-y-6">
      {/* Feature Completion Ring + Bug Count */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm font-black uppercase tracking-widest text-primary mb-5">Feature Completion</h3>
          <div className="flex items-center justify-center">
            <div className="relative w-40 h-40">
              <svg className="transform -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  stroke="#e5e7eb"
                  strokeWidth="12"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="12"
                  strokeDasharray={`${(stats.feature_completion.percentage / 100) * 339.292} 339.292`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-4xl font-black text-primary">{stats.feature_completion.percentage}%</div>
                <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">Complete</div>
              </div>
            </div>
          </div>
          <div className="text-center mt-4 text-sm text-on-surface-variant">
            <strong className="text-primary">{stats.feature_completion.current}</strong> of{' '}
            <strong className="text-primary">{stats.feature_completion.total}</strong> items shipped
          </div>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm font-black uppercase tracking-widest text-primary mb-5">Open Bugs</h3>
          <div className="flex items-center justify-center h-40">
            <div className="text-center">
              <div className="text-6xl font-black text-red-600 mb-2">{stats.open_bugs}</div>
              <div className="text-xs text-on-surface-variant uppercase tracking-wider">Active Issues</div>
              <div className="mt-4 px-4 py-2 bg-red-50 text-red-600 text-xs font-semibold rounded-lg inline-block">
                Target: 0
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error Rate Trend */}
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
          <Icon name="trending_up" size="text-base" />
          Error Rate Trend (Last 14 Days)
        </h3>
        <div className="flex items-end justify-between h-32 gap-1">
          {stats.error_rate_trend.map((day, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center">
              <div
                className="w-full bg-red-200 rounded-t transition-all hover:bg-red-300"
                style={{ height: `${Math.max((day.count / 10) * 100, 8)}%` }}
                title={`${day.count} errors`}
              />
              <div className="text-[9px] text-on-surface-variant mt-1">
                {new Date(day.date).getDate()}
              </div>
            </div>
          ))}
        </div>
        <div className="text-xs text-on-surface-variant text-center mt-2">Daily error count</div>
      </div>

      {/* Worker Status Cards */}
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
          <Icon name="settings" size="text-base" />
          System Workers
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.workers.map((worker) => (
            <div
              key={worker.name}
              className="p-4 bg-surface-container rounded-xl border border-outline-variant/10"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-semibold text-sm">{worker.name}</div>
                <div className={`w-3 h-3 rounded-full ${statusColors[worker.status]}`} />
              </div>
              <div className="text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">
                Status: <span className="capitalize font-semibold">{worker.status}</span>
              </div>
              {worker.last_run && (
                <div className="text-[10px] text-on-surface-variant">
                  Last run: {new Date(worker.last_run).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
              )}
              {worker.failure_count > 0 && (
                <div className="text-[10px] text-red-600 font-semibold mt-1">
                  {worker.failure_count} failures (24h)
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
