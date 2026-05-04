'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'

const views = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'agenda', label: 'Agenda' },
] as const

export type CalendarView = (typeof views)[number]['key']

export function ViewToggle({
  title = 'Schedule',
  department = 'acquisitions',
  currentView,
  currentMonth,
  currentYear,
  onPrevMonth,
  onNextMonth,
  onNewTask,
}: {
  title?: string
  department?: 'acquisitions' | 'dispositions' | 'tc'
  currentView: CalendarView
  currentMonth: string
  currentYear: number
  onPrevMonth: () => void
  onNextMonth: () => void
  onNewTask?: () => void
}) {
  return (
    <section className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
        <h1 className="text-2xl font-black tracking-tight text-[var(--ck-text)]">{title}</h1>
        <div className="flex items-center ck-card-elev rounded-lg p-1">
          {views.map((v) => (
            <Link
              key={v.key}
              href={`/calendar?department=${department}&view=${v.key}`}
              className={`px-3 sm:px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${
                currentView === v.key
                  ? 'bg-[#E32E2E] text-white shadow-sm'
                  : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
              }`}
            >
              {v.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        <div className="flex items-center ck-card-elev rounded-lg px-3 py-1.5 gap-2">
          <Icon name="calendar_today" size="text-sm" className="text-[var(--ck-text-muted)]" />
          <span className="text-sm font-bold text-[var(--ck-text)] tabular-nums">
            {currentMonth} {currentYear}
          </span>
          <div className="flex items-center gap-0.5 ml-1 pl-2 border-l border-[var(--ck-border)]">
            <button
              onClick={onPrevMonth}
              className="p-1 rounded text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] hover:bg-white/5 transition-colors"
              aria-label="Previous month"
            >
              <Icon name="chevron_left" size="text-sm" />
            </button>
            <button
              onClick={onNextMonth}
              className="p-1 rounded text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] hover:bg-white/5 transition-colors"
              aria-label="Next month"
            >
              <Icon name="chevron_right" size="text-sm" />
            </button>
          </div>
        </div>
        <button
          onClick={onNewTask}
          className="bg-[#E32E2E] text-white px-4 py-2 rounded-md text-sm font-bold flex items-center gap-1.5 shadow-sm hover:bg-[#C42626] transition-colors whitespace-nowrap"
        >
          <Icon name="add" size="text-base" />
          <span className="hidden sm:inline">New Task</span>
          <span className="sm:hidden">Task</span>
        </button>
      </div>
    </section>
  )
}
