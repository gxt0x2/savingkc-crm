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
  if (name === 'no_answer_badge' || name === 'missed_call_badge') {
    const circleFill = name === 'missed_call_badge' ? '#FF453A' : '#000000'

    return (
      <span className={cn('inline-flex items-center justify-center', size, className)} aria-hidden="true">
        <svg viewBox="0 0 24 24" className="w-[1em] h-[1em]" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="11" fill={circleFill} />
          <path d="M8.1 9.2L10.5 11.6L15 7.1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.2 7.1H16.9V10.8" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7.2 15.7C9.5 14.2 14.5 14.2 16.8 15.7" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
        </svg>
      </span>
    )
  }

  return (
    <span
      className={cn('material-symbols-outlined', size, className)}
      style={filled ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : undefined}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}
