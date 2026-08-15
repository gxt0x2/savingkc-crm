import { Icon } from '@/components/ui/icon'

interface ProspectsWorkspaceTabProps {
  count: number
  active: boolean
  onSelect: () => void
}

export function ProspectsWorkspaceTab({ count, active, onSelect }: ProspectsWorkspaceTabProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Prospects ${count}`}
      className={`ml-2 flex shrink-0 items-center gap-2 border-l border-b-2 border-l-[var(--crm-border)] px-4 text-sm font-semibold transition-colors ${active ? 'border-b-[var(--crm-info)] text-[var(--crm-info)]' : 'border-b-transparent text-[var(--crm-text-muted)] hover:text-[var(--crm-info)]'}`}
    >
      <Icon name="person_search" className="text-[18px]" />
      Prospects
      <span className="rounded-full bg-[var(--crm-info-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-info)]">{count}</span>
    </button>
  )
}
