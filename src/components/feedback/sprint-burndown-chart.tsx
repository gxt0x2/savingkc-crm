'use client'

/**
 * ARI CRM - Sprint Burndown Chart
 * Night 6: FBK-07
 * Visualizes items resolved over the build sprint (6 nights)
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface BurndownDataPoint {
  date: string
  totalItems: number
  resolvedItems: number
  remainingItems: number
}

export function SprintBurndownChart() {
  const [data, setData] = useState<BurndownDataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    total: 0,
    resolved: 0,
    remaining: 0,
    percentComplete: 0,
  })

  useEffect(() => {
    loadBurndownData()
  }, [])

  async function loadBurndownData() {
    const supabase = createClient()

    // Fetch all feedback submissions
    const { data: submissions } = await supabase
      .from('feedback_submissions')
      .select('created_at, resolved_at, status')
      .order('created_at', { ascending: true })

    if (!submissions || submissions.length === 0) {
      setLoading(false)
      return
    }

    // Group by date to create burndown
    const dateMap = new Map<string, { resolved: number; created: number }>()

    // Get date range: first submission to today
    const startDate = new Date(submissions[0].created_at)
    const endDate = new Date()
    const dayCount = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    // Initialize all dates
    for (let i = 0; i <= dayCount; i++) {
      const date = new Date(startDate)
      date.setDate(date.getDate() + i)
      const dateStr = date.toISOString().split('T')[0]
      dateMap.set(dateStr, { resolved: 0, created: 0 })
    }

    // Count created items by date
    submissions.forEach((sub) => {
      const createdDate = new Date(sub.created_at).toISOString().split('T')[0]
      const existing = dateMap.get(createdDate) || { resolved: 0, created: 0 }
      existing.created++
      dateMap.set(createdDate, existing)
    })

    // Count resolved items by date
    submissions
      .filter((sub) => sub.resolved_at)
      .forEach((sub) => {
        const resolvedDate = new Date(sub.resolved_at!)
          .toISOString()
          .split('T')[0]
        const existing = dateMap.get(resolvedDate) || { resolved: 0, created: 0 }
        existing.resolved++
        dateMap.set(resolvedDate, existing)
      })

    // Build burndown data
    let runningTotal = 0
    let runningResolved = 0
    const burndownData: BurndownDataPoint[] = []

    const sortedDates = Array.from(dateMap.keys()).sort()
    sortedDates.forEach((date) => {
      const counts = dateMap.get(date)!
      runningTotal += counts.created
      runningResolved += counts.resolved

      burndownData.push({
        date,
        totalItems: runningTotal,
        resolvedItems: runningResolved,
        remainingItems: runningTotal - runningResolved,
      })
    })

    setData(burndownData)

    // Calculate stats
    const total = runningTotal
    const resolved = runningResolved
    const remaining = total - resolved
    const percentComplete = total > 0 ? Math.round((resolved / total) * 100) : 0

    setStats({ total, resolved, remaining, percentComplete })
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="animate-pulse">
          <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
          <div className="h-48 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="font-semibold text-gray-900 mb-2">Sprint Burndown</h3>
        <p className="text-sm text-gray-500">No sprint data available yet.</p>
      </div>
    )
  }

  // Calculate max value for scaling
  const maxValue = Math.max(...data.map((d) => d.totalItems))
  const height = 200

  // Build SVG paths
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100
    const y = 100 - (d.remainingItems / maxValue) * 100
    return { x, y, ...d }
  })

  const remainingPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`)
    .join(' ')

  const resolvedPoints = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100
    const y = 100 - (d.resolvedItems / maxValue) * 100
    return { x, y }
  })

  const resolvedPath = resolvedPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`)
    .join(' ')

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <h3 className="font-semibold text-gray-900 mb-2">
          Sprint Burndown Chart
        </h3>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-gray-500">Total Items</div>
            <div className="text-lg font-semibold text-gray-900">
              {stats.total}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Resolved</div>
            <div className="text-lg font-semibold text-green-600">
              {stats.resolved}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Remaining</div>
            <div className="text-lg font-semibold text-amber-600">
              {stats.remaining}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Progress</div>
            <div className="text-lg font-semibold text-blue-600">
              {stats.percentComplete}%
            </div>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all"
            style={{ width: `${stats.percentComplete}%` }}
          />
        </div>
      </div>

      {/* Chart */}
      <div className="relative" style={{ height: `${height}px` }}>
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0"
        >
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="100"
              y2={y}
              stroke="#e5e7eb"
              strokeWidth="0.2"
            />
          ))}

          {/* Remaining work area */}
          <path
            d={`${remainingPath} L 100,100 L 0,100 Z`}
            fill="rgba(251, 191, 36, 0.15)"
            stroke="none"
          />

          {/* Remaining work line */}
          <path
            d={remainingPath}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="0.5"
          />

          {/* Resolved work area */}
          <path
            d={`${resolvedPath} L 100,100 L 0,100 Z`}
            fill="rgba(34, 197, 94, 0.15)"
            stroke="none"
          />

          {/* Resolved work line */}
          <path
            d={resolvedPath}
            fill="none"
            stroke="#22c55e"
            strokeWidth="0.5"
          />

          {/* Data points */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="1"
              fill="#f59e0b"
              className="hover:r-2 transition-all"
            />
          ))}
        </svg>

        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-0 w-8 flex flex-col justify-between text-xs text-gray-500 pr-2">
          {[maxValue, Math.round(maxValue * 0.75), Math.round(maxValue * 0.5), Math.round(maxValue * 0.25), 0].map(
            (val, i) => (
              <div key={i} className="text-right">
                {val}
              </div>
            )
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-amber-500" />
          <span className="text-gray-600">Remaining Work</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-green-500" />
          <span className="text-gray-600">Resolved</span>
        </div>
      </div>

      {/* Date range */}
      {data.length > 0 && (
        <div className="mt-2 text-xs text-gray-500">
          {new Date(data[0].date).toLocaleDateString()} →{' '}
          {new Date(data[data.length - 1].date).toLocaleDateString()}
        </div>
      )}
    </div>
  )
}
