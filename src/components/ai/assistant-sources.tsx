import type { AssistantSource } from '@/lib/ai/generation-store'

export function AssistantSources({ sources }: { sources: AssistantSource[] }) {
  if (sources.length === 0) return null
  return (
    <details className="group mt-2 border-t border-[var(--crm-border)] pt-2">
      <summary className="cursor-pointer list-none text-[10px] font-black text-[var(--crm-info)] hover:underline">
        <span className="group-open:hidden">Show {sources.length} source{sources.length === 1 ? '' : 's'}</span>
        <span className="hidden group-open:inline">Hide sources</span>
      </summary>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sources.map((source) => (
          <a key={`${source.name}-${source.url}`} href={source.url} className="rounded-full bg-[var(--crm-info-soft)] px-2 py-1 text-[10px] font-bold text-[var(--crm-info)] hover:underline">
            {source.name}
          </a>
        ))}
      </div>
    </details>
  )
}
