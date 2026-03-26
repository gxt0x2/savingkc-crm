import { cn } from '@/lib/utils'

export function Badge({
  children,
  variant = 'default',
  className,
}: {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'error' | 'warning' | 'primary'
  className?: string
}) {
  const variants = {
    default: 'bg-surface-container-highest text-on-surface-variant',
    success: 'bg-green-50 text-secondary',
    error: 'bg-error-container text-on-error-container',
    warning: 'bg-amber-50 text-amber-700',
    primary: 'bg-primary text-white',
  }

  return (
    <span className={cn('px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider', variants[variant], className)}>
      {children}
    </span>
  )
}
