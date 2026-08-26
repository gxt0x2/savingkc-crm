'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { AgentScorecard, ScorecardMetric } from '@/lib/agent-scorecard'

interface Props {
  agentId: string
  period?: 'daily' | 'weekly'
}

export function AgentScorecardWidget({ agentId, period = 'daily' }: Props) {
  const requestKey = `${agentId}:${period}`
  const [result, setResult] = useState<{
    key: string
    scorecard: AgentScorecard | null
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/agent/scorecard?agent_id=${agentId}&period=${period}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null
        return response.json() as Promise<AgentScorecard>
      })
      .then((scorecard) => setResult({ key: requestKey, scorecard }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.error('Failed to fetch scorecard:', error)
        setResult({ key: requestKey, scorecard: null })
      })
    return () => controller.abort()
  }, [agentId, period, requestKey])

  const loading = result?.key !== requestKey
  const scorecard = loading ? null : result.scorecard

  if (loading) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded w-1/3" />
          <div className="h-24 bg-slate-200 rounded" />
        </div>
      </div>
    )
  }

  if (!scorecard) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <p className="text-on-surface-variant text-sm">No scorecard data available</p>
      </div>
    )
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
            <Icon name="bar_chart" size="text-base" />
            {period === 'daily' ? 'Daily' : 'Weekly'} Scorecard
          </h2>
          <p className="text-xs text-on-surface-variant mt-0.5">{scorecard.agent_name}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-2xl font-black text-primary">{scorecard.overall_performance}%</div>
            <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">Overall</div>
          </div>
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center ${
              scorecard.overall_performance >= 90
                ? 'bg-green-100 text-green-700'
                : scorecard.overall_performance >= 60
                ? 'bg-amber-100 text-amber-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            <Icon
              name={
                scorecard.overall_performance >= 90
                  ? 'check_circle'
                  : scorecard.overall_performance >= 60
                  ? 'warning'
                  : 'error'
              }
              size="text-xl"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {scorecard.metrics.map((metric) => (
          <MetricRow key={metric.label} metric={metric} />
        ))}
      </div>
    </div>
  )
}

function MetricRow({ metric }: { metric: ScorecardMetric }) {
  const colorClasses = {
    green: 'bg-green-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{metric.label}</span>
          {metric.trend && (
            <Icon
              name={metric.trend === 'up' ? 'trending_up' : metric.trend === 'down' ? 'trending_down' : 'trending_flat'}
              size="text-sm"
              className={
                metric.trend === 'up'
                  ? 'text-green-600'
                  : metric.trend === 'down'
                  ? 'text-red-600'
                  : 'text-slate-400'
              }
            />
          )}
        </div>
        <div className="text-xs text-on-surface-variant">
          <span className="font-bold text-primary">{metric.current}</span> / {metric.target} (
          <span className={`font-bold ${metric.color === 'green' ? 'text-green-600' : metric.color === 'amber' ? 'text-amber-600' : 'text-red-600'}`}>
            {metric.percentage}%
          </span>
          )
        </div>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClasses[metric.color]} transition-all duration-500`}
          style={{ width: `${Math.min(metric.percentage, 100)}%` }}
        />
      </div>
    </div>
  )
}
