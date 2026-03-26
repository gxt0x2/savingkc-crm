import { cn } from '@/lib/utils'

export function Icon({
  name,
  className,
  filled,
  size,
}: {
  name: string
  className?: string
  filled?: boolean
  size?: string
}) {
  return (
    <span
      className={cn('material-symbols-outlined', size, className)}
      style={filled ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : undefined}
    >
      {name}
    </span>
  )
}
