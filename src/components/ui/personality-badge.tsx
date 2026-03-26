import { cn, personalityColor } from '@/lib/utils'
import type { PersonalityType } from '@/types'

export function PersonalityBadge({ type }: { type: PersonalityType | null }) {
  if (!type) return null
  return (
    <span className={cn('px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider', personalityColor(type))}>
      {type}
    </span>
  )
}
