'use client'

import { Icon } from '@/components/ui/icon'
import { useCardCollapse } from '@/hooks/use-card-collapse'

interface ChecklistItem {
  label: string
  hint: string
  done: boolean
}

export function MissingInfoCard({ items }: { items: ChecklistItem[] }) {
  const [open, toggleOpen] = useCardCollapse('missing-info', false)
  const missing = items.filter((i) => !i.done)

  return (
    <section
      className="rounded-2xl p-5 border"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center justify-between mb-3"
      >
        <div className="flex items-center gap-2">
          <Icon name="checklist" className="!text-base !text-[color:var(--ck-accent)]" />
          <h3 className="ck-microlabel !text-[11px] !text-[color:var(--ck-text)]">Missing Information</h3>
          {missing.length > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-accent-bright)' }}
            >
              {missing.length}
            </span>
          )}
        </div>
        <Icon
          name={open ? 'expand_less' : 'expand_more'}
          className="!text-base !text-[color:var(--ck-text-muted)]"
        />
      </button>

      {open && (
        <ol className="space-y-2">
          {missing.map((item, idx) => (
            <li key={item.label} className="flex items-start gap-2.5 text-xs">
              <span
                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                style={{
                  background: 'var(--ck-surface-elev)',
                  border: '1px solid var(--ck-border)',
                  color: 'var(--ck-accent-bright)',
                }}
              >
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold leading-tight" style={{ color: 'var(--ck-text)' }}>
                  {item.label}
                </p>
                <p
                  className="text-[10px] mt-0.5 leading-snug"
                  style={{ color: 'var(--ck-text-muted)' }}
                >
                  {item.hint}
                </p>
              </div>
            </li>
          ))}
          {missing.length === 0 && (
            <li className="text-[11px] italic" style={{ color: 'var(--ck-text-muted)' }}>
              All required info captured.
            </li>
          )}
        </ol>
      )}
    </section>
  )
}
