'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

const sodItems = [
  {
    title: 'Open all systems',
    description: 'GHL, Mojo, Google Chat — one pass',
  },
  {
    title: "Review today's follow-ups",
    description: 'Prioritize high-value leads',
  },
  {
    title: 'Confirm call list loaded',
    description: 'Verify list is correct in Mojo',
  },
  {
    title: 'Review framework + objections',
    description: 'Appointment framework + objection sheet',
  },
  {
    title: 'Clear the runway + read your WHY',
    description: 'Silence distractions, lock in mindset',
  },
]

export function SodSection() {
  const [checked, setChecked] = useState<boolean[]>(new Array(sodItems.length).fill(false))

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
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center">
            <Icon name="light_mode" className="text-white" filled />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-primary">Start of Day Checklist</h2>
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-widest">Protocol 01</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        {sodItems.map((item, i) => (
          <label
            key={i}
            className="flex items-start gap-4 p-4 bg-surface-container-lowest rounded-lg cursor-pointer hover:bg-white transition-colors group"
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

      <button className="w-full bg-primary text-on-primary font-bold py-4 rounded hover:bg-slate-800 transition-all flex items-center justify-center gap-2">
        Submit SOD Protocol
        <Icon name="arrow_forward" className="text-sm" />
      </button>
    </section>
  )
}
