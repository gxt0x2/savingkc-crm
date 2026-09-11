import type { AssistantSource } from '@/lib/ai/generation-store'

export function AssistantSources({ sources }: { sources: AssistantSource[] }) {
  if (sources.length === 0) return null
  return (
    <details className="group mt-3 min-w-0">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.11em] text-[var(--crm-text-muted)] marker:content-none hover:text-[var(--crm-ink)]">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--crm-info)]" />
        <span className="group-open:hidden">Evidence · {sources.length} source{sources.length === 1 ? '' : 's'}</span>
        <span className="hidden group-open:inline">Hide evidence</span>
      </summary>
      <div className="mt-2 grid min-w-0 gap-1.5 sm:grid-cols-2">
        {sources.map((source) => (
          <a key={`${source.name}-${source.url}`} href={source.url} className="min-w-0 truncate rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-2.5 py-2 text-[10px] font-bold text-[var(--crm-info)] hover:border-[var(--crm-info)] hover:underline">
            {source.name || 'CRM evidence'}
          </a>
        ))}
      </div>
    </details>
  )
}
