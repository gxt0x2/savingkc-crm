'use client'

import type { TaskWorklistLaneCounts } from '@/lib/server/task-worklist'

export type TaskLane = 'current' | 'review' | 'quarantine' | 'all'

const LANES: ReadonlyArray<{ value: TaskLane; label: string }> = [
  { value: 'current', label: 'Current work' },
  { value: 'review', label: 'Review debt' },
  { value: 'quarantine', label: 'Automation quarantine' },
  { value: 'all', label: 'All records' },
]

const LANE_COPY: Record<TaskLane, string> = {
  current: 'Work linked to a non-terminal contact.',
  review: 'Unlinked work and work tied to terminal contacts. Review before changing anything.',
  quarantine: 'Explicit automation-generated tasks preserved for audit. Nothing here was deleted or completed.',
  all: 'Current work, review debt, and preserved automation quarantine together.',
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
      <div aria-label="Task operating lanes" role="group" className="flex max-w-full overflow-x-auto rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-1 md:w-fit">
        {LANES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={lane === value}
            onClick={() => onChange(value)}
            className={`shrink-0 rounded-md px-3 py-2 text-xs font-black transition-colors ${lane === value ? 'bg-[var(--crm-surface)] text-[var(--crm-brand)] shadow-sm' : 'text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'}`}
          >
            {label} <span className="ml-1 tabular-nums">{loaded ? counts[value] : '—'}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] font-semibold text-[var(--crm-text-muted)]">{LANE_COPY[lane]}</p>
    </div>
  )
}
