import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

export interface WorkspaceTab {
  key: string
  label: string
  href: string
  icon: string
}

export function DispoPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <header className="crm-page-header flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <p className="crm-eyebrow">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--crm-ink)]">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--crm-text-muted)]">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function DispoWorkspaceTabs({ tabs, activeKey }: { tabs: WorkspaceTab[]; activeKey: string }) {
  return (
    <nav aria-label="Workspace sections" className="border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 sm:px-5">
      <div className="flex gap-1 overflow-x-auto py-2">
        {tabs.map((tab) => {
          const active = tab.key === activeKey
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors',
                active
                  ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
                  : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)] hover:text-[var(--crm-ink)]'
              )}
            >
              <Icon name={tab.icon} size="text-base" />
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export function MetricStrip({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; icon: string; tone?: 'neutral' | 'info' | 'warning' | 'danger' | 'success' }>
}) {
  const tones = {
    neutral: 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]',
    info: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
    warning: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
    danger: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
    success: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  }

  return (
    <section aria-label="Workspace summary" className="grid divide-y divide-[var(--crm-border)] overflow-hidden rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-[var(--crm-shadow-sm)] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex min-h-20 items-center gap-3 px-4 py-3">
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', tones[item.tone ?? 'neutral'])}>
            <Icon name={item.icon} size="text-lg" />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">{item.label}</span>
            <span className="mt-0.5 block truncate text-xl font-extrabold text-[var(--crm-ink)]">{item.value}</span>
          </span>
        </div>
      ))}
    </section>
  )
}

export function NextStepCard({
  title,
  detail,
  blocked = false,
  complete = false,
  actionLabel,
  onAction,
}: {
  title: string
  detail: string
  blocked?: boolean
  complete?: boolean
  actionLabel?: string
  onAction?: () => void
}) {
  const tone = blocked ? 'danger' : complete ? 'success' : 'brand'
  const colors = {
    danger: 'border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)]',
    success: 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)]',
    brand: 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)]',
  }
  const iconColors = {
    danger: 'bg-[var(--crm-danger)]',
    success: 'bg-[var(--crm-success)]',
    brand: 'bg-[var(--crm-brand)]',
  }

  return (
    <section className={cn('rounded-xl border p-4 shadow-[var(--crm-shadow-sm)]', colors[tone])}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[var(--crm-on-brand)]', iconColors[tone])}>
          <Icon name={blocked ? 'report' : complete ? 'check_circle' : 'arrow_forward'} size="text-lg" />
        </span>
        <div className="min-w-[220px] flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">{complete ? 'File ready' : 'Next step'}</p>
          <p className="mt-0.5 text-base font-black text-[var(--crm-ink)]">{title}</p>
          <p className="mt-0.5 text-xs font-semibold text-[var(--crm-text-muted)]">{detail}</p>
        </div>
        {actionLabel && onAction ? (
          <button type="button" onClick={onAction} className="crm-primary-button inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-black">
            <Icon name={blocked ? 'lock_open' : 'done'} size="text-base" />
            {actionLabel}
          </button>
        ) : null}
      </div>
    </section>
  )
}

export function DispoPanel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('crm-panel overflow-hidden rounded-xl', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--crm-border)] px-4 py-3">
        <div>
          <h2 className="text-sm font-extrabold text-[var(--crm-ink)]">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-[var(--crm-text-muted)]">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function DispoEmptyState({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[var(--crm-surface-subtle)] text-[var(--crm-text-dim)]">
        <Icon name={icon} size="text-xl" />
      </span>
      <p className="mt-3 text-sm font-extrabold text-[var(--crm-ink)]">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--crm-text-muted)]">{description}</p>
    </div>
  )
}
