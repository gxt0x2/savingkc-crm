import { cn } from '@/lib/utils'

export function AssistantMark({ className, live = false }: { className?: string; live?: boolean }) {
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center', className)} aria-hidden="true">
      <span className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(145deg,#20231f_0%,#0f100f_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,.12)]" />
      <svg viewBox="0 0 40 40" className="relative h-[62%] w-[62%]" fill="none">
        <path d="M10 29V17.5L20 10l10 7.5V29" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 27.5V21l5-3.5 5 3.5v6.5" stroke="#d9342b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="20" cy="27.5" r="2" fill="white" />
      </svg>
      {live ? <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--crm-surface)] bg-[var(--crm-success)]" /> : null}
    </span>
  )
}
