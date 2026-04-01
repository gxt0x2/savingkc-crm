// TMP-03: Temperature Display Everywhere
// Night 4 Phase 1: Consistent temperature indicator across all views

'use client'

import { useState } from 'react'
import { calculateTemperature, TEMPERATURE_CONFIG, type Temperature, type TemperatureInput } from '@/lib/lead-temperature'
import { createClient } from '@/lib/supabase/client'

interface TemperatureBadgeProps {
  lead: TemperatureInput
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
  leadId?: string
  onChanged?: (priority: string) => void
  clickable?: boolean
}

const TEMP_CYCLE: Temperature[] = ['cold', 'cool', 'warm', 'hot']

// Map temperature back to priority values
const TEMP_TO_PRIORITY: Record<Temperature, string> = {
  cold: 'low',
  cool: 'normal',
  warm: 'high',
  hot: 'hot'
}

export function TemperatureBadge({ lead, size = 'md', showLabel = true, className = '', leadId, onChanged, clickable = false }: TemperatureBadgeProps) {
  const [updating, setUpdating] = useState(false)
  const temp = calculateTemperature(lead)
  const config = TEMPERATURE_CONFIG[temp]

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-xs px-3 py-1',
    lg: 'text-sm px-4 py-1.5',
  }

  const dotSizeClasses = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  }

  async function handleClick(e: React.MouseEvent) {
    if (!clickable || !leadId || updating) return

    e.preventDefault()
    e.stopPropagation()

    setUpdating(true)

    // Cycle to next temperature
    const currentIndex = TEMP_CYCLE.indexOf(temp)
    const nextIndex = (currentIndex + 1) % TEMP_CYCLE.length
    const nextTemp = TEMP_CYCLE[nextIndex]
    const nextPriority = TEMP_TO_PRIORITY[nextTemp]

    const supabase = createClient()
    await supabase.from('leads').update({ priority: nextPriority }).eq('id', leadId)

    onChanged?.(nextPriority)
    setUpdating(false)
  }

  const Component = clickable ? 'button' : 'span'

  return (
    <Component
      onClick={clickable ? handleClick : undefined}
      disabled={updating}
      className={`inline-flex items-center gap-1.5 rounded-full font-bold ${config.bg} ${config.text} ${sizeClasses[size]} ${className} ${
        clickable ? 'cursor-pointer hover:opacity-80 transition-all' : ''
      } ${updating ? 'opacity-50' : ''}`}
      title={clickable ? `Lead temperature: ${temp} (click to cycle)` : `Lead temperature: ${temp}`}
    >
      <span className={`rounded-full ${config.dot} ${dotSizeClasses[size]}`} />
      {showLabel && config.label}
    </Component>
  )
}

// Compact version for table cells
export function TemperatureDot({ lead, className = '' }: { lead: TemperatureInput; className?: string }) {
  const temp = calculateTemperature(lead)
  const config = TEMPERATURE_CONFIG[temp]

  return (
    <span
      className={`w-3 h-3 rounded-full ${config.dot} ${className}`}
      title={`${config.label} lead`}
    />
  )
}

// Icon version for compact spaces
export function TemperatureIcon({ lead, className = '' }: { lead: TemperatureInput; className?: string }) {
  const temp = calculateTemperature(lead)
  const config = TEMPERATURE_CONFIG[temp]

  return (
    <span className={`material-symbols-outlined text-base ${config.text} ${className}`} title={`${temp} lead`}>
      {config.icon}
    </span>
  )
}
