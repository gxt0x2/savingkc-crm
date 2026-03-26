// TMP-03: Temperature Display Everywhere
// Night 4 Phase 1: Consistent temperature indicator across all views

import { calculateTemperature, TEMPERATURE_CONFIG, type Temperature, type TemperatureInput } from '@/lib/lead-temperature'

interface TemperatureBadgeProps {
  lead: TemperatureInput
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

export function TemperatureBadge({ lead, size = 'md', showLabel = true, className = '' }: TemperatureBadgeProps) {
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

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold ${config.bg} ${config.text} ${sizeClasses[size]} ${className}`}
      title={`Lead temperature: ${temp}`}
    >
      <span className={`rounded-full ${config.dot} ${dotSizeClasses[size]}`} />
      {showLabel && config.label}
    </span>
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

  const iconMap: Record<Temperature, string> = {
    hot: '🔥',
    warm: '🌤',
    cool: '❄️',
    cold: '⬛',
  }

  return (
    <span className={`text-base ${className}`} title={`${temp} lead`}>
      {iconMap[temp]}
    </span>
  )
}
