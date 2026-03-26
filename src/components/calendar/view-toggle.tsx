'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const views = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'agenda', label: 'Agenda' },
] as const

export type CalendarView = (typeof views)[number]['key']

export function ViewToggle({
  currentView,
  currentMonth,
  currentYear,
  onPrevMonth,
  onNextMonth,
}: {
  currentView: CalendarView
  currentMonth: string
  currentYear: number
  onPrevMonth: () => void
  onNextMonth: () => void
}) {
  return (
    <section className="px-8 py-6 bg-surface-container-low flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Schedule</h1>
        <div className="flex items-center bg-surface-container-highest rounded-lg p-1">
          {views.map((v) => (
            <Link
              key={v.key}
              href={`/calendar?view=${v.key}`}
              className={cn(
                'px-4 py-1.5 text-xs font-semibold rounded-md transition-all',
                currentView === v.key
                  ? 'bg-surface-container-lowest shadow-sm'
                  : 'hover:bg-surface-container'
              )}
            >
              {v.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center bg-surface-container-lowest border border-outline-variant/15 rounded-md px-3 py-2 gap-2">
          <Icon name="calendar_today" className="text-on-surface-variant" size="text-sm" />
          <span className="text-sm font-medium">
            {currentMonth} {currentYear}
          </span>
          <div className="flex items-center gap-1 ml-2 border-l border-outline-variant/30 pl-2">
            <button
              onClick={onPrevMonth}
              className="hover:bg-surface-container hover:rounded p-1"
            >
              <Icon name="chevron_left" size="text-sm" />
            </button>
            <button
              onClick={onNextMonth}
              className="hover:bg-surface-container hover:rounded p-1"
            >
              <Icon name="chevron_right" size="text-sm" />
            </button>
          </div>
        </div>
        <button className="bg-primary text-on-primary px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 shadow-sm hover:opacity-90 transition-all">
          <Icon name="add" size="text-lg" />
          New Task
        </button>
      </div>
    </section>
  )
}
