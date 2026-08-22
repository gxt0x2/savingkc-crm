'use client'

import type { TaskWorklistLaneCounts } from '@/lib/server/task-worklist'

export type TaskLane = 'current' | 'review' | 'all'

const LANES: ReadonlyArray<{ value: TaskLane; label: string }> = [
  { value: 'current', label: 'Current work' },
  { value: 'review', label: 'Review debt' },
  { value: 'all', label: 'All records' },
]

const LANE_COPY: Record<TaskLane, string> = {
  current: 'Work linked to a non-terminal contact.',
  review: 'Unlinked work and work tied to terminal contacts. Review before changing anything.',
  all: 'Current work and review debt together.',
}

export function TaskOperatingLanes({
  lane,
  counts,
  loaded,
  onChange,
}: {
  lane: TaskLane
  counts: TaskWorklistLaneCounts
  loaded: boolean
  onChange: (lane: TaskLane) => void
}) {
  return (
    <div className="border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2 md:px-7">
      <div aria-label="Task operating lanes" role="group" className="inline-flex max-w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-1">
        {LANES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={lane === value}
            onClick={() => onChange(value)}
            className={`rounded-md px-3 py-2 text-xs font-black transition-colors ${lane === value ? 'bg-[var(--crm-surface)] text-[var(--crm-brand)] shadow-sm' : 'text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'}`}
          >
            {label} <span className="ml-1 tabular-nums">{loaded ? counts[value] : '—'}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] font-semibold text-[var(--crm-text-muted)]">{LANE_COPY[lane]}</p>
    </div>
  )
}
