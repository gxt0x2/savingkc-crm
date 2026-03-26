'use client'

import { Icon } from '@/components/ui/icon'

interface Goal {
  label: string
  current: number
  target: number
  unit: string
  color: 'green' | 'amber' | 'red'
}

/**
 * FBK-06: Goal Tracker
 * Progress bars/rings for configurable goals
 */
export function GoalTracker() {
  // Hardcoded for now - could be made dynamic via API
  const goals: Goal[] = [
    {
      label: 'CRM Feature Completion',
      current: 110,
      target: 132,
      unit: 'items',
      color: 'green',
    },
    {
      label: 'Open Bugs → Target: 0',
      current: 3,
      target: 10, // Inverted: lower is better
      unit: 'bugs',
      color: 'amber',
    },
    {
      label: 'Disposition Rate',
      current: 87,
      target: 100,
      unit: '%',
      color: 'green',
    },
    {
      label: 'Agent Follow-up Completion',
      current: 72,
      target: 95,
      unit: '%',
      color: 'amber',
    },
  ]

  const getColor = (goal: Goal) => {
    const colors = {
      green: 'bg-green-500',
      amber: 'bg-amber-500',
      red: 'bg-red-500',
    }
    return colors[goal.color]
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      <h3 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
        <Icon name="flag" size="text-base" />
        Goal Tracker
      </h3>

      <div className="space-y-5">
        {goals.map((goal) => {
          const percentage = goal.unit === 'bugs'
            ? Math.max(0, 100 - (goal.current / goal.target) * 100) // Inverted for bugs
            : (goal.current / goal.target) * 100

          return (
            <div key={goal.label}>
              <div className="flex items-center justify-between mb-2 text-sm">
                <span className="font-semibold">{goal.label}</span>
                <span className="text-xs text-on-surface-variant">
                  <strong className="text-primary">{goal.current}</strong>
                  {goal.unit === '%' ? '' : ` / ${goal.target}`} {goal.unit}
                </span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getColor(goal)} transition-all duration-500`}
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
