'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { TEMPERATURE_CONFIG, type Temperature } from '@/lib/lead-temperature'

interface TemperatureOverrideProps {
  leadId: string
  currentPriority: string | null
  onChanged: (newPriority: string) => void
}

const TEMP_OPTIONS: { value: string; temp: Temperature }[] = [
  { value: 'hot', temp: 'hot' },
  { value: 'high', temp: 'warm' },
  { value: 'normal', temp: 'cool' },
  { value: 'low', temp: 'cold' },
]

export function TemperatureOverride({ leadId, currentPriority, onChanged }: TemperatureOverrideProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleChange(priority: string) {
    if (priority === currentPriority) {
      setOpen(false)
      return
    }

    setSaving(true)
    const supabase = createClient()

    // Update via API — cascades through manifest → leads
    await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: leadId, priority }),
    })

    // Log the change
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'status_change',
      description: `Temperature manually changed from ${currentPriority || 'normal'} to ${priority}`,
      agent: 'User',
      metadata: {
        field: 'temperature',
        old_value: currentPriority,
        new_value: priority,
        manual: true,
      },
    })

    onChanged(priority)
    setSaving(false)
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary transition-colors"
        title="Change temperature"
      >
        <Icon name="thermostat" size="text-sm" />
        <span className="font-medium">Change</span>
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5 bg-surface-container-low rounded-lg p-1">
      {TEMP_OPTIONS.map(opt => {
        const config = TEMPERATURE_CONFIG[opt.temp]
        const isActive = opt.value === currentPriority || (opt.value === 'normal' && !currentPriority)
        return (
          <button
            key={opt.value}
            onClick={() => handleChange(opt.value)}
            disabled={saving}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
              isActive
                ? `${config.bg} ${config.text}`
                : 'text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
            {config.label}
          </button>
        )
      })}
      <button
        onClick={() => setOpen(false)}
        className="text-on-surface-variant hover:text-primary ml-1"
      >
        <Icon name="close" size="text-sm" />
      </button>
    </div>
  )
}
