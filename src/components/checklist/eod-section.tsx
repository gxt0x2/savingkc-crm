'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

const eodItems = [
  {
    title: 'Log all calls/SMS',
    description: 'Ensure all interactions are accurately synced to the deal ledger.',
  },
  {
    title: 'Set follow-ups for tomorrow',
    description: 'Queue morning outreach for high-priority pipeline movers.',
  },
  {
    title: 'Update deal math on negotiations',
    description: "Adjust ARV/MAO based on today's intelligence and counter-offers.",
  },
  {
    title: "Clear current day's agenda",
    description: 'Mark all completed items and finalize notes on active tickets.',
  },
  {
    title: 'Submit daily summary',
    description: 'Draft a brief recap of pipeline progression for the team review.',
  },
]

interface EodSectionProps {
  onSubmit: () => void
}

export function EodSection({ onSubmit }: EodSectionProps) {
  const [checked, setChecked] = useState<boolean[]>(new Array(eodItems.length).fill(false))

  function toggle(index: number) {
    setChecked((prev) => {
      const next = [...prev]
      next[index] = !next[index]
      return next
    })
  }

  return (
    <section className="bg-surface-container-low p-8 rounded-xl">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-tertiary-container flex items-center justify-center">
            <Icon name="dark_mode" className="text-on-tertiary-container" filled />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-primary">End of Day Checklist</h2>
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-widest">Protocol 02</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        {eodItems.map((item, i) => (
          <label
            key={i}
            className="flex items-start gap-4 p-4 bg-surface-container-lowest rounded-lg cursor-pointer hover:bg-white transition-colors"
          >
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={() => toggle(i)}
              className="mt-1 w-5 h-5 rounded border-outline-variant text-secondary focus:ring-secondary accent-secondary"
            />
            <div>
              <span className="block font-bold text-primary">{item.title}</span>
              <span className="text-sm text-on-surface-variant">{item.description}</span>
            </div>
          </label>
        ))}
      </div>

      <button
        onClick={onSubmit}
        className="w-full bg-primary text-on-primary font-bold py-4 rounded hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
      >
        Submit EOD Protocol
        <Icon name="done_all" className="text-sm" />
      </button>
    </section>
  )
}
