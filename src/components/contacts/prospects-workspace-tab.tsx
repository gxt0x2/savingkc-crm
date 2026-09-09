import { Icon } from '@/components/ui/icon'

interface ProspectsWorkspaceTabProps {
  count: number
  active: boolean
  onSelect: () => void
  label?: string
  icon?: string
  tone?: 'info' | 'muted'
}

export function ProspectsWorkspaceTab({
  count,
  active,
  onSelect,
  label = 'Prospects',
  icon = 'person_search',
  tone = 'info',
}: ProspectsWorkspaceTabProps) {
  const activeTone = tone === 'info'
    ? 'border-b-[var(--crm-info)] text-[var(--crm-info)]'
    : 'border-b-[var(--crm-text-muted)] text-[var(--crm-ink)]'
  const inactiveTone = tone === 'info'
    ? 'text-[var(--crm-text-muted)] hover:text-[var(--crm-info)]'
    : 'text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${label} ${count}`}
      className={`ml-2 flex shrink-0 items-center gap-2 border-l border-b-2 border-l-[var(--crm-border)] px-4 text-sm font-semibold transition-colors ${active ? activeTone : `border-b-transparent ${inactiveTone}`}`}
    >
      <Icon name={icon} className="text-[18px]" />
      {label}
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone === 'info' ? 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'}`}>{count}</span>
    </button>
  )
}
