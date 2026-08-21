'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface GhostProtocolStats {
  phase1: number
  phase2: number
  phase3: number
  total: number
  recovery_rate: number
}

export function GhostProtocolWidget() {
  const [stats, setStats] = useState<GhostProtocolStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  async function fetchStats() {
    try {
      const res = await fetch('/api/ghost-protocol/stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (err) {
      console.error('Failed to fetch ghost protocol stats:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded w-1/2" />
          <div className="h-24 bg-slate-200 rounded" />
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <p className="text-on-surface-variant text-sm">No ghost protocol data available</p>
      </div>
    )
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
          <Icon name="auto_fix_high" size="text-base" />
          Ghost Protocol
        </h2>
        <div className="text-right">
          <div className="text-2xl font-black text-primary">{stats.total}</div>
          <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">Active</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="rounded-xl bg-surface-container p-3 text-center">
          <div className="text-2xl font-black text-blue-600">{stats.phase1}</div>
          <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">Phase 1</div>
          <div className="text-[9px] text-on-surface-variant/70">Days 1-7</div>
        </div>

        <div className="rounded-xl bg-surface-container p-3 text-center">
          <div className="text-2xl font-black text-amber-600">{stats.phase2}</div>
          <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">Phase 2</div>
          <div className="text-[9px] text-on-surface-variant/70">Days 8-21</div>
        </div>

        <div className="rounded-xl bg-surface-container p-3 text-center">
          <div className="text-2xl font-black text-purple-600">{stats.phase3}</div>
          <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">Phase 3</div>
          <div className="text-[9px] text-on-surface-variant/70">Long Nurture</div>
        </div>
      </div>

      <div className="pt-4 border-t border-outline-variant/10 flex items-center justify-between">
        <span className="text-xs text-on-surface-variant">Recovery Rate</span>
        <div className="flex items-center gap-2">
          <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-500"
              style={{ width: `${Math.min(stats.recovery_rate, 100)}%` }}
            />
          </div>
          <span className="text-sm font-bold text-primary">{stats.recovery_rate}%</span>
        </div>
      </div>
    </div>
  )
}
